// Storage purge (invoked by purge_customer() / delete_workspace() via pg_net, and hourly by pg_cron).
//
//   public.storage_purge_queue (pending rows) → Storage API remove() per bucket → done_at
//
// File bytes can only be removed through the Storage API: deleting storage.objects rows
// in SQL orphans the file (and is refused on hosted projects). The SQL side queues the
// paths and hides them from users at once; this function does the actual removal.
// Removing an object that is already gone counts as done.
//
// Internal endpoint: POST {} with the service-role key. Logs counts and error codes only.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { requireServiceRole } from "../_shared/auth.ts";
import { errorResponse, HttpError, json } from "../_shared/cors.ts";
import { serviceClient } from "../_shared/supabase.ts";

const FN = "storage-purge";
const BUCKETS = new Set(["voice-notes", "attachments"]);
const BATCH = 500; // queue rows per invocation
const CHUNK = 100; // paths per remove() call
const MAX_ATTEMPTS = 10;

type QueueRow = { id: number; bucket_id: string; object_name: string; attempts: number };

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") throw new HttpError(405, "method_not_allowed");
    await requireServiceRole(req);
    const db = serviceClient();

    const { data: rows, error } = await db
      .from("storage_purge_queue")
      .select("id, bucket_id, object_name, attempts")
      .is("done_at", null)
      .lt("attempts", MAX_ATTEMPTS)
      .order("id")
      .limit(BATCH)
      .returns<QueueRow[]>();
    if (error) throw new HttpError(500, "queue_read_failed");

    let removed = 0;
    let failed = 0;
    const byBucket = new Map<string, QueueRow[]>();
    for (const r of rows ?? []) {
      if (!BUCKETS.has(r.bucket_id)) {
        // Never touch buckets this app doesn't own; park the row.
        await db.from("storage_purge_queue").update({ attempts: MAX_ATTEMPTS, last_error: "bucket_not_allowed" }).eq("id", r.id);
        failed++;
        continue;
      }
      byBucket.set(r.bucket_id, [...(byBucket.get(r.bucket_id) ?? []), r]);
    }

    for (const [bucket, list] of byBucket) {
      for (let i = 0; i < list.length; i += CHUNK) {
        const chunk = list.slice(i, i + CHUNK);
        const ids = chunk.map((r) => r.id);
        const { error: removeError } = await db.storage.from(bucket).remove(chunk.map((r) => r.object_name));
        if (removeError) {
          failed += chunk.length;
          console.error(`[${FN}] remove failed in ${bucket}: ${removeError.name}`);
          for (const r of chunk) {
            await db
              .from("storage_purge_queue")
              .update({ attempts: r.attempts + 1, last_error: removeError.name.slice(0, 120) })
              .eq("id", r.id);
          }
          continue;
        }
        const { error: doneError } = await db
          .from("storage_purge_queue")
          .update({ done_at: new Date().toISOString(), last_error: null })
          .in("id", ids);
        if (doneError) console.error(`[${FN}] could not mark ${ids.length} rows done: ${doneError.code}`);
        removed += chunk.length;
      }
    }

    return json({ processed: (rows ?? []).length, removed, failed, more: (rows ?? []).length === BATCH });
  } catch (err) {
    return errorResponse(FN, err);
  }
});
