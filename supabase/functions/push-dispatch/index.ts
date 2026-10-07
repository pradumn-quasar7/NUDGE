// Push dispatch (invoked by the notifications AFTER INSERT trigger via pg_net).
//
//   notification → workspace setting (off / needs_you / all) → recipients who can
//   see it → quiet hours → their enabled Expo push tokens → Expo push service
//
// Calm by default: "needs_you" only pushes promise_due, ai_commitments and
// customer; nothing is pushed 21:00–08:00 in the workspace time zone except a
// promise that falls due within the hour. A skipped push is not lost — the
// notification is still in the app's feed.
//
// Internal endpoint: POST { "notification_id": uuid } with the service-role key.
// Logs only ids, counts and Expo error codes — never notification text or tokens.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireServiceRole, UUID_RE } from "../_shared/auth.ts";
import { errorResponse, HttpError, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";
import { isValidTimeZone, localParts } from "../_shared/time.ts";
import type { OrgRow } from "../_shared/types.ts";

const FN = "push-dispatch";
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100; // Expo: at most 100 messages per request
const QUIET_START = 21 * 60; // 21:00
const QUIET_END = 8 * 60; // 08:00
const NEEDS_YOU = new Set(["promise_due", "ai_commitments", "customer"]);

type Kind = "customer" | "promise_due" | "ai_commitments" | "payment" | "task";

type NotificationRow = {
  id: string;
  org_id: string;
  recipient_member_id: string | null;
  kind: Kind;
  customer_id: string | null;
  commitment_id: string | null;
  title: unknown;
  read_at: string | null;
  created_at: string;
};

type Member = { id: string; role: "owner" | "member"; status: "active" | "invited"; user_id: string | null };
type Token = { id: string; member_id: string; token: string; local_reminders: boolean };

type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: { url: string; notificationId: string; kind: Kind };
  channelId: "reminders";
  priority: "high" | "default";
  sound?: "default";
  ttl: number;
};
type ExpoTicket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error?: string } };

