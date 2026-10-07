#!/usr/bin/env node
// End-to-end smoke test against the local harness (run ./start.sh first).
// Uses the app's own @supabase/supabase-js, pointed at http://127.0.0.1:54321.
// Exits non-zero when any check fails.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { API_URL, DATA, HERE, psql, psqlJson, userToken, ensureUser } from './lib.mjs';

// The checks mutate the seeded data, so they expect a fresh database.
// `node smoke.mjs --fresh` rebuilds it first (runs start.sh).
if (process.argv.includes('--fresh')) execFileSync(join(HERE, 'start.sh'), { stdio: ['ignore', 'ignore', 'inherit'] });

const { createClient } = await import(
  pathToFileURL(join(HERE, '../../app/node_modules/@supabase/supabase-js/dist/index.mjs')).href
);

/* ───────────── setup ───────────── */

const env = Object.fromEntries(
  readFileSync(join(DATA, 'env'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
);
const ANON = env.NUDGE_ANON_KEY;

const ORG = 'b1000000-0000-4000-8000-000000000001';
const M = { alex: 'b2000000-0000-4000-8000-000000000001', sana: 'b2000000-0000-4000-8000-000000000002', nehaInvite: 'b2000000-0000-4000-8000-000000000004' };
const C = { rahul: 'b3000000-0000-4000-8000-000000000001', priya: 'b3000000-0000-4000-8000-000000000002', aman: 'b3000000-0000-4000-8000-000000000003', kavya: 'b3000000-0000-4000-8000-000000000009' };

/** A supabase-js client acting as `token` (the task's `global.headers.Authorization` pattern). */
const clientFor = (token) =>
  createClient(API_URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

const tokenForEmail = (email) => userToken(ensureUser({ email }));
const alex = clientFor(tokenForEmail('alex@brightline.in'));
const sana = clientFor(tokenForEmail('sana@brightline.in'));
const anon = clientFor(ANON);

/* ───────────── tiny runner ───────────── */

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  ✗ ${name}\n      ${err?.message ?? err}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, what) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
/** Unwraps a supabase-js result, failing on error. */
function ok(res, what) {
  if (res.error) throw new Error(`${what}: ${res.error.code ?? ''} ${res.error.message}`);
  return res.data;
}
/** Expects a PostgREST/Postgres error (optionally with one of `codes`). */
function fails(res, what, codes) {
  if (!res.error) throw new Error(`${what}: expected an error, got ${JSON.stringify(res.data)?.slice(0, 200)}`);
  if (codes && !codes.includes(res.error.code)) throw new Error(`${what}: expected ${codes.join('|')}, got ${res.error.code} ${res.error.message}`);
}
const count = async (q, what) => (ok(await q, what) ?? []).length;

const lastCallFor = (eventId) =>
  psqlJson(
    `select row_to_json(c) from net.http_calls c where c.body ->> 'event_id' = :'id' order by id desc limit 1;`,
    { id: eventId },
  );

/* ───────────── Alex (owner): reads ───────────── */

console.log('\nAlex (owner) — reads');
const expected = { customers: 11, conversation_events: 28, commitments: 15, extractions: 3, notifications: 5, followup_suggestions: 7, integration_accounts: 6 };
for (const [table, n] of Object.entries(expected)) {
  await check(`select ${table} → ${n} rows`, async () => eq(await count(alex.from(table).select('id').eq('org_id', ORG), table), n, table));
}
await check('notification_feed shows 5 with per-member read state (2 unread)', async () => {
  const rows = ok(await alex.from('notification_feed').select('id, read, read_at, title').eq('org_id', ORG), 'feed');
  eq(rows.length, 5, 'feed rows');
  eq(rows.filter((r) => !r.read).length, 2, 'unread');
});
await check('events embed event_annotations (remote.ts EVENT_COLS)', async () => {
  const rows = ok(
    await alex.from('conversation_events').select('id, event_annotations(kind, text)').eq('customer_id', C.rahul).not('event_annotations', 'is', null),
    'events',
  );
  assert(rows.some((r) => r.event_annotations?.length), 'no annotations embedded');
});

/* ───────────── promises ───────────── */

console.log('\nPromises');
const P_PRIYA = 'b6000000-0000-4000-8000-000000000003';
await check('complete commitment → done + completed_at', async () => {
  const row = ok(await alex.from('commitments').update({ status: 'done' }).eq('id', P_PRIYA).select('status, completed_at').single(), 'complete');
  eq(row.status, 'done', 'status');
  assert(row.completed_at, 'completed_at not set');
});
await check('reopen commitment → open, completed_at cleared', async () => {
  const row = ok(await alex.from('commitments').update({ status: 'open' }).eq('id', P_PRIYA).select('status, completed_at').single(), 'reopen');
  eq([row.status, row.completed_at], ['open', null], 'status/completed_at');
});
await check('snooze commitment (snoozed_until + due_at)', async () => {
  const until = new Date(Date.now() + 3 * 86400_000).toISOString();
  const row = ok(await alex.from('commitments').update({ status: 'open', snoozed_until: until, due_at: until }).eq('id', P_PRIYA).select('snoozed_until').single(), 'snooze');
  assert(row.snoozed_until, 'snoozed_until');
});
await check('hand off commitment to Sana (active member)', async () => {
  const row = ok(await alex.from('commitments').update({ owner_member_id: M.sana }).eq('id', 'b6000000-0000-4000-8000-000000000004').select('owner_member_id').single(), 'hand off');
  eq(row.owner_member_id, M.sana, 'owner');
});
await check('hand off to an invited (inactive) member is rejected', async () => {
  fails(await alex.from('commitments').update({ owner_member_id: M.nehaInvite }).eq('id', 'b6000000-0000-4000-8000-000000000004'), 'hand off invite', ['23514']);
});
await check('Sana (member) can complete a teammate promise when sharing is on', async () => {
  ok(await sana.from('commitments').update({ status: 'done' }).eq('id', 'b6000000-0000-4000-8000-000000000008').select('id').single(), 'sana complete');
  ok(await sana.from('commitments').update({ status: 'open' }).eq('id', 'b6000000-0000-4000-8000-000000000008').select('id').single(), 'sana reopen');
});

/* ───────────── extractions ───────────── */

console.log('\nAI suggestions');
const X_KAVYA = 'b7000000-0000-4000-8000-000000000002';
let kavyaCommitment;
await check('confirm_extraction RPC → commitment owned by caller + facts', async () => {
  kavyaCommitment = ok(
    await alex.rpc('confirm_extraction', {
      extraction_id: X_KAVYA,
      fields: [
        { key: 'interest', label: 'Interest', value: 'Premium finish', checked: true },
        { key: 'budget', label: 'Budget', value: 'around ₹70,000', checked: false },
      ],
      due_at: null,
      title: null,
    }),
    'confirm',
  );
  const c = ok(await alex.from('commitments').select('owner_member_id, created_by_member_id, extraction_id, title').eq('id', kavyaCommitment).single(), 'commitment');
  eq([c.owner_member_id, c.created_by_member_id, c.extraction_id], [M.alex, M.alex, X_KAVYA], 'commitment links');
  const x = ok(await alex.from('extractions').select('status, commitment_id, decided_by_member_id').eq('id', X_KAVYA).single(), 'extraction');
  eq([x.status, x.commitment_id, x.decided_by_member_id], ['confirmed', kavyaCommitment, M.alex], 'extraction decision');
  eq(await count(alex.from('customer_facts').select('id').eq('customer_id', C.kavya).eq('text', 'Interest: Premium finish'), 'facts'), 1, 'facts written');
});
await check('confirm_extraction is idempotent', async () => {
  eq(ok(await alex.rpc('confirm_extraction', { extraction_id: X_KAVYA }), 'reconfirm'), kavyaCommitment, 'same commitment');
});
await check('ignore an extraction (direct update)', async () => {
  const row = ok(await alex.from('extractions').update({ status: 'ignored' }).eq('id', 'b7000000-0000-4000-8000-000000000003').select('status, decided_by_member_id').single(), 'ignore');
  eq([row.status, row.decided_by_member_id], ['ignored', M.alex], 'ignored');
});

/* ───────────── capture + ai-extract trigger ───────────── */

console.log('\nCapture → ai-extract via pg_net');
let noteId;
await check('insert note event → pg_net call to ai-extract recorded', async () => {
  const row = ok(
    await alex
      .from('conversation_events')
      .insert({ org_id: ORG, customer_id: C.rahul, kind: 'note', channel: 'manual', direction: 'internal', title: 'Note', body: 'Will send the revised quote by Friday.', author_member_id: M.alex })
      .select('id')
      .single(),
    'insert note',
  );
  noteId = row.id;
  const call = lastCallFor(noteId);
  assert(call, 'no net.http_calls row for the note');
  eq(call.url, `${API_URL}/functions/v1/ai-extract`, 'url');
  eq(call.body, { event_id: noteId }, 'body');
  eq(call.headers.Authorization, `Bearer ${env.NUDGE_SERVICE_ROLE_KEY}`, 'Authorization header');
});
await check('outbound reply (message, out, authored) → inserted + enqueued', async () => {
  const row = ok(
    await alex
      .from('conversation_events')
      .insert({ org_id: ORG, customer_id: C.priya, kind: 'message', channel: 'whatsapp', direction: 'out', title: 'You replied', body: 'Delivery confirmed for Thursday 11 am.', author_member_id: M.alex })
      .select('id, direction, author_member_id')
      .single(),
    'insert reply',
  );
  eq([row.direction, row.author_member_id], ['out', M.alex], 'reply row');
  assert(lastCallFor(row.id), 'reply not enqueued');
});
await check('event without author (fake inbound message) is rejected', async () => {
  fails(await alex.from('conversation_events').insert({ org_id: ORG, customer_id: C.rahul, kind: 'message', channel: 'whatsapp', direction: 'in', title: 'Fake', body: 'x' }), 'unauthored', ['42501']);
});
await check('event authored as someone else is rejected', async () => {
  fails(await alex.from('conversation_events').insert({ org_id: ORG, customer_id: C.rahul, kind: 'note', channel: 'manual', direction: 'internal', title: 'Note', body: 'x', author_member_id: M.sana }), 'impersonation', ['42501']);
});
await check('events are immutable (update rejected)', async () => {
  fails(await alex.from('conversation_events').update({ body: 'edited' }).eq('id', noteId), 'update event', ['42501']);
});
await check('commitment from a voice capture (direct insert, source = my note)', async () => {
  const row = ok(
    await alex
      .from('commitments')
      .insert({ org_id: ORG, customer_id: C.rahul, title: 'Send revised quote', owner_member_id: M.alex, due_at: new Date(Date.now() + 2 * 86400_000).toISOString(), promisor: 'us', source_event_id: noteId, quote: 'Will send the revised quote by Friday.', quote_by: 'You', confidence: 0.85 })
      .select('created_by_member_id, source_event_id')
      .single(),
    'insert commitment',
  );
  eq([row.created_by_member_id, row.source_event_id], [M.alex, noteId], 'commitment links');
});
await check('commitment whose source event is another customer’s is rejected', async () => {
  fails(await alex.from('commitments').insert({ org_id: ORG, customer_id: C.aman, title: 'x', owner_member_id: M.alex, due_at: new Date().toISOString(), source_event_id: noteId }), 'cross-customer', ['23514']);
});
await check('save_capture RPC → event + promise + facts atomically, enqueued', async () => {
  const res = ok(
    await alex.rpc('save_capture', {
      customer_id: C.aman,
      body: 'Aman needs 50 units by the 28th; I will send the payment link today.',
      kind: 'voice',
      promise_title: 'Send payment link to Aman.',
      promise_due_at: new Date(Date.now() + 6 * 3600_000).toISOString(),
      facts: ['Needs 50 units by the 28th', '  '],
    }),
    'save_capture',
  );
  assert(res.event_id && res.commitment_id, 'ids missing');
  eq(res.fact_ids.length, 1, 'fact count');
  const ev = ok(await alex.from('conversation_events').select('title, author_member_id').eq('id', res.event_id).single(), 'event');
  eq([ev.title, ev.author_member_id], ['Voice note', M.alex], 'event');
  const c = ok(await alex.from('commitments').select('title, source_event_id, owner_member_id').eq('id', res.commitment_id).single(), 'commitment');
  eq([c.title, c.source_event_id, c.owner_member_id], ['Send payment link to Aman', res.event_id, M.alex], 'commitment');
  assert(lastCallFor(res.event_id), 'capture not enqueued');
});

/* ───────────── inbox, notifications ───────────── */

console.log('\nInbox + notifications');
await check('resolve followup_suggestion (bucket done + resolved_at)', async () => {
  const row = ok(await alex.from('followup_suggestions').update({ bucket: 'done', resolved_at: new Date().toISOString() }).eq('id', 'b9000000-0000-4000-8000-000000000001').select('bucket, resolved_at').single(), 'resolve');
  eq(row.bucket, 'done', 'bucket');
});
await check('suggestion text is not client-writable', async () => {
  fails(await alex.from('followup_suggestions').update({ what: 'hacked' }).eq('id', 'b9000000-0000-4000-8000-000000000002'), 'edit what', ['42501']);
});
const N1 = 'b8000000-0000-4000-8000-000000000001';
await check('mark_notifications_read([id]) is per member', async () => {
  eq(ok(await alex.rpc('mark_notifications_read', { ids: [N1] }), 'mark'), 1, 'marked');
  eq(ok(await alex.rpc('mark_notifications_read', { ids: [N1] }), 'mark again'), 0, 'idempotent');
  const mine = ok(await alex.from('notification_feed').select('read').eq('id', N1).single(), 'alex feed');
  const hers = ok(await sana.from('notification_feed').select('read').eq('id', N1).single(), 'sana feed');
  eq([mine.read, hers.read], [true, false], 'alex read / sana unread');
});
await check('mark_notifications_read() marks the rest for Sana only', async () => {
  eq(ok(await sana.rpc('mark_notifications_read', { org_id: ORG }), 'mark all'), 2, 'sana marked');
  eq(await count(sana.from('notification_feed').select('id').eq('read', false), 'sana unread'), 0, 'sana unread');
  eq(await count(alex.from('notification_feed').select('id').eq('read', false), 'alex unread'), 1, 'alex unread');
});
await check('shared notifications.read_at is no longer client-writable', async () => {
  fails(await alex.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', N1), 'update read_at', ['42501']);
});

/* ───────────── customers, facts ───────────── */

console.log('\nCustomers + memory');
await check('archive / unarchive customer', async () => {
  ok(await alex.from('customers').update({ archived_at: new Date().toISOString() }).eq('id', C.kavya).select('id').single(), 'archive');
  eq(await count(alex.from('customers').select('id').eq('org_id', ORG).is('archived_at', null), 'active'), 10, 'active customers');
  ok(await alex.from('customers').update({ archived_at: null }).eq('id', C.kavya).select('id').single(), 'unarchive');
});
// 12 customers from here on (11 seeded + this one, owned by Sana).
await check('add customer (member, insert … returning)', async () => {
  const row = ok(await sana.from('customers').insert({ org_id: ORG, name: 'Test Customer', preferred_channel: 'whatsapp', headline: 'New customer', owner_member_id: M.sana }).select('id, owner_member_id').single(), 'add customer');
  eq(row.owner_member_id, M.sana, 'owner');
});
await check('customers cannot be moved to another workspace (org_id not updatable)', async () => {
  fails(await alex.from('customers').update({ org_id: '00000000-0000-4000-8000-000000000000' }).eq('id', C.kavya), 'move', ['42501']);
});
const F_PRICE = 'b5000000-0000-4000-8000-000000000004';
await check('forget_fact → hidden from live facts, kept as tombstone; unforget_fact undoes', async () => {
  assert(ok(await sana.rpc('forget_fact', { fact_id: F_PRICE }), 'forget'), 'forgotten_at');
  eq(await count(alex.from('customer_facts').select('id').eq('id', F_PRICE).is('forgotten_at', null), 'live'), 0, 'live after forget');
  const row = ok(await alex.from('customer_facts').select('forgotten_by_member_id').eq('id', F_PRICE).single(), 'tombstone');
  eq(row.forgotten_by_member_id, M.sana, 'forgotten by');
  ok(await sana.rpc('unforget_fact', { fact_id: F_PRICE }), 'unforget');
  eq(await count(alex.from('customer_facts').select('id').eq('id', F_PRICE).is('forgotten_at', null), 'live'), 1, 'live after undo');
});
await check('members cannot hard-delete facts (members_can_delete = false)', async () => {
  eq(await count(sana.from('customer_facts').delete().eq('id', F_PRICE).select('id'), 'delete'), 0, 'deleted rows');
});

/* ───────────── workspace (owner) ───────────── */

console.log('\nWorkspace (owner only)');
await check('owner updates sells / handles / channels directly', async () => {
  const row = ok(await alex.from('organizations').update({ sells: 'Display fixtures', handles: ['Custom orders'], channels: ['whatsapp', 'email'] }).eq('id', ORG).select('sells, channels').single(), 'org update');
  eq(row.channels, ['whatsapp', 'email'], 'channels');
});
await check('member cannot update the workspace (0 rows)', async () => {
  eq(await count(sana.from('organizations').update({ sells: 'nope' }).eq('id', ORG).select('id'), 'sana update'), 0, 'rows');
});
await check('plan is not client-writable', async () => {
  fails(await alex.from('organizations').update({ plan: 'pro' }).eq('id', ORG), 'plan', ['42501']);
});
await check('update_workspace_settings merges a patch', async () => {
  const s = ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { members_can_delete: true, notifications: 'all' } }), 'settings');
  eq([s.members_can_delete, s.notifications, s.share_all_customers], [true, 'all', true], 'merged');
  ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { members_can_delete: false } }), 'reset');
});
await check('update_workspace_settings rejects members, unknown keys and bad values', async () => {
  fails(await sana.rpc('update_workspace_settings', { org_id: ORG, patch: { members_can_delete: true } }), 'member', ['42501']);
  fails(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { plan: 'pro' } }), 'unknown key', ['22023']);
  fails(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { notifications: 'loud' } }), 'bad value', ['23514']);
  fails(await alex.from('organizations').update({ settings: { share_all_customers: 'yes' } }).eq('id', ORG), 'direct bad settings', ['23514']);
});
await check('share_all_customers = false → members see only customers they own', async () => {
  ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: false } }), 'private');
  try {
    eq(await count(sana.from('customers').select('id').eq('org_id', ORG), 'sana customers'), 1, 'sana sees only the customer she owns');
    eq(await count(sana.from('commitments').select('id').eq('org_id', ORG), 'sana commitments'), 0, 'sana commitments');
    eq(await count(alex.from('customers').select('id').eq('org_id', ORG), 'alex customers'), 12, 'owner still sees all');
  } finally {
    ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: true } }), 'shared');
  }
});
await check('integration status: owner pauses / reconnects', async () => {
  const row = ok(await alex.from('integration_accounts').update({ status: 'paused', detail: 'Paused by you' }).eq('id', 'ba000000-0000-4000-8000-000000000003').select('status').single(), 'pause');
  eq(row.status, 'paused', 'status');
  ok(await alex.from('integration_accounts').update({ status: 'connected', last_sync_at: new Date().toISOString() }).eq('id', 'ba000000-0000-4000-8000-000000000003').select('id').single(), 'reconnect');
});
await check('integration routing/secret columns are not client-writable', async () => {
  fails(await alex.from('integration_accounts').update({ external_account_id: '999' }).eq('id', 'ba000000-0000-4000-8000-000000000002'), 'external id', ['42501']);
  fails(await alex.from('integration_accounts').update({ token_secret_id: '00000000-0000-4000-8000-000000000000' }).eq('id', 'ba000000-0000-4000-8000-000000000002'), 'token', ['42501']);
});
await check('member cannot change integrations (0 rows)', async () => {
  eq(await count(sana.from('integration_accounts').update({ status: 'paused' }).eq('id', 'ba000000-0000-4000-8000-000000000003').select('id'), 'sana'), 0, 'rows');
});

