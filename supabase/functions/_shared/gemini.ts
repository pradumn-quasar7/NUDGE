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

/** One generateContent call with bounded retries on 429/5xx (exponential backoff). Never logs content. */
async function generate(body: Record<string, unknown>): Promise<GenerateResponse> {
  const url = `${ENDPOINT}/${encodeURIComponent(geminiModel())}:generateContent`;
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env("GEMINI_API_KEY") },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok) return (await res.json()) as GenerateResponse;
    const base = describeStatus(res.status);
    // Keep Google's machine-readable reason (e.g. PERMISSION_DENIED:SERVICE_DISABLED) — never the message text.
    let reason = "";
    try {
      const body = (await res.json()) as { error?: { status?: string; details?: { reason?: string }[] } };
      const why = body.error?.details?.find((d) => d.reason)?.reason;
      reason = [body.error?.status, why].filter(Boolean).join(":");
    } catch {
      await res.body?.cancel().catch(() => {});
    }
    const info = { ...base, code: reason ? `${base.code}:${res.status}:${reason}` : base.code };
    if (!info.retryable || attempt >= 2) throw new GeminiHttpError(info);
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt + Math.random() * 300));
    attempt++;
  }
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
  const model = geminiModel();
  let response: GenerateResponse;
  try {
    response = await generate({
      systemInstruction: { parts: [{ text: opts.system }] },
      contents: opts.contents,
      generationConfig: {
        responseMimeType: "application/json",
        responseJsonSchema: geminiJsonSchema(opts.schema),
        maxOutputTokens: opts.maxTokens ?? 16000,
        thinkingConfig: { thinkingLevel: opts.thinking ?? "low" },
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
