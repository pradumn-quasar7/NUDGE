// Follow-up scheduler (invoked by pg_cron via pg_net, every 15 minutes).
//
//   commitment due → policy check (opt-out, quiet hours, weekly frequency cap)
//                  → follow-up suggestion + notification for the owner
//
// It NEVER sends anything to a customer. Outbound messages require a person to
// approve and send them from the app (product principle 6).
//
// Internal endpoint: POST {} with the service-role key.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { errorResponse, HttpError, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { clockTime, isValidTimeZone, localDate, nextWindowStart } from "../_shared/time.ts";
import type { FollowupCandidate, OrgRow } from "../_shared/types.ts";

const FN = "followup-scheduler";
const HORIZON = "2 hours";
const BATCH = 500;

type Plan = {
  suggestion: Record<string, unknown>;
  notification: Record<string, unknown> | null;
};

function relative(due: Date, now: Date, tz: string): string {
  const mins = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (mins <= -1440) return `overdue by ${Math.floor(-mins / 1440)} day${-mins >= 2880 ? "s" : ""}`;
  if (mins < 0) return "overdue";
  if (mins < 60) return `due in ${Math.max(mins, 1)} min`;
  if (localDate(due, tz) === localDate(now, tz)) return `due at ${clockTime(due, tz)}`;
  return `due ${localDate(due, tz)} ${clockTime(due, tz)}`;
}

function plan(c: FollowupCandidate, org: OrgRow | undefined, now: Date): Plan {
  const orgTz = isValidTimeZone(c.org_timezone) ? c.org_timezone : "UTC";
  const customerTz = c.policy_timezone && isValidTimeZone(c.policy_timezone) ? c.policy_timezone : orgTz;
  const due = new Date(c.due_at);
  const overdue = due.getTime() < now.getTime();
  const today = localDate(now, orgTz);
  const outbound = Number(c.outbound_last_7d) || 0;

  // ── Contact policy ──
  const flags: string[] = [];
  let sendAt: Date | null = now;
  if (c.opted_out) {
    flags.push("opted_out");
    sendAt = null;
  }
  if (sendAt && c.max_messages_per_week != null && outbound >= c.max_messages_per_week) {
    flags.push("frequency_cap");
  }
  if (sendAt && c.preferred_hours_start && c.preferred_hours_end) {
    sendAt = nextWindowStart(now, customerTz, c.preferred_hours_start, c.preferred_hours_end);
    if (sendAt.getTime() > now.getTime()) flags.push("quiet_hours");
  }

  const when = relative(due, now, orgTz);
  let why = c.promisor === "us" ? `You promised · ${when}` : `${c.customer_name.split(" ")[0]} promised · ${when}`;
  if (flags.includes("opted_out")) why = "Opted out of messages · follow up another way";
  else if (flags.includes("frequency_cap")) why = `Already contacted ${outbound}× this week · ${when}`;
  else if (flags.includes("quiet_hours") && sendAt) why = `${when} · best time ${clockTime(sendAt, customerTz)}`;

  const blocked = flags.includes("opted_out") || flags.includes("frequency_cap");
  const action = blocked
    ? { label: "Review", variant: "secondary" }
    : c.promisor === "us"
    ? { label: "Do it now", variant: "primary" }
    : { label: "Nudge", variant: "secondary" };

  const suggestion = {
    org_id: c.org_id,
    customer_id: c.customer_id,
    commitment_id: c.commitment_id,
    bucket: c.promisor === "us" ? "promises" : "waiting",
    what: c.title,
    why,
    why_tone: overdue ? "warn" : "neutral",
    why_ai: false,
    action_label: action.label,
    action_variant: action.variant,
    suggested_send_at: sendAt?.toISOString() ?? null,
    policy_flags: flags,
    at: now.toISOString(),
    // One suggestion per commitment per local day; a resolved one stays resolved today.
    dedupe_key: `commitment:${c.commitment_id}:${today}`,
  };

  const notificationsOff = org?.settings?.notifications === "off";
  const notification = notificationsOff
    ? null
    : {
      org_id: c.org_id,
      recipient_member_id: c.owner_member_id,
      kind: "promise_due",
      customer_id: c.customer_id,
      commitment_id: c.commitment_id,
      title: overdue
        ? [{ t: "Overdue: " }, { t: c.title, b: true }]
        : [{ t: `Promise ${when}: ` }, { t: c.title, b: true }],
      meta: flags.length ? `Promise Radar · ${flags.map((f) => f.replace("_", " ")).join(", ")}` : "Promise Radar",
      actions: [{ label: "Open", primary: true, route: `/promise/${c.commitment_id}` }],
      dedupe_key: `promise_due:${c.commitment_id}:${today}`,
    };

  return { suggestion, notification };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    await requireServiceRole(req);
    const db = serviceClient();
    const now = new Date();

    // Snoozes that have run out become open again.
    const { error: reopenError } = await db
      .from("commitments")
      .update({ status: "open" })
      .eq("status", "snoozed")
      .lte("snoozed_until", now.toISOString());
    if (reopenError) throw new HttpError(500, "reopen_failed");

    const { data, error } = await db.rpc("followup_candidates", { p_horizon: HORIZON, p_limit: BATCH });
    if (error) throw new HttpError(500, "candidates_failed");
    const candidates = (data ?? []) as FollowupCandidate[];
    if (!candidates.length) return json({ candidates: 0, suggestions: 0, notifications: 0 });

    const orgIds = [...new Set(candidates.map((c) => c.org_id))];
    const { data: orgs } = await db.from("organizations").select("id, name, sells, timezone, settings").in("id", orgIds).returns<OrgRow[]>();
    const orgById = new Map((orgs ?? []).map((o) => [o.id, o]));

    const plans = candidates.map((c) => plan(c, orgById.get(c.org_id), now));

    const { data: suggestions, error: suggestionError } = await db
      .from("followup_suggestions")
      .upsert(plans.map((p) => p.suggestion), { onConflict: "org_id,dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (suggestionError) throw new HttpError(500, "suggestions_failed");

    const notificationRows = plans.flatMap((p) => (p.notification ? [p.notification] : []));
    let notifications = 0;
    if (notificationRows.length) {
      const { data: created, error: notificationError } = await db
        .from("notifications")
        .upsert(notificationRows, { onConflict: "org_id,dedupe_key", ignoreDuplicates: true })
        .select("id");
      if (notificationError) throw new HttpError(500, "notifications_failed");
      notifications = created?.length ?? 0;
      // TODO: push delivery (Expo push tokens) for newly created notifications.
    }

    return json({ candidates: candidates.length, suggestions: suggestions?.length ?? 0, notifications });
  } catch (err) {
    return errorResponse(FN, err);
  }
});
