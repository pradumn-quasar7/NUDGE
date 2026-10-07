// Google Gemini (generateContent REST API) for the AI pipeline.
//
// Provider choice: AI_PROVIDER=gemini|anthropic, or automatically Gemini when GEMINI_API_KEY is set.
// Model: GEMINI_MODEL (default below). Outputs are JSON constrained by `responseJsonSchema` and then
// validated again with Zod — the model's output is never trusted as-is.
//
// Docs: https://ai.google.dev/api/generate-content · structured output · function calling.

import { z } from "./deps.ts";
import { env } from "./supabase.ts";

export const GEMINI_DEFAULT_MODEL = "gemini-3.8-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export type AiProvider = "gemini" | "anthropic";

export function aiProvider(): AiProvider {
  const forced = Deno.env.get("AI_PROVIDER");
  if (forced === "gemini" || forced === "anthropic") return forced;
  return Deno.env.get("GEMINI_API_KEY") ? "gemini" : "anthropic";
}

export function geminiModel(): string {
  return Deno.env.get("GEMINI_MODEL") || GEMINI_DEFAULT_MODEL;
}

/* ───────────── Wire types (only what we use) ───────────── */

export type GeminiPart =
  | { text: string; thought?: boolean; thoughtSignature?: string }
  | { functionCall: { name: string; args?: Record<string, unknown>; id?: string }; thoughtSignature?: string }
  | { functionResponse: { name: string; response: Record<string, unknown>; id?: string } };

export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export type FunctionDeclaration = { name: string; description: string; parametersJsonSchema: Record<string, unknown> };

type GenerateResponse = {
  candidates?: { content?: GeminiContent; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
};

export type GeminiUsage = { input: number; output: number; cacheRead: number };

export type GeminiErrorInfo = { code: string; retryable: boolean };

class GeminiHttpError extends Error {
  constructor(readonly info: GeminiErrorInfo) {
    super(info.code);
  }
}

/** Maps HTTP failures to the same short codes the Claude path stores in ai_runs.error. */
function describeStatus(status: number): GeminiErrorInfo {
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status === 401 || status === 403) return { code: "auth_failed", retryable: false };
  if (status === 400 || status === 404) return { code: "bad_request", retryable: false };
  if (status >= 500) return { code: `server_error_${status}`, retryable: true };
  return { code: `api_error_${status}`, retryable: false };
}

export function describeGeminiError(err: unknown): GeminiErrorInfo {
  if (err instanceof GeminiHttpError) return err.info;
  if (err instanceof DOMException && err.name === "TimeoutError") return { code: "timeout", retryable: true };
  if (err instanceof TypeError) return { code: "connection_error", retryable: true };
  return { code: "unknown_error", retryable: false };
}

/** Lighter model used when the primary model times out or is overloaded. */
export function geminiFallbackModel(): string {
  return Deno.env.get("GEMINI_FALLBACK_MODEL") || "gemini-3.5-flash-lite";
}

const ATTEMPT_TIMEOUT_MS = 40_000;

/** One HTTP call to one model. Throws GeminiHttpError (with Google's reason code) or a timeout. */
async function callModel(model: string, body: Record<string, unknown>): Promise<GenerateResponse> {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env("GEMINI_API_KEY") },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  });
  if (res.ok) return (await res.json()) as GenerateResponse;
  const base = describeStatus(res.status);
  // Keep Google's machine-readable reason (e.g. PERMISSION_DENIED:SERVICE_DISABLED) — never the message text.
  let reason = "";
  try {
    const err = (await res.json()) as { error?: { status?: string; details?: { reason?: string }[] } };
    const why = err.error?.details?.find((d) => d.reason)?.reason;
    reason = [err.error?.status, why].filter(Boolean).join(":");
  } catch {
    await res.body?.cancel().catch(() => {});
  }
  throw new GeminiHttpError({ ...base, code: reason ? `${base.code}:${res.status}:${reason}` : base.code });
}

/**
 * generateContent with resilience, bounded so callers (pg_net, the app) never wait more than ~90 s:
 *   1. the primary model, retried once after a quick 429/5xx (not after a timeout — that already took 40 s);
 *   2. then once on the lighter fallback model when the primary timed out or stayed overloaded.
 * Non-retryable errors (bad request, auth) fail immediately. Never logs content.
 */