/* ───────────── team ───────────── */

console.log('\nTeam');
await check('invite_member RPC (owner) → invited row with invited_at/by', async () => {
  const row = ok(await alex.rpc('invite_member', { org_id: ORG, email: '  Kiran@Brightline.in ' }), 'invite');
  eq([row.email, row.status, row.user_id, row.role, row.name], ['kiran@brightline.in', 'invited', null, 'member', 'kiran@brightline.in'], 'row');
  assert(row.invited_at && row.invited_by === 'a1000000-0000-4000-8000-000000000001', 'invited_at/by');
});
await check('duplicate invite → 23505; member invite → 42501; bad email → 22023', async () => {
  fails(await alex.rpc('invite_member', { org_id: ORG, email: 'kiran@brightline.in' }), 'dup', ['23505']);
  fails(await sana.rpc('invite_member', { org_id: ORG, email: 'x@y.in' }), 'member', ['42501']);
  fails(await alex.rpc('invite_member', { org_id: ORG, email: 'not-an-email' }), 'email', ['22023']);
});
await check('plain insert of an invited row also works (status invited)', async () => {
  ok(await alex.from('organization_members').insert({ org_id: ORG, email: 'lee@brightline.in', name: 'lee@brightline.in', role: 'member', status: 'invited', invited_at: new Date().toISOString() }), 'insert invite');
  fails(await alex.from('organization_members').insert({ org_id: ORG, email: 'lee2@brightline.in', name: 'x', status: 'active' }), 'active insert', ['42501']);
});
await check('owner cannot force an active membership onto an arbitrary user', async () => {
  fails(await alex.from('organization_members').insert({ org_id: ORG, name: 'x', email: 'x@x.in', status: 'active', user_id: 'a1000000-0000-4000-8000-000000000003' }), 'forced insert', ['42501']);
  fails(await alex.from('organization_members').update({ user_id: 'a1000000-0000-4000-8000-000000000003' }).eq('id', M.nehaInvite), 'forced link', ['42501']);
});
await check('owner changes a teammate role/title, removes an invite; last owner is protected', async () => {
  ok(await alex.from('organization_members').update({ title: 'Head of Sales' }).eq('id', M.sana).select('id').single(), 'title');
  eq(await count(sana.from('organization_members').update({ title: 'Boss' }).eq('id', M.sana).select('id'), 'self edit'), 0, 'member edits nothing');
  eq(await count(alex.from('organization_members').delete().eq('email', 'lee@brightline.in').select('id'), 'remove invite'), 1, 'removed');
  fails(await alex.from('organization_members').update({ role: 'member' }).eq('id', M.alex), 'demote last owner', ['23514']);
});
await check('existing account accepts an invite via accept_member_invites()', async () => {
  const pat = clientFor(tokenForEmail('pat@existing.test'));
  eq(await count(pat.from('customers').select('id'), 'pat before'), 0, 'pat sees nothing before');
  ok(await alex.rpc('invite_member', { org_id: ORG, email: 'pat@existing.test', name: 'Pat' }), 'invite pat');
  eq(ok(await pat.rpc('accept_member_invites'), 'accept'), 1, 'linked');
  eq(await count(pat.from('customers').select('id'), 'pat after'), 12, 'pat sees the workspace');
});

