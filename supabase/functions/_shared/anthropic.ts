import { Anthropic, z } from "./deps.ts";
import { env } from "./supabase.ts";

/** Model used by every pipeline stage. */
export const CLAUDE_MODEL = "claude-opus-5-5";

/**
 * Server-side refusal fallback: if a safety classifier declines a request, the API
 * re-runs it on Anthropic's recommended fallback model inside the same call.
 * Requires this beta header together with `fallbacks: "default"`.
 */
export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

let client: Anthropic | undefined;

export function anthropic(): Anthropic {
  client ??= new Anthropic({ apiKey: env("ANTHROPIC_API_KEY"), maxRetries: 3, timeout: 120_000 });
  return client;
}

export type ClaudeErrorInfo = { code: string; retryable: boolean };

/** Maps SDK errors to a short code that is safe to store in ai_runs.error and to log. */
export function describeClaudeError(err: unknown): ClaudeErrorInfo {
  if (err instanceof Anthropic.RateLimitError) return { code: "rate_limited", retryable: true };
  if (err instanceof Anthropic.AuthenticationError) return { code: "auth_failed", retryable: false };
  if (err instanceof Anthropic.PermissionDeniedError) return { code: "permission_denied", retryable: false };
  if (err instanceof Anthropic.BadRequestError) return { code: "bad_request", retryable: false };
  if (err instanceof Anthropic.InternalServerError) return { code: `server_error_${err.status}`, retryable: true };
  // Connection errors extend APIError, so test them first (timeout extends connection).
  if (err instanceof Anthropic.APIConnectionTimeoutError) return { code: "timeout", retryable: true };
  if (err instanceof Anthropic.APIConnectionError) return { code: "connection_error", retryable: true };
  if (err instanceof Anthropic.APIError) {
    const status = err.status ?? 0;
    return { code: `api_error_${status}`, retryable: status === 429 || status >= 500 };
  }
  // e.g. structured output that failed schema validation in .parse()
  if (err instanceof Anthropic.AnthropicError) return { code: "invalid_output", retryable: false };
  return { code: "unknown_error", retryable: false };
}

/**
 * Structured-output format for `output_config.format`, built from a Zod schema.
 *
 * We build the JSON Schema with Zod directly instead of the SDK's betaZodOutputFormat()
 * helper because that helper (sdk 0.131.0) moves `enum` constraints into descriptions,
 * which drops grammar-level enforcement of fields like `promisor` / `kind`. Zod's
 * draft-2020-12 output already marks every property required and sets
 * additionalProperties: false, which is what structured outputs needs.
 */
export function jsonOutputFormat(schema: z.ZodType): Anthropic.Beta.BetaJSONOutputFormat {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema) as Record<string, unknown>;
  return { type: "json_schema", schema: json };
}

/** Parses the final text block of a structured-output response and validates it with Zod. */
export function parseJsonOutput<T>(schema: z.ZodType<T>, message: Anthropic.Beta.BetaMessage): T | null {
  const text = [...message.content].reverse().find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export type TokenUsage = { input: number; output: number; cacheRead: number };

export function addUsage(
  total: TokenUsage,
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number | null },
): TokenUsage {
  return {
    input: total.input + usage.input_tokens,
    output: total.output + usage.output_tokens,
    cacheRead: total.cacheRead + (usage.cache_read_input_tokens ?? 0),
  };
}