/** Plain text of a rich title: [{ t, b? }] → "…". */
export function plainTitle(title: unknown): string {
  if (!Array.isArray(title)) return "";
  return title
    .map((s) => (s && typeof s === "object" && typeof (s as { t?: unknown }).t === "string" ? (s as { t: string }).t : ""))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Where a tap on the push opens the app (expo-router paths, validated again in the app). */
export function routeFor(n: Pick<NotificationRow, "kind" | "customer_id" | "commitment_id">): string {
  switch (n.kind) {
    case "customer":
      return n.customer_id ? `/customer/${n.customer_id}` : "/notifications";
    case "promise_due":
      return n.commitment_id ? `/promise/${n.commitment_id}` : "/radar";
    default:
      return "/notifications";
  }
}

/** Inside 21:00–08:00 in `timeZone`. */
export function inQuietHours(now: Date, timeZone: string): boolean {
  const p = localParts(now, timeZone);
  const minutes = p.hour * 60 + p.minute;
  return minutes >= QUIET_START || minutes < QUIET_END;
}

function contextTitle(kind: Kind, customerName: string | null): string {
  switch (kind) {
    case "promise_due":
      return "Promise Radar";
    case "customer":
      return customerName ? clip(customerName, 60) : "Nudge";
    case "payment":
      return "Payment";
    default:
      return "Nudge";
  }
}

async function sendBatch(messages: ExpoMessage[]): Promise<ExpoTicket[] | null> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  const access = Deno.env.get("EXPO_ACCESS_TOKEN");
  if (access) headers.Authorization = `Bearer ${access}`;
  const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) }).catch(() => null);
  if (!res) {
    console.error(`[${FN}] expo request failed (network)`);
    return null;
  }
  const payload = (await res.json().catch(() => null)) as { data?: ExpoTicket[]; errors?: { code?: string }[] } | null;
  if (!res.ok || !Array.isArray(payload?.data)) {
    const codes = (payload?.errors ?? []).map((e) => e.code ?? "unknown").join(",");
    console.error(`[${FN}] expo request rejected ${res.status} ${codes}`);
    return null;
  }
  return payload.data;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    await requireServiceRole(req);
    const input = (await req.json().catch(() => null)) as { notification_id?: unknown } | null;
    const notificationId = typeof input?.notification_id === "string" ? input.notification_id : "";
    if (!UUID_RE.test(notificationId)) throw new HttpError(400, "invalid_notification_id");

    const db = serviceClient();
    const now = new Date();

    const { data: n, error: nError } = await db
      .from("notifications")
      .select("id, org_id, recipient_member_id, kind, customer_id, commitment_id, title, read_at, created_at")
      .eq("id", notificationId)
      .maybeSingle<NotificationRow>();
    if (nError) throw new HttpError(500, "notification_lookup_failed");
    if (!n) return json({ sent: 0, skipped: "not_found" });
    if (n.read_at) return json({ sent: 0, skipped: "already_read" });
    // A late delivery (pg_net retry, backlog) is no longer news.
    if (now.getTime() - new Date(n.created_at).getTime() > 6 * 3_600_000) return json({ sent: 0, skipped: "stale" });

    const { data: org, error: orgError } = await db
      .from("organizations")
      .select("id, name, sells, timezone, settings")
      .eq("id", n.org_id)
      .maybeSingle<OrgRow>();
    if (orgError) throw new HttpError(500, "org_lookup_failed");
    if (!org) return json({ sent: 0, skipped: "no_org" });

    const level = org.settings?.notifications ?? "needs_you";
    if (level === "off") return json({ sent: 0, skipped: "notifications_off" });
    if (level === "needs_you" && !NEEDS_YOU.has(n.kind)) return json({ sent: 0, skipped: "not_needs_you" });

    // ── Related rows: customer (visibility + title), commitment (due time) ──
    let customer: { name: string; owner_member_id: string | null } | null = null;
    if (n.customer_id) {
      const { data } = await db
        .from("customers")
        .select("name, owner_member_id")
        .eq("org_id", n.org_id)
        .eq("id", n.customer_id)
        .maybeSingle<{ name: string; owner_member_id: string | null }>();
      customer = data ?? null;
    }
    let commitment: { due_at: string; status: string } | null = null;
    if (n.kind === "promise_due" && n.commitment_id) {
      const { data } = await db
        .from("commitments")
        .select("due_at, status")
        .eq("org_id", n.org_id)
        .eq("id", n.commitment_id)
        .maybeSingle<{ due_at: string; status: string }>();
      commitment = data ?? null;
      // Done or dismissed since the scheduler ran: nothing to remind about.
      if (commitment && commitment.status !== "open") return json({ sent: 0, skipped: "promise_closed" });
    }
    const dueIn = commitment ? new Date(commitment.due_at).getTime() - now.getTime() : null;

    // ── Quiet hours (no per-member quiet hours in the schema yet: workspace default) ──
    const tz = isValidTimeZone(org.timezone) ? org.timezone : "UTC";
    const urgent = n.kind === "promise_due" && dueIn !== null && dueIn > -15 * 60_000 && dueIn <= 60 * 60_000;
    if (inQuietHours(now, tz) && !urgent) return json({ sent: 0, skipped: "quiet_hours" });

    // ── Recipients: the addressee, or every active member — who can see the customer ──
    let membersQuery = db.from("organization_members").select("id, role, status, user_id").eq("org_id", n.org_id).eq("status", "active");
    if (n.recipient_member_id) membersQuery = membersQuery.eq("id", n.recipient_member_id);
    const { data: members, error: mError } = await membersQuery.returns<Member[]>();
    if (mError) throw new HttpError(500, "members_lookup_failed");
    const shareAll = org.settings?.share_all_customers !== false;
    const recipients = (members ?? []).filter(
      (m) => m.user_id && (!n.customer_id || !customer || m.role === "owner" || shareAll || customer.owner_member_id === m.id),
    );
    // A customer we can no longer find (deleted meanwhile): only owners.
    const visible = n.customer_id && !customer ? recipients.filter((m) => m.role === "owner") : recipients;
    if (!visible.length) return json({ sent: 0, skipped: "no_recipients" });

    const { data: tokens, error: tError } = await db
      .from("push_tokens")
      .select("id, member_id, token, local_reminders")
      .eq("org_id", n.org_id)
      .is("disabled_at", null)
      .in("member_id", visible.map((m) => m.id))
      .returns<Token[]>();
    if (tError) throw new HttpError(500, "tokens_lookup_failed");

    // Devices that schedule their own "due soon" reminder for the promise they own
    // would otherwise ping twice. Overdue promises are still pushed.
    const dueSoonLocal = n.kind === "promise_due" && dueIn !== null && dueIn > 0;
    const targets = (tokens ?? []).filter((t) => !(dueSoonLocal && t.local_reminders));
    if (!targets.length) return json({ sent: 0, skipped: "no_devices" });

    const body = clip(plainTitle(n.title) || "Something needs you", 180);
    const title = contextTitle(n.kind, customer?.name ?? null);
    const url = routeFor(n);
    const high = n.kind === "promise_due";
    const messages: ExpoMessage[] = targets.map((t) => ({
      to: t.token,
      title,
      body,
      data: { url, notificationId: n.id, kind: n.kind },
      channelId: "reminders",
      priority: high ? "high" : "default",
      ...(high ? { sound: "default" as const } : {}),
      ttl: 6 * 3600,
    }));

    let sent = 0;
    const failures: Record<string, number> = {};
    const dead: { id: string; reason: string }[] = [];
    for (let i = 0; i < messages.length; i += BATCH) {
      const chunk = messages.slice(i, i + BATCH);
      const tickets = await sendBatch(chunk);
      if (!tickets) {
        failures.request = (failures.request ?? 0) + chunk.length;
        continue;
      }
      tickets.forEach((ticket, j) => {
        if (ticket.status === "ok") {
          sent++;
          return;
        }
        const code = ticket.details?.error ?? "unknown";
        failures[code] = (failures[code] ?? 0) + 1;
        if (code === "DeviceNotRegistered") dead.push({ id: targets[i + j].id, reason: code });
      });
    }

    if (dead.length) {
      const { error } = await db
        .from("push_tokens")
        .update({ disabled_at: now.toISOString(), disabled_reason: "DeviceNotRegistered" })
        .in("id", dead.map((d) => d.id));
      if (error) console.error(`[${FN}] disable_tokens_failed`);
    }
    if (Object.keys(failures).length) {
      console.warn(`[${FN}] notification=${n.id} sent=${sent} failed=${JSON.stringify(failures)}`);
    }

    return json({ sent, devices: targets.length, disabled: dead.length, failed: failures });
  } catch (err) {
    return errorResponse(FN, err);
  }
});
