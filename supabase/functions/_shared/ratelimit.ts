// Per-member AI quotas (migration 20261007000010_hardening.sql).
//
//   consume_ai_quota(kind, org_id, per_hour?, per_day?) → boolean
//     SECURITY DEFINER, run with the USER-scoped client so auth.uid() is the caller.
//     Records the call when it fits the caller's per-kind limits (rolling hour / 24 h)
//     and the workspace-wide daily cap; returns false (nothing recorded) otherwise.
//     per_hour / per_day can only tighten the server limits in ai_quota_limits.
//   ai_quota_retry_after(kind, org_id, …) → seconds until the next call would fit.
//
// Call enforceAiQuota() after the membership check and right before the model call.
// A refusal is a 429 with `Retry-After` and body { error: "rate_limited", retry_after }.

import type { SupabaseClient } from "./deps.ts";
import { errorResponse, HttpError, json } from "./cors.ts";

export type AiQuotaKind = "copilot" | "transcribe" | "summary" | "handoff" | "draft";

export class RateLimitedError extends HttpError {
  constructor(readonly retryAfterSeconds: number) {
    super(429, "rate_limited", "Too many AI requests. Try again later.");
  }
}

/** PostgREST / Postgres codes for "this function doesn't exist (yet)". */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

export async function enforceAiQuota(
  db: SupabaseClient,
  orgId: string,
  kind: AiQuotaKind,
  opts: { perHour?: number; perDay?: number } = {},
): Promise<void> {
  const args = { kind, org_id: orgId, per_hour: opts.perHour ?? null, per_day: opts.perDay ?? null };
  const { data, error } = await db.rpc("consume_ai_quota", args);
  if (error) {
    // Deployed before the migration: don't take the feature down, but say so in the logs.
    if (MISSING_FUNCTION.has(error.code ?? "")) {
      console.warn(`[ratelimit] consume_ai_quota is missing (${error.code}); quota not enforced`);
      return;
    }
    if (error.code === "42501") throw new HttpError(403, "not_a_member");
    console.error(`[ratelimit] quota check failed: ${error.code ?? "unknown"}`);
    throw new HttpError(503, "rate_limit_unavailable");
  }
  if (data === true) return;

  const wait = await db.rpc("ai_quota_retry_after", args);
  const seconds = typeof wait.data === "number" && wait.data > 0 ? Math.min(wait.data, 86_400) : 60;
  throw new RateLimitedError(seconds);
}

/** errorResponse() plus the 429 shape: `Retry-After` header and `retry_after` in the body. */
export function errorResponseWithRetry(fn: string, err: unknown): Response {
  if (err instanceof RateLimitedError) {
    return json(
      { error: err.code, message: err.message, retry_after: err.retryAfterSeconds },
      429,
      { "Retry-After": String(err.retryAfterSeconds) },
    );
  }
  return errorResponse(fn, err);
}