async function generate(body: Record<string, unknown>): Promise<GenerateResponse> {
  const primary = geminiModel();
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await callModel(primary, body);
    } catch (err) {
      lastError = err;
      const info = describeGeminiError(err);
      if (!info.retryable) throw err;
      if (info.code === "timeout") break;
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 400));
    }
  }
  const fallback = geminiFallbackModel();
  if (fallback && fallback !== primary) {
    // The lighter model may not accept every thinking setting; let it use its default.
    const config = { ...((body.generationConfig as Record<string, unknown>) ?? {}) };
    delete config.thinkingConfig;
    try {
      return await callModel(fallback, { ...body, generationConfig: config });
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

/** JSON Schema for `responseJsonSchema` / `parametersJsonSchema`, from a Zod schema. */
export function geminiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return json;
}

function usageOf(r: GenerateResponse): GeminiUsage {
  const u = r.usageMetadata ?? {};
  return {
    input: u.promptTokenCount ?? 0,
    output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    cacheRead: u.cachedContentTokenCount ?? 0,
  };
}

const addUsage = (a: GeminiUsage, b: GeminiUsage): GeminiUsage => ({
  input: a.input + b.input,
  output: a.output + b.output,
  cacheRead: a.cacheRead + b.cacheRead,
});

const SAFETY_STOPS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION", "IMAGE_SAFETY"]);

export type JsonResult<T> =
  | { status: "ok"; data: T; usage: GeminiUsage; model: string }
  | { status: "rejected" | "failed"; error: string; retryable: boolean; usage: GeminiUsage; model: string };

/**
 * Structured JSON from Gemini, validated with Zod.
 * `rejected` = blocked by safety; `failed` = API error, truncation or output that doesn't match the schema.
 */
export async function geminiJson<T>(opts: {
  system: string;
  contents: GeminiContent[];
  schema: z.ZodType<T>;
  maxTokens?: number;
  thinking?: "low" | "medium" | "high";
}): Promise<JsonResult<T>> {
  return structuredCall({ system: opts.system, contents: opts.contents, schema: opts.schema, maxTokens: opts.maxTokens ?? 16000, thinking: opts.thinking ?? "low" });
}

/** Shared by geminiJson / geminiAudioJson: one constrained-JSON generateContent call, Zod-validated. */
async function structuredCall<T>(opts: {
  system: string;
  contents: unknown[];
  schema: z.ZodType<T>;
  maxTokens: number;
  thinking: "low" | "medium" | "high";
}): Promise<JsonResult<T>> {
  const model = geminiModel();
  let response: GenerateResponse;
  try {
    response = await generate({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: opts.contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: geminiJsonSchema(opts.schema),
        maxOutputTokens: opts.maxTokens,
        thinkingConfig: { thinkingLevel: opts.thinking },
      },
    });
  } catch (err) {
    const info = describeGeminiError(err);
    return { status: "failed", error: info.code, retryable: info.retryable, usage: { input: 0, output: 0, cacheRead: 0 }, model };
  }
  const usage = usageOf(response);
  const servedBy = response.modelVersion ?? model;
  if (response.promptFeedback?.blockReason) {
    return { status: "rejected", error: `blocked:${response.promptFeedback.blockReason.toLowerCase()}`, retryable: false, usage, model: servedBy };
  }
  const candidate = response.candidates?.[0];
  const finish = candidate?.finishReason ?? "";
  if (SAFETY_STOPS.has(finish)) return { status: "rejected", error: `blocked:${finish.toLowerCase()}`, retryable: false, usage, model: servedBy };
  if (finish === "MAX_TOKENS") return { status: "failed", error: "max_tokens", retryable: false, usage, model: servedBy };
  const text = (candidate?.content?.parts ?? [])
    .filter((p): p is { text: string; thought?: boolean } => "text" in p && !p.thought)
    .map((p) => p.text)
    .join("");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: "failed", error: "invalid_output", retryable: false, usage, model: servedBy };
  }
  const parsed = opts.schema.safeParse(raw);
  if (!parsed.success) return { status: "failed", error: "invalid_output", retryable: false, usage, model: servedBy };
  return { status: "ok", data: parsed.data, usage, model: servedBy };
}

/* ───────────── Audio (inline) ───────────── */

/** Audio sent inline in the request (base64). The whole request must stay under Gemini's 20 MB inline limit. */
export type GeminiInlineAudio = { mimeType: string; data: string };

/** Largest raw audio we send inline: base64 grows it by 4/3, and the prompt needs a little room under 20 MB. */
export const GEMINI_INLINE_AUDIO_MAX_BYTES = 14 * 1024 * 1024;

/**
 * Audio MIME types listed as supported by Gemini audio understanding
 * (https://ai.google.dev/gemini-api/docs/audio). MP4-container audio (.m4a, `audio/mp4`,
 * `audio/x-m4a`) is sent as `audio/m4a`. Returns null for anything else.
 */