/* ───────────── auth stub + another tenant ───────────── */

console.log('\nAnother workspace (tenant isolation) via the /auth/v1 stub');
const outsider = createClient(API_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const email = `mallory+${Date.now()}@outside.test`;
await check('sign up + getUser through /auth/v1', async () => {
  const { data, error } = await outsider.auth.signUp({ email, password: 'local-test-pw', options: { data: { full_name: 'Mallory' } } });
  if (error) throw error;
  assert(data.session?.access_token, 'no session');
  const me = await outsider.auth.getUser();
  eq(me.data.user?.email, email, 'getUser email');
});
await check('outsider creates own workspace via create_organization', async () => {
  const id = ok(await outsider.rpc('create_organization', { name: 'Outside Traders', sells: 'Everything' }), 'create org');
  eq(await count(outsider.from('organizations').select('id'), 'orgs'), 1, 'sees only own org');
  assert(id !== ORG, 'different org');
});
for (const table of ['customers', 'conversation_events', 'commitments', 'extractions', 'notification_feed', 'followup_suggestions', 'integration_accounts', 'customer_facts', 'notification_reads']) {
  await check(`outsider sees no Brightline ${table}`, async () => eq(await count(outsider.from(table).select('*').eq('org_id', ORG), table), 0, table));
}
await check('outsider sees no Brightline members', async () => eq(await count(outsider.from('organization_members').select('id').eq('org_id', ORG), 'members'), 0, 'members'));
await check('outsider cannot write Brightline data', async () => {
  eq(await count(outsider.from('commitments').update({ status: 'done' }).eq('org_id', ORG).select('id'), 'update'), 0, 'updated rows');
  fails(await outsider.rpc('confirm_extraction', { extraction_id: 'b7000000-0000-4000-8000-000000000003' }), 'confirm', ['P0002', '42501']);
  fails(await outsider.from('conversation_events').insert({ org_id: ORG, customer_id: C.rahul, kind: 'note', channel: 'manual', direction: 'internal', title: 'x', body: 'x' }), 'insert event', ['42501']);
  fails(await outsider.rpc('invite_member', { org_id: ORG, email: 'evil@outside.test' }), 'invite', ['42501']);
  eq(ok(await outsider.rpc('mark_notifications_read', { org_id: ORG }), 'mark'), 0, 'marked');
});
await check('password sign-in for a seeded demo account', async () => {
  const c = createClient(API_URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword({ email: 'ravi@brightline.in', password: env.NUDGE_DEMO_PASSWORD });
  if (error) throw error;
  eq(await count(c.from('customers').select('id').eq('org_id', ORG), 'ravi customers'), 12, 'ravi sees workspace');
});
await check('anon key reads nothing', async () => {
  fails(await anon.from('customers').select('id'), 'anon customers', ['42501']);
});
await check('/functions/v1 answers 501 locally', async () => {
  const res = await fetch(`${API_URL}/functions/v1/copilot`, { method: 'POST' });
  eq(res.status, 501, 'status');
});

/* ───────────── trigger fail-safe ───────────── */

console.log('\nai-extract trigger without secrets');
await check('insert still succeeds and nothing is enqueued when vault secrets are missing', async () => {
  psql(`update vault.secrets set name = 'service_role_key_off' where name = 'service_role_key';`);
  try {
    const row = ok(
      await alex.from('conversation_events').insert({ org_id: ORG, customer_id: C.rahul, kind: 'note', channel: 'manual', direction: 'internal', title: 'Note', body: 'no secrets', author_member_id: M.alex }).select('id').single(),
      'insert',
    );
    assert(!lastCallFor(row.id), 'call recorded without secrets');
  } finally {
    psql(`update vault.secrets set name = 'service_role_key' where name = 'service_role_key_off';`);
  }
});
await check('seeded webhook-style events (no author) never enqueue', async () => {
  eq(Number(psql(`select count(*) from net.http_calls c join public.conversation_events e on e.id = (c.body->>'event_id')::uuid where e.author_member_id is null;`)), 0, 'calls');
});

/* ───────────── result ───────────── */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
