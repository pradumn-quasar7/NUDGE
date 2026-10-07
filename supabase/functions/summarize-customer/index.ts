// Customer Memory · "What matters" summary — HTTP entry point. Logic: ./summarize.ts.
//
// Internal endpoint: POST { customer_id } with the service-role key (verify_jwt = false in
// config.toml; requireServiceRole is the gate). Enqueued by public.queue_customer_summary().
// 200 { status: succeeded | skipped | rejected | failed, ai_run_id? } · 404 not_found ·
// 503 when the model call failed in a retryable way.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireServiceRole, UUID_RE } from "../_shared/auth.ts";
import { errorResponse, HttpError, json } from "../_shared/cors.ts";
import { FN, summarize } from "./summarize.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    await requireServiceRole(req);
    const body = (await req.json().catch(() => null)) as { customer_id?: unknown } | null;
    const customerId = typeof body?.customer_id === "string" ? body.customer_id : "";
    if (!UUID_RE.test(customerId)) throw new HttpError(400, "invalid_customer_id");

    const result = await summarize(customerId);
    const status = result.status === "not_found" ? 404 : result.status === "failed" && result.retryable ? 503 : 200;
    return json(result, status);
  } catch (err) {
    return errorResponse(FN, err);
  }
});
