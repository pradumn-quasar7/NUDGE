// Customer Handoff Brief — HTTP entry point. Logic and prompt: ./brief.ts.
//
// POST { org_id, customer_id, commitment_id?, for_member_id?, refresh? } with the user's JWT
// (verify_jwt = true; re-verified here). The caller must be an active member of org_id and be
// able to see the customer (all reads use the caller's RLS client).
//
// 200 { id, brief, cached, aiRunId, createdAt }
//     cached = true when an identical brief (same memory, target and reader) was made in the
//     last 6 hours; `refresh: true` skips the cache.
// 400 invalid_org_id | invalid_customer_id | invalid_commitment_id | invalid_for_member
// 401 missing_authorization | invalid_token · 403 not_a_member
// 404 customer_not_found | commitment_not_found
// 422 not_enough_history (nothing to brief on yet — the app shows its on-device brief)
// 429 rate_limited (20 AI briefs per member per hour; Retry-After header)
// 502 brief_failed (model output unusable) · 503 ai_unavailable (provider down / not Gemini)

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { aiProvider, geminiJson } from "../_shared/gemini.ts";
import { requireMembership, requireUser, UUID_RE } from "../_shared/auth.ts";
import { HttpError, json, preflight } from "../_shared/cors.ts";
import { enforceAiQuota, errorResponseWithRetry } from "../_shared/ratelimit.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { isValidTimeZone } from "../_shared/time.ts";
import type { OrgRow } from "../_shared/types.ts";
import {
  BriefSchema,
  buildPrompt,
  CACHE_HOURS,
  FN,
  type HandoffBrief,
  hasEnoughHistory,
  loadContext,
  MAX_BRIEFS_PER_HOUR,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  toBrief,
} from "./brief.ts";