export function geminiAudioMimeType(contentType: string | null | undefined, fileName = ""): string | null {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  const byType: Record<string, string> = {
    "audio/mp4": "audio/m4a",
    "audio/m4a": "audio/m4a",
    "audio/x-m4a": "audio/m4a",
    "audio/aac": "audio/aac",
    "audio/mpeg": "audio/mpeg",
    "audio/mp3": "audio/mp3",
    "audio/wav": "audio/wav",
    "audio/x-wav": "audio/wav",
    "audio/wave": "audio/wav",
    "audio/aiff": "audio/aiff",
    "audio/x-aiff": "audio/aiff",
    "audio/ogg": "audio/ogg",
    "audio/flac": "audio/flac",
    "audio/x-flac": "audio/flac",
    "audio/webm": "audio/webm",
    "audio/opus": "audio/opus",
  };
  if (byType[type]) return byType[type];
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? "";
  const byExt: Record<string, string> = {
    m4a: "audio/m4a",
    mp4: "audio/m4a",
    aac: "audio/aac",
    mp3: "audio/mp3",
    wav: "audio/wav",
    aiff: "audio/aiff",
    ogg: "audio/ogg",
    flac: "audio/flac",
    webm: "audio/webm",
    opus: "audio/opus",
  };
  return byExt[ext] ?? null;
}

/** Standard base64 of raw bytes (chunked so large files don't overflow the call stack). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Structured JSON about one inline audio clip (e.g. a transcript), validated with Zod.
 * The audio part comes before the instruction, as Google recommends for single-media prompts.
 */
export async function geminiAudioJson<T>(opts: {
  system: string;
  prompt: string;
  audio: GeminiInlineAudio;
  schema: z.ZodType<T>;
  maxTokens?: number;
  thinking?: "low" | "medium" | "high";
}): Promise<JsonResult<T>> {
  return structuredCall({
    system: opts.system,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType: opts.audio.mimeType, data: opts.audio.data } }, { text: opts.prompt }] }],
    schema: opts.schema,
    maxTokens: opts.maxTokens ?? 8000,
    thinking: opts.thinking ?? "low",
  });
}

/**
 * Tool-gathering loop: the model may call read-only functions for up to `maxRounds` rounds.
 * The model's turns are sent back unchanged (Gemini 3 thought signatures live on those parts).
 * Returns the conversation so far; the caller then asks for the final structured answer.
 */
export async function geminiGatherWithTools(opts: {
  system: string;
  contents: GeminiContent[];
  tools: FunctionDeclaration[];
  maxRounds: number;
  run: (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; content: string }>;
}): Promise<{ contents: GeminiContent[]; toolResults: string[]; usage: GeminiUsage; error?: GeminiErrorInfo; rejected?: string }> {
  const contents = [...opts.contents];
  const toolResults: string[] = [];
  let usage: GeminiUsage = { input: 0, output: 0, cacheRead: 0 };
  for (let round = 0; round < opts.maxRounds; round++) {
    let response: GenerateResponse;
    try {
      response = await generate({
        systemInstruction: { parts: [{ text: opts.system }] },
        contents,
        tools: [{ functionDeclarations: opts.tools }],
        toolConfig: { functionCallingConfig: { mode: "AUTO" } },
        generationConfig: { maxOutputTokens: 4000, thinkingConfig: { thinkingLevel: "low" } },
      });
    } catch (err) {
      return { contents, toolResults, usage, error: describeGeminiError(err) };
    }
    usage = addUsage(usage, usageOf(response));
    if (response.promptFeedback?.blockReason) return { contents, toolResults, usage, rejected: response.promptFeedback.blockReason };
    const candidate = response.candidates?.[0];
    if (candidate?.finishReason && SAFETY_STOPS.has(candidate.finishReason)) return { contents, toolResults, usage, rejected: candidate.finishReason };
    const parts = candidate?.content?.parts ?? [];
    const calls = parts.filter((p): p is Extract<GeminiPart, { functionCall: unknown }> => "functionCall" in p);
    if (!calls.length) break; // the model has what it needs
    contents.push({ role: "model", parts }); // unchanged, signatures included
    const responses: GeminiPart[] = [];
    for (const call of calls) {
      const result = await opts.run(call.functionCall.name, call.functionCall.args ?? {});
      toolResults.push(`[${call.functionCall.name}] ${result.content}`);
      responses.push({
        functionResponse: {
          name: call.functionCall.name,
          ...(call.functionCall.id ? { id: call.functionCall.id } : {}),
          response: result.ok ? { content: result.content } : { error: result.content },
        },
      });
    }
    contents.push({ role: "user", parts: responses });
  }
  return { contents, toolResults, usage };
}

export { addUsage as addGeminiUsage };
