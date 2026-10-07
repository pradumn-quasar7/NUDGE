import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import type { Commitment, Customer, ID, Settings } from '@/data/types';
import { firstName } from '@/lib/format';
import { CHANNEL_ID, getPermission, notificationsSupported } from './setup';

/**
 * Local "promise due soon" reminders. Scheduled on the device, so they work in demo mode and
 * without Firebase / a push service. One reminder per open promise I own:
 *   due in ≥ 1 h  → 1 hour before it is due
 *   due in < 1 h  → 10 minutes before (if that is still ahead)
 * Quiet hours 21:00–08:00 local time: a reminder that would land then moves to 08:30 — unless the
 * promise is due before 08:30, in which case it keeps its time (same rule as server pushes: a
 * promise due within the hour may interrupt).
 */

const STORAGE_KEY = 'nudge.reminders.v1';
const HOUR = 3_600_000;
const MIN = 60_000;
const QUIET_START_H = 21;
const QUIET_END_H = 8;
const MORNING = { h: 8, m: 30 };
/** Marker in `content.data`, so we only ever cancel what we scheduled. */
const KIND = 'reminder';

export type ReminderPlan = { commitmentId: ID; fireAt: number; dueAt: number; title: string; body: string; url: string };
type Stored = Record<ID, { notificationId: string; fireAt: number; dueAt: number; title: string; body: string }>;

function inQuietHours(at: number) {
  const h = new Date(at).getHours();
  return h >= QUIET_START_H || h < QUIET_END_H;
}

/** Next 08:30 at or after `at` (local time). */
function nextMorning(at: number) {
  const d = new Date(at);
  if (d.getHours() >= QUIET_START_H) d.setDate(d.getDate() + 1);
  d.setHours(MORNING.h, MORNING.m, 0, 0);
  return d.getTime();
}

/** When the reminder for a promise due at `dueAt` should fire, or null when it's too late for one. */
export function reminderTime(dueAt: number, now = Date.now()): number | null {
  let at = dueAt - HOUR;
  if (at <= now) at = dueAt - 10 * MIN;
  if (at <= now) return null;
  if (inQuietHours(at)) {
    const morning = nextMorning(at);
    if (morning < dueAt) at = morning;
  }
  return at;
}

/** The reminders that should exist right now. Pure — easy to reason about and test. */
export function planReminders(
  input: { commitments: Commitment[]; customers: Customer[]; me: ID; notifications: Settings['notifications'] },
  now = Date.now(),
): ReminderPlan[] {
  if (input.notifications === 'off') return [];
  const names = new Map(input.customers.map((c) => [c.id, c.name]));
  const out: ReminderPlan[] = [];
  for (const c of input.commitments) {
    if (c.status !== 'open' || c.ownerId !== input.me) continue;
    const fireAt = reminderTime(c.dueAt, now);
    if (fireAt === null) continue;
    const who = names.get(c.customerId);
    out.push({
      commitmentId: c.id,
      fireAt,
      dueAt: c.dueAt,
      title: 'Promise due soon',
      body: who ? `${c.title} — ${firstName(who)}` : c.title,
      url: `/promise/${c.id}`,
    });
  }
  return out;
}

async function load(): Promise<Stored> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : null;
    return parsed && typeof parsed === 'object' ? (parsed as Stored) : {};
  } catch {
    return {};
  }
}

async function save(map: Stored) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Losing the map only means a stale reminder may be rescheduled; orphans are swept below.
  }
}

/** Cancels scheduled notifications we created that are not in `keep`. */
async function sweepOrphans(keep: Set<string>) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(
    scheduled
      .filter((r) => (r.content.data as Record<string, unknown> | undefined)?.kind === KIND && !keep.has(r.identifier))
      .map((r) => Notifications.cancelScheduledNotificationAsync(r.identifier).catch(() => {})),
  );
}

// Runs are serialised: the store changes in bursts (Realtime reloads), and overlapping runs would
// schedule the same reminder twice.
let queue: Promise<void> = Promise.resolve();
function serial(fn: () => Promise<void>) {
  queue = queue.then(fn, fn).catch((e: unknown) => {
    console.info('[reminders] sync failed', e instanceof Error ? e.message : e);
  });
  return queue;
}

/** Makes the scheduled reminders match `plans`: cancels stale/changed ones, schedules new ones. */
export function syncReminders(plans: ReminderPlan[]) {
  return serial(async () => {
    if (!notificationsSupported) return;
    const { state } = await getPermission();
    // Without permission nothing would show; keep nothing so a later "yes" schedules fresh.
    const wanted = state === 'granted' ? plans : [];
    const map = await load();
    const byId = new Map(wanted.map((p) => [p.commitmentId, p]));
    const next: Stored = {};

    const now = Date.now();
    for (const [id, entry] of Object.entries(map)) {
      const plan = byId.get(id);
      if (entry.fireAt <= now) {
        // Already fired for this due time: keep it as a marker so the "10 minutes before"
        // fallback doesn't ping a second time. A new due time (snooze) gets a new reminder.
        if (plan && plan.dueAt === entry.dueAt) next[id] = entry;
        continue;
      }
      const same = plan && plan.fireAt === entry.fireAt && plan.title === entry.title && plan.body === entry.body;
      if (same) next[id] = entry;
      else await Notifications.cancelScheduledNotificationAsync(entry.notificationId).catch(() => {});
    }

    for (const plan of wanted) {
      if (next[plan.commitmentId] || plan.fireAt <= now) continue;
      const notificationId = await Notifications.scheduleNotificationAsync({
        content: {
          title: plan.title,
          body: plan.body,
          data: { kind: KIND, url: plan.url, commitmentId: plan.commitmentId },
          sound: 'default',
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.fireAt, channelId: CHANNEL_ID },
      });
      next[plan.commitmentId] = { notificationId, fireAt: plan.fireAt, dueAt: plan.dueAt, title: plan.title, body: plan.body };
    }

    await save(next);
    await sweepOrphans(new Set(Object.values(next).map((e) => e.notificationId)));
  });
}

/** Signed out / workspace reset: cancel every reminder we scheduled. */
export function clearReminders() {
  return serial(async () => {
    if (!notificationsSupported) return;
    const map = await load();
    await Promise.all(Object.values(map).map((e) => Notifications.cancelScheduledNotificationAsync(e.notificationId).catch(() => {})));
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    await sweepOrphans(new Set());
  });
}
