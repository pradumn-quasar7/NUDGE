// WhatsApp Cloud API webhook.
//
//   GET  → subscription handshake (hub.mode / hub.verify_token / hub.challenge)
//   POST → signature check → idempotency (webhook_events) → 200 immediately,
//          then in the background: route by phone_number_id → identity resolution
//          → immutable conversation_events → ai-extract per new event.
//
// verify_jwt is disabled for this function (Meta does not send a Supabase JWT);
// the X-Hub-Signature-256 HMAC is the authentication.
// Never logs message bodies or phone numbers.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { timingSafeEqual, timingSafeEqualBytes } from "../_shared/auth.ts";
import { env, serviceClient } from "../_shared/supabase.ts";
import type { EventKind } from "../_shared/types.ts";

const FN = "whatsapp-webhook";
const MAX_BODY_BYTES = 1_000_000;
const encoder = new TextEncoder();

// ───────────── Payload types (subset of the Cloud API webhook schema) ─────────────

type WaContact = { wa_id?: string; profile?: { name?: string } };
type WaMedia = { id?: string; caption?: string; mime_type?: string; filename?: string; voice?: boolean };
type WaMessage = {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  image?: WaMedia;
  video?: WaMedia;
  audio?: WaMedia;
  document?: WaMedia;
  sticker?: WaMedia;
  location?: { latitude?: number; longitude?: number; name?: string; address?: string };
  button?: { text?: string; payload?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string; description?: string };
  };
  contacts?: unknown[];
  order?: { product_items?: { product_retailer_id?: string; quantity?: number }[] };
  reaction?: unknown;
  context?: { id?: string };
};
type WaValue = {
  messaging_product?: string;
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: WaContact[];
  messages?: WaMessage[];
  statuses?: unknown[];
};
type WaPayload = { object?: string; entry?: { id?: string; changes?: { field?: string; value?: WaValue }[] }[] };

// ───────────── Crypto helpers ─────────────

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** X-Hub-Signature-256: "sha256=<hex HMAC-SHA256(app_secret, raw body)>" */
async function verifySignature(raw: Uint8Array<ArrayBuffer>, header: string | null, appSecret: string): Promise<boolean> {
  if (!header) return false;
  const match = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!match) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(appSecret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, raw));
  return timingSafeEqualBytes(mac, hexToBytes(match[1].toLowerCase()));
}

async function sha256Hex(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", raw)));
}

// ───────────── Normalisation ─────────────

type Normalized = { kind: EventKind; title: string; body: string | null };

/** Maps a Cloud API message to an event. Returns null for messages we don't store (reactions, system). */
function normalizeMessage(m: WaMessage): Normalized | null {
  switch (m.type) {
    case "text":
      return { kind: "message", title: "WhatsApp message", body: m.text?.body ?? null };
    case "image":
      return { kind: "message", title: "Sent a photo", body: m.image?.caption ?? null };
    case "video":
      return { kind: "message", title: "Sent a video", body: m.video?.caption ?? null };
    case "sticker":
      return { kind: "message", title: "Sent a sticker", body: null };
    case "audio":
      // TODO: voice-note transcription (Phase 2) — body stays empty until then.
      return { kind: "message", title: m.audio?.voice ? "Voice note" : "Sent audio", body: null };
    case "document":
      return {
        kind: "message",
        title: "Sent a document",
        body: [m.document?.filename, m.document?.caption].filter(Boolean).join(" — ") || null,
      };
    case "location": {
      const l = m.location ?? {};
      const label = [l.name, l.address].filter(Boolean).join(", ");
      return { kind: "message", title: "Shared a location", body: label || `${l.latitude},${l.longitude}` };
    }
    case "button":
      return { kind: "message", title: "Tapped a button", body: m.button?.text ?? null };
    case "interactive": {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply;
      return { kind: "message", title: "Replied to options", body: reply?.title ?? null };
    }
    case "contacts":
      return { kind: "message", title: "Shared a contact", body: null };
    case "order": {
      const items = m.order?.product_items ?? [];
      return {
        kind: "message",
        title: "Placed an order",
        body: items.map((i) => `${i.quantity ?? 1} × ${i.product_retailer_id ?? "item"}`).join(", ") || null,
      };
    }
    case "reaction":
    case "system":
    case "unsupported":
    default:
      return null;
  }
}

// ───────────── Background processing ─────────────

async function invokeExtraction(eventId: string): Promise<void> {
  const res = await fetch(`${env("SUPABASE_URL")}/functions/v1/ai-extract`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ event_id: eventId }),
    signal: AbortSignal.timeout(140_000),
  });
  await res.body?.cancel();
  if (!res.ok) console.error(`[${FN}] ai-extract returned ${res.status} for event ${eventId}`);
}