const optionalUuid = (v: unknown, code: string): string | null => {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !UUID_RE.test(v)) throw new HttpError(400, code);
  return v;
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  const startedAt = Date.now();
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { user, db } = await requireUser(req);

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const orgId = typeof body?.org_id === "string" ? body.org_id : "";
    const customerId = typeof body?.customer_id === "string" ? body.customer_id : "";
    if (!UUID_RE.test(orgId)) throw new HttpError(400, "invalid_org_id");
    if (!UUID_RE.test(customerId)) throw new HttpError(400, "invalid_customer_id");
    const commitmentId = optionalUuid(body?.commitment_id, "invalid_commitment_id");
    const forMemberId = optionalUuid(body?.for_member_id, "invalid_for_member");
    const refresh = body?.refresh === true;

    const me = await requireMembership(db, user.id, orgId);
    const { data: org, error: orgError } = await db.from("organizations").select("id, name, sells, timezone, settings").eq("id", orgId).single<OrgRow>();
    if (orgError || !org) throw new HttpError(404, "org_not_found");
    const tz = isValidTimeZone(org.timezone) ? org.timezone : "UTC";

    // Visibility is enforced here: loadContext reads as the caller and 404s on a hidden customer.
    const ctx = await loadContext(db, { org, tz, me, customerId, commitmentId, forMemberId });

    // Same memory → same brief: no model call (and it doesn't count against the limit).
    if (!refresh) {
      const since = new Date(Date.now() - CACHE_HOURS * 3_600_000).toISOString();
      const { data: cached } = await db
        .from("handoff_briefs")
        .select("id, brief, ai_run_id, created_at")
        .eq("org_id", orgId)
        .eq("customer_id", customerId)
        .eq("fingerprint", ctx.fingerprint)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle<{ id: string; brief: HandoffBrief; ai_run_id: string | null; created_at: string }>();
      if (cached) return json({ id: cached.id, brief: cached.brief, cached: true, aiRunId: cached.ai_run_id, createdAt: cached.created_at });
    }

    if (!hasEnoughHistory(ctx)) throw new HttpError(422, "not_enough_history");
    if (aiProvider() !== "gemini") throw new HttpError(503, "ai_unavailable");

    // Per-member limit, counted over ai_runs (failed runs count too).
    const service = serviceClient();
    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { data: recent, error: recentError } = await service
      .from("ai_runs")
      .select("created_at")
      .eq("org_id", orgId)
      .eq("stage", "handoff")
      .eq("output->>requested_by_member_id", me.id)
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: true })
      .limit(MAX_BRIEFS_PER_HOUR);
    if (recentError) throw new HttpError(500, "rate_limit_check_failed");
    if ((recent?.length ?? 0) >= MAX_BRIEFS_PER_HOUR) {
      const oldest = new Date((recent as { created_at: string }[])[0].created_at).getTime();
      const retryAfter = Math.max(1, Math.ceil((oldest + 3_600_000 - Date.now()) / 1000));
      return json({ error: "rate_limited", retry_after: retryAfter }, 429, { "Retry-After": String(retryAfter) });
    }

    // Shared quota (per member + workspace-wide daily cap); cached briefs above don't consume it.
    await enforceAiQuota(db, orgId, "handoff");

    const { prompt, eventRefs, commitmentRefs } = buildPrompt(ctx);
    const r = await geminiJson({
      system: SYSTEM_PROMPT,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      schema: BriefSchema,
      maxTokens: 6000,
      thinking: "low",
    });
    const brief = r.status === "ok" ? toBrief(ctx, r.data, { eventRefs, commitmentRefs }) : null;
    const failure = r.status !== "ok" ? r.error : brief ? null : "invalid_output";

    // Audit trail of the model call. Ids and counts only — the brief text lives in handoff_briefs.
    const { data: run } = await service
      .from("ai_runs")
      .insert({
        org_id: orgId,
        stage: "handoff",
        model: r.model,
        prompt_version: PROMPT_VERSION,
        input_event_ids: ctx.events.map((e) => e.id),
        output: {
          requested_by_member_id: me.id,
          for_member_id: ctx.forMember?.id ?? null,
          customer_id: customerId,
          commitment_id: ctx.target?.id ?? null,
          counts: { events: ctx.events.length, facts: ctx.facts.length, commitments: ctx.commitments.length },
          evidence_event_ids: brief?.evidenceEventIds ?? [],
          sensitive_notes: brief?.sensitiveNotes.length ?? 0,
        },
        input_tokens: r.usage.input,
        output_tokens: r.usage.output,
        cache_read_tokens: r.usage.cacheRead,
        latency_ms: Date.now() - startedAt,
        status: brief ? "succeeded" : r.status === "rejected" ? "rejected" : "failed",
        error: failure,
        finished_at: new Date().toISOString(),
      })
      .select("id")
      .single<{ id: string }>();

    if (!brief) {
      if (r.status === "failed" && r.retryable) {
        console.error(`[${FN}] run ${run?.id ?? "?"} failed: ${failure}`);
        throw new HttpError(503, "ai_unavailable");
      }
      throw new HttpError(502, "brief_failed");
    }

    const { data: saved, error: saveError } = await service
      .from("handoff_briefs")
      .insert({
        org_id: orgId,
        customer_id: customerId,
        commitment_id: ctx.target?.id ?? null,
        requested_by_member_id: me.id,
        for_member_id: ctx.forMember?.id ?? null,
        brief,
        evidence_event_ids: brief.evidenceEventIds,
        fingerprint: ctx.fingerprint,
        ai_run_id: run?.id ?? null,
      })
      .select("id, created_at")
      .single<{ id: string; created_at: string }>();
    if (saveError) console.error(`[${FN}] brief not stored (${saveError.code ?? "unknown"})`);

    return json({ id: saved?.id ?? null, brief, cached: false, aiRunId: run?.id ?? null, createdAt: saved?.created_at ?? brief.generatedAt });
  } catch (err) {
    return errorResponseWithRetry(FN, err);
  }
});