async function processDelivery(webhookEventId: string, payload: WaPayload): Promise<void> {
  const db = serviceClient();
  const errors = new Set<string>();
  const newEventIds: string[] = [];
  let orgId: string | null = null;

  try {
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (change.field !== "messages" || value?.messaging_product !== "whatsapp") continue;
        // TODO: value.statuses (sent/delivered/read for outbound) — needed once outbound sending ships.
        if (!value.messages?.length) continue;

        const phoneNumberId = value.metadata?.phone_number_id;
        if (!phoneNumberId) {
          errors.add("missing_phone_number_id");
          continue;
        }
        const { data: integration, error: integrationError } = await db
          .from("integration_accounts")
          .select("id, org_id, status")
          .eq("provider", "whatsapp")
          .eq("external_account_id", phoneNumberId)
          .maybeSingle<{ id: string; org_id: string; status: string }>();
        if (integrationError) throw new Error(`integration lookup failed (${integrationError.code})`);
        if (!integration) {
          errors.add("unknown_phone_number_id");
          continue;
        }
        if (integration.status !== "connected") {
          errors.add("integration_not_connected");
          continue;
        }
        orgId = integration.org_id;

        const names = new Map((value.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? null]));

        for (const message of value.messages) {
          if (!message.id || !message.from) {
            errors.add("malformed_message");
            continue;
          }
          const normalized = normalizeMessage(message);
          if (!normalized) continue;
          const seconds = Number(message.timestamp);
          const occurredAt = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();

          const { data, error } = await db.rpc("ingest_event", {
            p_org_id: integration.org_id,
            p_channel: "whatsapp",
            p_external_id: message.from,
            p_display_name: names.get(message.from) ?? null,
            p_kind: normalized.kind,
            p_direction: "in",
            p_occurred_at: occurredAt.toISOString(),
            p_title: normalized.title,
            p_body: normalized.body,
            p_raw: message,
            p_idempotency_key: `whatsapp:${message.id}`,
            p_thread_id: `wa:${phoneNumberId}:${message.from}`,
          });
          if (error) {
            errors.add(`ingest_failed_${error.code ?? "unknown"}`);
            continue;
          }
          const row = (data as { event_id: string; created: boolean }[] | null)?.[0];
          if (row?.created) newEventIds.push(row.event_id);
        }

        await db.from("integration_accounts").update({ last_sync_at: new Date().toISOString() }).eq("id", integration.id);
      }
    }
  } catch (err) {
    errors.add(err instanceof Error ? err.message : "processing_failed");
  }

  await db
    .from("webhook_events")
    .update({
      org_id: orgId,
      processed_at: new Date().toISOString(),
      error: errors.size ? [...errors].join(", ") : null,
    })
    .eq("id", webhookEventId);

  if (errors.size) console.warn(`[${FN}] delivery ${webhookEventId}: ${[...errors].join(", ")}`);

  // Enqueue AI extraction (raw event → memory → proposed commitments).
  const results = await Promise.allSettled(newEventIds.map(invokeExtraction));
  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed) console.error(`[${FN}] ${failed} ai-extract invocation(s) failed`);
}

// ───────────── Handlers ─────────────

function verifySubscription(url: URL): Response {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  const expected = Deno.env.get("WHATSAPP_VERIFY_TOKEN");
  if (expected && mode === "subscribe" && token && challenge && timingSafeEqual(token, expected)) {
    return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

const ok = () => new Response("EVENT_RECEIVED", { status: 200 });

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") return verifySubscription(url);
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const appSecret = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!appSecret) {
    console.error(`[${FN}] WHATSAPP_APP_SECRET is not set`);
    return new Response("Not configured", { status: 500 });
  }

  const raw = new Uint8Array(await req.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

  const db = serviceClient();

  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), appSecret))) {
    // Recorded for forensics without the (untrusted) payload.
    await db.from("webhook_events").insert({
      provider: "whatsapp",
      external_id: `invalid:${crypto.randomUUID()}`,
      signature_valid: false,
      payload: null,
      processed_at: new Date().toISOString(),
      error: "invalid_signature",
    });
    console.warn(`[${FN}] rejected delivery with invalid signature`);
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: WaPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw)) as WaPayload;
  } catch {
    console.warn(`[${FN}] signed delivery with unparseable JSON`);
    return ok(); // retrying would not help
  }

  // Meta has no delivery id; retries resend identical signed bytes, so the body hash is one.
  const externalId = `sha256:${await sha256Hex(raw)}`;
  const { data: inserted, error } = await db
    .from("webhook_events")
    .insert({ provider: "whatsapp", external_id: externalId, signature_valid: true, payload })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.code === "23505") return ok(); // duplicate delivery → no-op
    console.error(`[${FN}] could not record delivery (${error.code})`);
    return new Response("Temporary failure", { status: 500 }); // Meta retries
  }

  EdgeRuntime.waitUntil(processDelivery(inserted.id, payload));
  return ok();
});
