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

/* ───────────── voice notes: Storage bucket + save_capture(audio_path) ───────────── */

console.log('\nVoice notes (Storage policies run as the user via psql; save_capture via supabase-js)');
const U = { alex: 'a1000000-0000-4000-8000-000000000001', sana: 'a1000000-0000-4000-8000-000000000002' };
/** Runs `sql` as an authenticated user, like the Storage API does (role + JWT claims, RLS on). */
const asUser = (uid, sql, vars = {}) =>
  psql(
    `begin;
     set local "request.jwt.claims" = :'claims';
     set local role authenticated;
     ${sql}
     commit;`,
    { claims: JSON.stringify({ sub: uid, role: 'authenticated' }), ...vars },
  );
/** Expects an RLS refusal (Postgres 42501 "new row violates row-level security policy"). */
const rlsRefused = (fn, what) => {
  try {
    fn();
  } catch (err) {
    if (/row-level security|permission denied/i.test(String(err.stderr ?? err.message))) return;
    throw new Error(`${what}: unexpected error ${String(err.stderr ?? err.message).trim()}`);
  }
  throw new Error(`${what}: expected an RLS refusal`);
};
const putObject = (uid, name, size = 41234) =>
  asUser(
    uid,
    `insert into storage.objects (bucket_id, name, owner, metadata)
     values ('voice-notes', :'name', :'uid'::uuid, jsonb_build_object('size', :'size'::bigint, 'mimetype', 'audio/mp4'));`,
    { name, uid, size },
  );
const visibleObjects = (uid, name) => Number(asUser(uid, `select count(*) from storage.objects where bucket_id = 'voice-notes' and name = :'name';`, { name }));
const voicePath = (org, member) => `${org}/${member}/${crypto.randomUUID()}.m4a`;
const alexVoice = voicePath(ORG, M.alex);
const alexSpare = voicePath(ORG, M.alex);
let outsiderUid;
let outsiderOrg;

await check('voice-notes bucket exists: private, 15 MiB, audio/* only', async () => {
  const b = psqlJson(`select row_to_json(b) from storage.buckets b where id = 'voice-notes';`);
  assert(b, 'bucket missing');
  eq([b.public, Number(b.file_size_limit), b.allowed_mime_types], [false, 15728640, ['audio/*']], 'bucket');
});
await check('member uploads + reads own recording at {org}/{member}/{uuid}.m4a', async () => {
  putObject(U.alex, alexVoice);
  putObject(U.alex, alexSpare);
  eq(visibleObjects(U.alex, alexVoice), 1, 'alex sees own object');
});
await check('teammate cannot read or write another member’s folder', async () => {
  eq(visibleObjects(U.sana, alexVoice), 0, 'sana sees alex object');
  rlsRefused(() => putObject(U.sana, voicePath(ORG, M.alex)), 'sana writes into alex folder');
  rlsRefused(() => putObject(U.alex, voicePath(ORG, M.sana)), 'alex writes into sana folder');
});
await check('bad shapes are refused (no member folder, extra folder, other bucket path)', async () => {
  rlsRefused(() => putObject(U.alex, `${ORG}/${crypto.randomUUID()}.m4a`), 'org-only path');
  rlsRefused(() => putObject(U.alex, `${ORG}/${M.alex}/x/${crypto.randomUUID()}.m4a`), 'nested path');
  rlsRefused(() => putObject(U.alex, `${M.alex}/${ORG}/${crypto.randomUUID()}.m4a`), 'swapped folders');
});
await check('another workspace cannot write or read Brightline recordings, and vice versa', async () => {
  outsiderUid = (await outsider.auth.getUser()).data.user?.id;
  assert(outsiderUid, 'outsider user');
  const mine = ok(await outsider.from('organization_members').select('id, org_id').eq('user_id', outsiderUid).single(), 'outsider member');
  outsiderOrg = mine.org_id;
  putObject(outsiderUid, voicePath(outsiderOrg, mine.id)); // own folder works
  rlsRefused(() => putObject(outsiderUid, voicePath(ORG, mine.id)), 'outsider → Brightline org folder');
  rlsRefused(() => putObject(outsiderUid, voicePath(ORG, M.alex)), 'outsider → Alex folder');
  eq(visibleObjects(outsiderUid, alexVoice), 0, 'outsider sees alex object');
  rlsRefused(() => putObject(U.alex, voicePath(outsiderOrg, mine.id)), 'alex → outsider folder');
});
await check('recordings cannot be overwritten (no UPDATE policy)', async () => {
  eq(Number(asUser(U.alex, `with u as (update storage.objects set metadata = '{}' where name = :'name' returning 1) select count(*) from u;`, { name: alexVoice })), 0, 'updated rows');
});
let voiceCapture;
await check('save_capture(audio_path) → note + attachments row linked to the event', async () => {
  voiceCapture = ok(
    await alex.rpc('save_capture', {
      customer_id: C.priya,
      body: 'Priya ko kal tak 20 units chahiye, I will confirm the delivery slot tomorrow.',
      kind: 'voice',
      promise_title: 'Confirm delivery slot with Priya',
      audio_path: alexVoice,
    }),
    'save_capture voice',
  );
  assert(voiceCapture.event_id && voiceCapture.commitment_id && voiceCapture.attachment_id, 'ids missing');
  const a = ok(
    await alex.from('attachments').select('event_id, customer_id, storage_bucket, storage_path, mime_type, size_bytes, uploaded_by_member_id').eq('id', voiceCapture.attachment_id).single(),
    'attachment',
  );
  eq(
    [a.event_id, a.customer_id, a.storage_bucket, a.storage_path, a.mime_type, Number(a.size_bytes), a.uploaded_by_member_id],
    [voiceCapture.event_id, C.priya, 'voice-notes', alexVoice, 'audio/mp4', 41234, M.alex],
    'attachment row',
  );
  const ev = ok(await alex.from('conversation_events').select('title').eq('id', voiceCapture.event_id).single(), 'event');
  eq(ev.title, 'Voice note', 'event title');
});
await check('save_capture without audio_path still works (attachment_id null)', async () => {
  const res = ok(await alex.rpc('save_capture', { customer_id: C.aman, body: 'Called Aman, all good.' }), 'save_capture note');
  assert(res.event_id, 'event id');
  eq([res.attachment_id, res.commitment_id], [null, null], 'no attachment / promise');
});
await check('save_capture rejects someone else’s or a missing recording (nothing saved)', async () => {
  const before = await count(sana.from('conversation_events').select('id').eq('customer_id', C.rahul), 'events before');
  fails(await sana.rpc('save_capture', { customer_id: C.rahul, body: 'x', kind: 'voice', audio_path: alexSpare }), 'other member path', ['22023']);
  fails(await alex.rpc('save_capture', { customer_id: C.rahul, body: 'x', kind: 'voice', audio_path: `${ORG}/${M.alex}/../${M.sana}/a.m4a` }), 'traversal', ['22023']);
  fails(await alex.rpc('save_capture', { customer_id: C.rahul, body: 'x', kind: 'voice', audio_path: voicePath(ORG, M.alex) }), 'missing object', ['P0002']);
  fails(await alex.rpc('save_capture', { customer_id: C.rahul, body: 'x', kind: 'voice', audio_path: alexVoice }), 'already linked', ['23505']);
  eq(await count(sana.from('conversation_events').select('id').eq('customer_id', C.rahul), 'events after'), before, 'no events written');
});
await check('a saved recording cannot be deleted by the client; an unsaved one can', async () => {
  const del = (name) => Number(asUser(U.alex, `with d as (delete from storage.objects where bucket_id = 'voice-notes' and name = :'name' returning 1) select count(*) from d;`, { name }));
  eq(del(alexVoice), 0, 'linked recording deleted');
  eq(Number(asUser(U.sana, `with d as (delete from storage.objects where name = :'name' returning 1) select count(*) from d;`, { name: alexSpare })), 0, 'teammate deleted it');
  eq(del(alexSpare), 1, 'unsaved recording deleted');
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

/* ═════════════ push notifications (migration 20261007000007_push) ═════════════ */
// Self-contained section: own helpers and ids (prefixed `push`), so it merges cleanly with others.

console.log('\nPush notifications (push_tokens, register/unregister RPCs, notifications → push-dispatch)');
const PUSH = {
  alexTok: 'ExponentPushToken[smoke-alex-device]',
  spareTok: 'ExponentPushToken[smoke-alex-spare]',
  directTok: 'ExpoPushToken[smoke-direct]',
  alexUser: 'a1000000-0000-4000-8000-000000000001',
  sanaUser: 'a1000000-0000-4000-8000-000000000002',
};
const pushRows = (client) => client.from('push_tokens').select('id, org_id, member_id, user_id, token, platform, device_name, local_reminders, disabled_at, last_seen_at');
/** Inserts a notification as the service would (superuser, like the scheduler's service role); returns its id. */
const pushNotify = ({ recipient = null, kind = 'promise_due', readAt = null } = {}) =>
  psql(
    `insert into public.notifications (org_id, recipient_member_id, kind, title, meta, read_at)
     values (:'org', nullif(:'recipient', '')::uuid, :'kind'::public.notification_kind, '[{"t":"Promise due in 45 min: "},{"t":"Send quote","b":true}]', 'Promise Radar', nullif(:'read_at', '')::timestamptz)
     returning id;`,
    { org: ORG, recipient: recipient ?? '', kind, read_at: readAt ?? '' },
  );
const pushCallFor = (notificationId) =>
  psqlJson(`select row_to_json(c) from net.http_calls c where c.body ->> 'notification_id' = :'id' order by id desc limit 1;`, { id: notificationId });
let pushAlexId;
let pushOutsiderOrg;

await check('register_push_token → own row (member, user, platform, local_reminders)', async () => {
  pushAlexId = ok(await alex.rpc('register_push_token', { org_id: ORG, token: PUSH.alexTok, platform: 'ios', device_name: 'Alex’s iPhone', local_reminders: true }), 'register');
  const rows = ok(await pushRows(alex), 'alex tokens');
  eq(rows.length, 1, 'rows');
  eq([rows[0].id, rows[0].member_id, rows[0].user_id, rows[0].platform, rows[0].local_reminders, rows[0].disabled_at], [pushAlexId, M.alex, PUSH.alexUser, 'ios', true, null], 'row');
});
await check('register_push_token again is an upsert (same id, updated device name, last_seen_at)', async () => {
  const before = ok(await pushRows(alex).eq('id', pushAlexId).single(), 'before');
  eq(ok(await alex.rpc('register_push_token', { org_id: ORG, token: PUSH.alexTok, platform: 'ios', device_name: 'Alex iPhone 17' }), 'again'), pushAlexId, 'same id');
  const after = ok(await pushRows(alex).eq('id', pushAlexId).single(), 'after');
  eq([after.device_name, after.local_reminders], ['Alex iPhone 17', false], 'updated');
  assert(new Date(after.last_seen_at) >= new Date(before.last_seen_at), 'last_seen_at not bumped');
  eq(Number(psql(`select count(*) from public.push_tokens where token = :'t';`, { t: PUSH.alexTok })), 1, 'one row per token');
});
await check('register_push_token re-enables a disabled token', async () => {
  psql(`update public.push_tokens set disabled_at = now(), disabled_reason = 'DeviceNotRegistered' where id = :'id';`, { id: pushAlexId });
  ok(await alex.rpc('register_push_token', { org_id: ORG, token: PUSH.alexTok, platform: 'ios' }), 're-register');
  const row = ok(await pushRows(alex).eq('id', pushAlexId).single(), 'row');
  eq([row.disabled_at], [null], 'enabled again');
  eq(psql(`select coalesce(disabled_reason, 'null') from public.push_tokens where id = :'id';`, { id: pushAlexId }), 'null', 'reason cleared');
});
await check('push_tokens RLS: teammates cannot see, change or delete my token', async () => {
  eq(await count(pushRows(sana), 'sana select'), 0, 'sana sees');
  eq(await count(sana.from('push_tokens').update({ device_name: 'mine now' }).eq('id', pushAlexId).select('id'), 'sana update'), 0, 'sana updated');
  eq(await count(sana.from('push_tokens').delete().eq('id', pushAlexId).select('id'), 'sana delete'), 0, 'sana deleted');
  fails(await anon.from('push_tokens').select('id'), 'anon', ['42501']);
});
await check('push_tokens direct insert: own membership only, user_id not client-writable', async () => {
  fails(await alex.from('push_tokens').insert({ org_id: ORG, member_id: M.sana, token: PUSH.directTok, platform: 'android' }), 'insert for Sana', ['42501', '23514']);
  fails(await alex.from('push_tokens').insert({ org_id: ORG, member_id: M.alex, user_id: PUSH.sanaUser, token: PUSH.directTok, platform: 'android' }), 'user_id', ['42501']);
  fails(await alex.from('push_tokens').insert({ org_id: ORG, member_id: M.alex, token: 'not-a-token', platform: 'android' }), 'bad token', ['23514']);
  const row = ok(await alex.from('push_tokens').insert({ org_id: ORG, member_id: M.alex, token: PUSH.directTok, platform: 'android' }).select('user_id').single(), 'own insert');
  eq(row.user_id, PUSH.alexUser, 'user_id defaults to auth.uid()');
  fails(await alex.from('push_tokens').update({ member_id: M.sana }).eq('token', PUSH.directTok), 'repoint member (no column grant)', ['42501']);
  eq(await count(alex.from('push_tokens').delete().eq('token', PUSH.directTok).select('id'), 'delete own'), 1, 'deleted own');
});
await check('cannot register for another workspace (either direction)', async () => {
  pushOutsiderOrg = ok(await outsider.from('organizations').select('id').single(), 'outsider org').id;
  fails(await alex.rpc('register_push_token', { org_id: pushOutsiderOrg, token: PUSH.spareTok, platform: 'ios' }), 'alex → outsider org', ['42501']);
  fails(await outsider.rpc('register_push_token', { org_id: ORG, token: PUSH.spareTok, platform: 'ios' }), 'outsider → Brightline', ['42501']);
  fails(await alex.from('push_tokens').insert({ org_id: pushOutsiderOrg, member_id: M.alex, token: PUSH.spareTok, platform: 'ios' }), 'direct cross-org', ['42501', '23503', '23514']);
  fails(await anon.rpc('register_push_token', { org_id: ORG, token: PUSH.spareTok, platform: 'ios' }), 'anon', ['42501', 'PGRST202']);
  eq(Number(psql(`select count(*) from public.push_tokens where token = :'t';`, { t: PUSH.spareTok })), 0, 'nothing stored');
});
await check('register_push_token validates token and platform (22023)', async () => {
  fails(await alex.rpc('register_push_token', { org_id: ORG, token: 'abc', platform: 'ios' }), 'token', ['22023']);
  fails(await alex.rpc('register_push_token', { org_id: ORG, token: PUSH.spareTok, platform: 'web' }), 'platform', ['22023']);
});

console.log('\nPush: notifications → push-dispatch via pg_net');
await check('insert notification → pg_net call to push-dispatch with { notification_id }', async () => {
  const id = pushNotify({ recipient: M.alex });
  const call = pushCallFor(id);
  assert(call, 'no net.http_calls row for the notification');
  eq(call.url, `${API_URL}/functions/v1/push-dispatch`, 'url');
  eq(call.body, { notification_id: id }, 'body');
  eq(call.headers.Authorization, `Bearer ${env.NUDGE_SERVICE_ROLE_KEY}`, 'Authorization header');
  eq(call.timeout_milliseconds, 10000, 'timeout');
});
await check('broadcast notification (no recipient) is enqueued when anyone has a device', async () => {
  assert(pushCallFor(pushNotify()), 'broadcast not enqueued');
});
await check('no call when: recipient has no device, already read, or workspace notifications off', async () => {
  assert(!pushCallFor(pushNotify({ recipient: M.sana })), 'enqueued for a member without devices');
  assert(!pushCallFor(pushNotify({ recipient: M.alex, readAt: new Date().toISOString() })), 'enqueued an already-read notification');
  const prev = ok(await alex.from('organizations').select('settings').eq('id', ORG).single(), 'settings').settings.notifications;
  ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { notifications: 'off' } }), 'off');
  try {
    assert(!pushCallFor(pushNotify({ recipient: M.alex })), 'enqueued while notifications are off');
  } finally {
    ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { notifications: prev ?? 'needs_you' } }), 'restore');
  }
});
await check('no call for a disabled token; insert still succeeds without Vault secrets', async () => {
  psql(`update public.push_tokens set disabled_at = now() where id = :'id';`, { id: pushAlexId });
  try {
    assert(!pushCallFor(pushNotify({ recipient: M.alex })), 'enqueued for a disabled device');
  } finally {
    psql(`update public.push_tokens set disabled_at = null where id = :'id';`, { id: pushAlexId });
  }
  psql(`update vault.secrets set name = 'service_role_key_off' where name = 'service_role_key';`);
  try {
    const id = pushNotify({ recipient: M.alex });
    assert(id, 'insert failed');
    assert(!pushCallFor(id), 'call recorded without secrets');
  } finally {
    psql(`update vault.secrets set name = 'service_role_key' where name = 'service_role_key_off';`);
  }
});
await check('seeded notifications (inserted before Vault secrets) never enqueued', async () => {
  eq(Number(psql(`select count(*) from net.http_calls c join public.notifications n on n.id = (c.body->>'notification_id')::uuid where n.id::text like 'b8000000-%';`)), 0, 'calls');
});

console.log('\nPush: device changes hands, sign-out');
await check('register_push_token moves a token to the new user on the same device', async () => {
  eq(ok(await sana.rpc('register_push_token', { org_id: ORG, token: PUSH.alexTok, platform: 'android', device_name: 'Shared tablet' }), 'sana takes over'), pushAlexId, 'same row');
  eq(await count(pushRows(alex), 'alex after'), 0, 'alex no longer has it');
  const row = ok(await pushRows(sana).eq('id', pushAlexId).single(), 'sana row');
  eq([row.member_id, row.user_id, row.platform, row.device_name], [M.sana, PUSH.sanaUser, 'android', 'Shared tablet'], 'moved');
});
await check('unregister_push_token removes only my own token', async () => {
  eq(ok(await alex.rpc('unregister_push_token', { token: PUSH.alexTok }), 'alex unregister'), false, 'alex cannot remove Sana’s');
  eq(ok(await sana.rpc('unregister_push_token', { token: PUSH.alexTok }), 'sana unregister'), true, 'removed');
  eq(ok(await sana.rpc('unregister_push_token', { token: PUSH.alexTok }), 'again'), false, 'idempotent');
  eq(Number(psql(`select count(*) from public.push_tokens where token = :'t';`, { t: PUSH.alexTok })), 0, 'gone');
});

/* ═════════════ message drafts + contact preferences (migration 20261007000009_drafts) ═════════════ */
// Self-contained section: own helpers and ids (prefixed `draft`), so it merges cleanly with others.

console.log('\nDrafts: contact preferences (contact_policies RLS + stamp trigger)');
const DRAFT = {
  ravi: 'b2000000-0000-4000-8000-000000000003',
  dev: 'b3000000-0000-4000-8000-000000000008',
  vikram: 'b3000000-0000-4000-8000-000000000005',
  kavya: 'b3000000-0000-4000-8000-000000000009',
  rahul: 'b3000000-0000-4000-8000-000000000001',
  kavyaPromise: 'b6000000-0000-4000-8000-000000000006',
  kavyaSuggestion: 'b9000000-0000-4000-8000-000000000005',
  rahulPolicy: 'bb000000-0000-4000-8000-000000000002',
};
const draftPolicy = (client, customer) =>
  client
    .from('contact_policies')
    .select('id, customer_id, preferred_method, preferred_channel, preferred_hours_start, preferred_hours_end, max_messages_per_week, opted_out, opted_out_at, opted_out_reason, updated_by_member_id')
    .eq('customer_id', customer)
    .maybeSingle();
const draftUpsertPolicy = (client, customer, patch) =>
  client
    .from('contact_policies')
    .upsert({ org_id: ORG, customer_id: customer, ...patch }, { onConflict: 'org_id,customer_id' })
    .select('id, preferred_method, preferred_channel, opted_out, opted_out_at, opted_out_reason, updated_by_member_id')
    .single();
/** A draft as the draft-message function writes it (service role; here: the superuser). */
const draftServiceInsert = ({ customer, body, channel = 'whatsapp', intent = 'reply', commitment = '', suggestion = '' }) =>
  psql(
    `insert into public.message_drafts (org_id, customer_id, commitment_id, suggestion_id, intent, channel, body, language, created_by_member_id)
     values (:'org', :'customer', nullif(:'commitment', '')::uuid, nullif(:'suggestion', '')::uuid, :'intent', :'channel', :'body', 'English', :'member')
     returning id;`,
    { org: ORG, customer, commitment, suggestion, intent, channel, body, member: M.alex },
  );
let draftOutsider;

await check('member upserts a new contact policy (sms → preferred_channel phone, updated_by = caller)', async () => {
  const row = ok(
    await draftUpsertPolicy(sana, DRAFT.kavya, { preferred_method: 'sms', preferred_hours_start: '17:00', preferred_hours_end: '21:00', max_messages_per_week: 2 }),
    'sana upsert',
  );
  eq([row.preferred_method, row.preferred_channel, row.opted_out, row.updated_by_member_id], ['sms', 'phone', false, M.sana], 'policy');
  const read = ok(await draftPolicy(alex, DRAFT.kavya), 'alex read');
  eq([read.preferred_hours_start, read.preferred_hours_end, read.max_messages_per_week], ['17:00:00', '21:00:00', 2], 'hours/cap');
});
await check('seeded policies got preferred_method from preferred_channel', async () => {
  eq(ok(await draftPolicy(alex, DRAFT.rahul), 'rahul').preferred_method, 'whatsapp', 'rahul');
  eq(ok(await draftPolicy(alex, C.priya), 'priya').preferred_method, 'call', 'priya');
});
await check('upsert on an existing row: opt out with reason (opted_out_at set), opt back in clears the reason', async () => {
  const out = ok(await draftUpsertPolicy(alex, DRAFT.rahul, { opted_out: true, opted_out_reason: '  Asked us to stop on the phone  ' }), 'opt out');
  eq([out.id, out.opted_out, out.opted_out_reason, out.updated_by_member_id], [DRAFT.rahulPolicy, true, 'Asked us to stop on the phone', M.alex], 'opted out');
  assert(out.opted_out_at, 'opted_out_at not set');
  const back = ok(await draftUpsertPolicy(alex, DRAFT.rahul, { opted_out: false, opted_out_reason: 'stale' }), 'opt in');
  eq([back.opted_out, back.opted_out_at, back.opted_out_reason], [false, null, null], 'opted back in');
});
await check('contact policy changes are audited (owner reads audit_logs)', async () => {
  const rows = ok(await alex.from('audit_logs').select('action, actor_member_id').eq('entity_type', 'contact_policies').eq('entity_id', DRAFT.rahulPolicy).eq('action', 'update'), 'audit');
  assert(rows.length >= 2 && rows.every((r) => r.actor_member_id === M.alex), `audit rows ${JSON.stringify(rows)}`);
});
await check('a policy cannot be moved to another customer; updated_by is not client-writable', async () => {
  fails(await alex.from('contact_policies').update({ customer_id: DRAFT.dev }).eq('id', DRAFT.rahulPolicy), 'move', ['23514']);
  const row = ok(await sana.from('contact_policies').update({ updated_by_member_id: M.alex, max_messages_per_week: 3 }).eq('id', DRAFT.rahulPolicy).select('updated_by_member_id').single(), 'spoof');
  eq(row.updated_by_member_id, M.sana, 'stamped with the real caller');
});
await check('another workspace cannot read or write Brightline contact policies', async () => {
  draftOutsider = outsider;
  eq(await count(draftOutsider.from('contact_policies').select('id').eq('org_id', ORG), 'outsider read'), 0, 'rows');
  fails(await draftUpsertPolicy(draftOutsider, DRAFT.dev, { opted_out: true }), 'outsider upsert', ['42501']);
  eq(await count(draftOutsider.from('contact_policies').update({ opted_out: true }).eq('org_id', ORG).select('id'), 'outsider update'), 0, 'updated');
  fails(await anon.from('contact_policies').select('id'), 'anon', ['42501']);
});
await check('private customers: a member cannot see or upsert the policy of a customer they do not own', async () => {
  ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: false } }), 'private');
  try {
    // Dev is owned by Alex in the seed, not by Ravi.
    const ravi = clientFor(tokenForEmail('ravi@brightline.in'));
    eq(await count(ravi.from('contact_policies').select('id').eq('customer_id', DRAFT.rahul), 'ravi read'), 0, 'ravi sees rahul policy');
    fails(await draftUpsertPolicy(ravi, DRAFT.dev, { opted_out: true }), 'ravi upsert', ['42501']);
  } finally {
    ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: true } }), 'shared');
  }
});

console.log('\nDrafts: message_drafts RLS + guard trigger');
let draftDevice;
let draftKavya;
await check('member inserts a device draft: author forced to caller, source device', async () => {
  const row = ok(
    await alex
      .from('message_drafts')
      .insert({ org_id: ORG, customer_id: DRAFT.dev, intent: 'check_in', channel: 'whatsapp', body: 'Hi Dev, just checking in after your audit.', language: 'English' })
      .select('id, created_by_member_id, source, status')
      .single(),
    'insert',
  );
  draftDevice = row.id;
  eq([row.created_by_member_id, row.source, row.status], [M.alex, 'device', 'draft'], 'row');
  eq(await count(sana.from('message_drafts').select('id').eq('id', draftDevice), 'sana sees'), 1, 'teammate sees shared customer draft');
});
await check('drafts refuse: wrong-customer promise, status on insert, AI columns, fake "sent"', async () => {
  fails(await alex.from('message_drafts').insert({ org_id: ORG, customer_id: DRAFT.dev, commitment_id: DRAFT.kavyaPromise, channel: 'sms', body: 'x' }), 'other customer promise', ['23514']);
  fails(await alex.from('message_drafts').insert({ org_id: ORG, customer_id: DRAFT.dev, channel: 'sms', body: 'x', status: 'sent' }), 'status', ['42501']);
  fails(await alex.from('message_drafts').insert({ org_id: ORG, customer_id: DRAFT.dev, channel: 'sms', body: 'x', source: 'ai' }), 'source', ['42501']);
  fails(await alex.from('message_drafts').insert({ org_id: ORG, customer_id: DRAFT.dev, channel: 'telegram', body: 'x' }), 'channel', ['23514']);
  fails(await alex.from('message_drafts').update({ status: 'sent' }).eq('id', draftDevice), 'sent without event', ['23514']);
  fails(await alex.from('message_drafts').update({ created_by_member_id: M.sana }).eq('id', draftDevice), 'author', ['42501']);
  fails(await alex.from('message_drafts').delete().eq('id', draftDevice), 'delete', ['42501']);
});
await check('another workspace and anon see no drafts; outsider cannot mark one sent', async () => {
  eq(await count(draftOutsider.from('message_drafts').select('id').eq('org_id', ORG), 'outsider'), 0, 'outsider rows');
  fails(await draftOutsider.rpc('mark_draft_sent', { draft_id: draftDevice, channel: 'whatsapp', final_body: 'x' }), 'outsider mark', ['P0002', '42501']);
  fails(await draftOutsider.from('message_drafts').insert({ org_id: ORG, customer_id: DRAFT.dev, channel: 'sms', body: 'x' }), 'outsider insert', ['42501']);
  fails(await anon.from('message_drafts').select('id'), 'anon', ['42501']);
});

console.log('\nDrafts: mark_draft_sent');
await check('mark_draft_sent → outbound event by caller + draft sent + suggestion resolved (one call)', async () => {
  draftKavya = draftServiceInsert({ customer: DRAFT.kavya, body: 'Hi Kavya, following up on quotation Q-0139.', channel: 'whatsapp', intent: 'quote_follow_up', commitment: DRAFT.kavyaPromise, suggestion: DRAFT.kavyaSuggestion });
  const before = await count(sana.from('conversation_events').select('id').eq('customer_id', DRAFT.kavya), 'events before');
  const res = ok(await sana.rpc('mark_draft_sent', { draft_id: draftKavya, channel: 'sms', final_body: '  Hi Kavya, following up on Q-0139 — any questions on the premium finish?  ' }), 'mark');
  assert(res.event_id && res.suggestion_resolved === true && res.already_sent === false, `result ${JSON.stringify(res)}`);
  const ev = ok(await alex.from('conversation_events').select('kind, channel, direction, title, body, author_member_id, idempotency_key').eq('id', res.event_id).single(), 'event');
  eq(
    [ev.kind, ev.channel, ev.direction, ev.title, ev.body, ev.author_member_id, ev.idempotency_key],
    ['message', 'phone', 'out', 'You sent a quotation follow-up', 'Hi Kavya, following up on Q-0139 — any questions on the premium finish?', M.sana, `draft:${draftKavya}`],
    'event',
  );
  eq(await count(sana.from('conversation_events').select('id').eq('customer_id', DRAFT.kavya), 'events after'), before + 1, 'one event');
  const d = ok(await alex.from('message_drafts').select('status, channel, body, sent_event_id, sent_by_member_id, sent_at').eq('id', draftKavya).single(), 'draft');
  eq([d.status, d.channel, d.sent_event_id, d.sent_by_member_id], ['sent', 'sms', res.event_id, M.sana], 'draft sent');
  assert(d.sent_at && d.body.startsWith('Hi Kavya, following up on Q-0139'), 'sent_at/body');
  const s = ok(await alex.from('followup_suggestions').select('bucket, resolved_at').eq('id', DRAFT.kavyaSuggestion).single(), 'suggestion');
  assert(s.bucket === 'done' && s.resolved_at, 'suggestion not resolved');
  assert(lastCallFor(res.event_id), 'ai-extract not enqueued for the authored outbound event');
});
await check('mark_draft_sent is idempotent and a sent draft is immutable', async () => {
  const again = ok(await sana.rpc('mark_draft_sent', { draft_id: draftKavya, channel: 'sms', final_body: 'different' }), 'again');
  eq(again.already_sent, true, 'already_sent');
  eq(await count(alex.from('conversation_events').select('id').eq('idempotency_key', `draft:${draftKavya}`), 'events'), 1, 'still one event');
  fails(await alex.from('message_drafts').update({ body: 'rewrite history' }).eq('id', draftKavya), 'edit sent', ['23514']);
  fails(await alex.from('message_drafts').update({ status: 'discarded' }).eq('id', draftKavya), 'discard sent', ['23514']);
});
await check('a draft cannot be pointed at someone else’s or an inbound event', async () => {
  const d = draftServiceInsert({ customer: DRAFT.dev, body: 'Hi Dev' });
  fails(await alex.from('message_drafts').update({ status: 'sent', sent_event_id: 'b4000000-0000-4000-8000-000000000024' }).eq('id', d), 'inbound event', ['23514']);
  const evSana = ok(
    await sana.from('conversation_events').insert({ org_id: ORG, customer_id: DRAFT.dev, kind: 'message', channel: 'whatsapp', direction: 'out', title: 'You replied', body: 'hi', author_member_id: M.sana }).select('id').single(),
    'sana event',
  );
  fails(await alex.from('message_drafts').update({ status: 'sent', sent_event_id: evSana.id }).eq('id', d), 'teammate event', ['23514']);
});
await check('opted out → mark_draft_sent refused with 42501, nothing recorded; discard works', async () => {
  ok(await draftUpsertPolicy(alex, DRAFT.vikram, { opted_out: true, opted_out_reason: 'Not interested' }), 'opt out vikram');
  const d = draftServiceInsert({ customer: DRAFT.vikram, body: 'Hi Vikram, any update on the café shelves?', intent: 'check_in' });
  const before = await count(alex.from('conversation_events').select('id').eq('customer_id', DRAFT.vikram), 'before');
  const res = await alex.rpc('mark_draft_sent', { draft_id: d, channel: 'whatsapp', final_body: 'Hi Vikram' });
  fails(res, 'opted out', ['42501']);
  assert(/asked not to be contacted/.test(res.error.message), `message: ${res.error.message}`);
  eq(await count(alex.from('conversation_events').select('id').eq('customer_id', DRAFT.vikram), 'after'), before, 'no event');
  eq(ok(await alex.from('message_drafts').select('status').eq('id', d).single(), 'draft').status, 'draft', 'still a draft');
  const gone = ok(await alex.from('message_drafts').update({ status: 'discarded' }).eq('id', d).select('status, discarded_at').single(), 'discard');
  assert(gone.status === 'discarded' && gone.discarded_at, 'discarded');
  fails(await alex.rpc('mark_draft_sent', { draft_id: d }), 'send discarded', ['23514']);
});
await check('mark_draft_sent validates channel and text (22023)', async () => {
  fails(await alex.rpc('mark_draft_sent', { draft_id: draftDevice, channel: 'telegram', final_body: 'x' }), 'channel', ['22023']);
  fails(await alex.rpc('mark_draft_sent', { draft_id: draftDevice, channel: 'whatsapp', final_body: '   ' }), 'empty', ['22023']);
  fails(await alex.rpc('mark_draft_sent', { draft_id: crypto.randomUUID() }), 'missing', ['P0002']);
});
await check('ai_stage has the draft value (used by the draft-message function)', async () => {
  eq(psql(`select 'draft'::public.ai_stage::text;`), 'draft', 'enum');
});

/* ═════════════ customer memory summaries + handoff briefs (migration 20261007000008_memory) ═════════════ */
// Self-contained section: own helpers and ids (prefixed `mem`), so it merges cleanly with others.

console.log('\nMemory: extraction → summarize-customer queue (pg_net), debounce, sweep');
const MEM = {
  arjun: 'b3000000-0000-4000-8000-000000000007',
  dev: 'b3000000-0000-4000-8000-000000000008',
  vikram: 'b3000000-0000-4000-8000-000000000005',
  meera: 'b3000000-0000-4000-8000-000000000006',
  rahul: 'b3000000-0000-4000-8000-000000000001',
};
const memCalls = (customerId) =>
  psqlJson(
    `select coalesce(json_agg(row_to_json(c) order by c.id), '[]') from net.http_calls c
      where c.url like '%/functions/v1/summarize-customer' and c.body ->> 'customer_id' = :'id';`,
    { id: customerId },
  );
const memEventOf = (customerId) =>
  psql(`select id from public.conversation_events where customer_id = :'id' order by occurred_at desc limit 1;`, { id: customerId });
/** An extraction ai_runs row over one of the customer's events, as ai-extract writes it (service role). */
const memRun = (customerId, { status = 'running', stage = 'extraction' } = {}) =>
  psql(
    `insert into public.ai_runs (org_id, stage, model, prompt_version, input_event_ids, status)
     values (:'org', :'stage'::public.ai_stage, 'smoke', 'extract-v1', array[:'event'::uuid], :'status'::public.ai_run_status)
     returning id;`,
    { org: ORG, stage, event: memEventOf(customerId), status },
  );
const memFinish = (runId, status = 'succeeded') =>
  psql(`update public.ai_runs set status = :'status'::public.ai_run_status, finished_at = now() where id = :'id';`, { id: runId, status });
/** Puts a customer outside every debounce window. */
const memReset = (customerId) =>
  psql(
    `delete from public.customer_summary_state where customer_id = :'id';
     update public.customers set summary_updated_at = now() - interval '1 day' where id = :'id';`,
    { id: customerId },
  );
for (const id of Object.values(MEM)) memReset(id);

await check('extraction run → succeeded enqueues summarize-customer once (url, body, service bearer, timeout)', async () => {
  const run = memRun(MEM.arjun);
  eq(memCalls(MEM.arjun).length, 0, 'calls while running');
  memFinish(run);
  const calls = memCalls(MEM.arjun);
  eq(calls.length, 1, 'calls after succeeded');
  eq(calls[0].url, `${API_URL}/functions/v1/summarize-customer`, 'url');
  eq(calls[0].body, { customer_id: MEM.arjun }, 'body');
  eq(calls[0].headers.Authorization, `Bearer ${env.NUDGE_SERVICE_ROLE_KEY}`, 'Authorization header');
  eq(calls[0].timeout_milliseconds, 120000, 'timeout');
  const st = psqlJson(`select row_to_json(s) from public.customer_summary_state s where customer_id = :'id';`, { id: MEM.arjun });
  assert(st.requested_at && st.request_count === 1 && st.dirty_since === null, `state ${JSON.stringify(st)}`);
});
await check('debounce: another succeeded extraction within 2 minutes → no call, customer marked dirty', async () => {
  memFinish(memRun(MEM.arjun));
  memFinish(memRun(MEM.arjun));
  eq(memCalls(MEM.arjun).length, 1, 'calls');
  assert(psql(`select dirty_since from public.customer_summary_state where customer_id = :'id';`, { id: MEM.arjun }), 'not dirty');
});
await check('debounce also counts from the last generated summary', async () => {
  psql(`update public.customers set summary_updated_at = now() - interval '30 seconds' where id = :'id';`, { id: MEM.dev });
  try {
    memFinish(memRun(MEM.dev));
    eq(memCalls(MEM.dev).length, 0, 'calls');
  } finally {
    memReset(MEM.dev);
  }
});
await check('failed extraction, other stages and re-saving a succeeded run never enqueue', async () => {
  memFinish(memRun(MEM.vikram), 'failed');
  memFinish(memRun(MEM.vikram, { stage: 'summary' }));
  memRun(MEM.vikram, { status: 'skipped' });
  eq(memCalls(MEM.vikram).length, 0, 'calls');
});
await check('INSERT of an already-succeeded extraction run enqueues too', async () => {
  memRun(MEM.vikram, { status: 'succeeded' });
  eq(memCalls(MEM.vikram).length, 1, 'calls');
});
await check('flush_customer_summaries (pg_cron sweep) re-enqueues a dirty customer once the window passed', async () => {
  eq(Number(psql(`select public.flush_customer_summaries();`)), 0, 'nothing due inside the window');
  psql(`update public.customer_summary_state set requested_at = now() - interval '3 minutes' where customer_id = :'id';`, { id: MEM.arjun });
  eq(Number(psql(`select public.flush_customer_summaries();`)), 1, 'flushed');
  eq(memCalls(MEM.arjun).length, 2, 'calls');
  eq(psql(`select dirty_since is null from public.customer_summary_state where customer_id = :'id';`, { id: MEM.arjun }), 't', 'dirty cleared');
  eq(Number(psql(`select public.flush_customer_summaries();`)), 0, 'not flushed twice');
});
await check('no Vault secrets: the ai_runs update still succeeds, nothing is sent, customer stays dirty', async () => {
  memReset(MEM.meera);
  psql(`update vault.secrets set name = 'service_role_key_off' where name = 'service_role_key';`);
  try {
    const run = memRun(MEM.meera);
    memFinish(run);
    eq(psql(`select status from public.ai_runs where id = :'id';`, { id: run }), 'succeeded', 'run status');
    eq(memCalls(MEM.meera).length, 0, 'calls');
    assert(psql(`select dirty_since from public.customer_summary_state where customer_id = :'id';`, { id: MEM.meera }), 'not dirty');
  } finally {
    psql(`update vault.secrets set name = 'service_role_key' where name = 'service_role_key_off';`);
  }
});

console.log('\nMemory: request_customer_summary ("Refresh") + column / table privileges');
const memOutsider = clientFor(tokenForEmail(`mem-outsider+${Date.now()}@outside.test`));
await check('request_customer_summary → queued, then pending with retry_after (rate limit 2 min)', async () => {
  memReset(MEM.rahul);
  const first = ok(await alex.rpc('request_customer_summary', { customer_id: MEM.rahul }), 'first');
  eq(first, { status: 'queued' }, 'first');
  const calls = memCalls(MEM.rahul);
  eq(calls.length, 1, 'calls');
  eq(calls[0].body, { customer_id: MEM.rahul }, 'body');
  eq(psql(`select requested_by_member_id from public.customer_summary_state where customer_id = :'id';`, { id: MEM.rahul }), M.alex, 'requested by');
  const second = ok(await sana.rpc('request_customer_summary', { customer_id: MEM.rahul }), 'second');
  eq(second.status, 'pending', 'second status');
  assert(second.retry_after >= 1 && second.retry_after <= 120, `retry_after ${second.retry_after}`);
  eq(memCalls(MEM.rahul).length, 1, 'still one call');
});
await check('request_customer_summary → fresh when a summary was just generated', async () => {
  psql(`update public.customers set summary_updated_at = now() where id = :'id';`, { id: MEM.rahul });
  try {
    eq(ok(await alex.rpc('request_customer_summary', { customer_id: MEM.rahul }), 'fresh').status, 'fresh', 'status');
  } finally {
    memReset(MEM.rahul);
  }
});
await check('request_customer_summary refused: hidden customer (private workspace), other tenant, anon', async () => {
  const before = memCalls(MEM.rahul).length;
  ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: false } }), 'private');
  try {
    fails(await sana.rpc('request_customer_summary', { customer_id: MEM.rahul }), 'sana private', ['42501']);
  } finally {
    ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: true } }), 'shared');
  }
  fails(await memOutsider.rpc('request_customer_summary', { customer_id: MEM.rahul }), 'outsider', ['42501']);
  fails(await anon.rpc('request_customer_summary', { customer_id: MEM.rahul }), 'anon', ['42501', 'PGRST202']);
  eq(memCalls(MEM.rahul).length, before, 'no new calls');
});
await check('queue internals and customer_summary_state are service-only', async () => {
  fails(await alex.rpc('queue_customer_summary', { customer_id: MEM.rahul }), 'queue', ['42501', 'PGRST202']);
  fails(await alex.rpc('flush_customer_summaries', {}), 'flush', ['42501', 'PGRST202']);
  fails(await alex.from('customer_summary_state').select('customer_id'), 'state read', ['42501']);
});
await check('AI summary columns are not client-writable (update or insert); plain insert still works', async () => {
  fails(await alex.from('customers').update({ summary: 'made up' }).eq('id', MEM.rahul), 'summary', ['42501']);
  fails(await alex.from('customers').update({ summary_ai_run_id: null }).eq('id', MEM.rahul), 'summary_ai_run_id', ['42501']);
  fails(await alex.from('customers').update({ summary_source_event_ids: [] }).eq('id', MEM.rahul), 'summary_source_event_ids', ['42501']);
  fails(await alex.from('customers').insert({ org_id: ORG, name: 'Fake Summary', summary: 'made up', summary_updated_at: new Date().toISOString() }), 'insert summary', ['42501']);
  const row = ok(await alex.from('customers').insert({ org_id: ORG, name: 'Mem Plain', headline: 'New customer', owner_member_id: M.alex }).select('id, summary, summary_source_event_ids').single(), 'plain insert');
  eq([row.summary, row.summary_source_event_ids], [null, []], 'defaults');
});

console.log('\nMemory: handoff_briefs RLS');
const memBrief = (customerId) =>
  psql(
    `insert into public.handoff_briefs (org_id, customer_id, requested_by_member_id, for_member_id, brief, fingerprint)
     values (:'org', :'customer', :'by', :'for', '{"version":1,"history":"x"}', 'smoke') returning id;`,
    { org: ORG, customer: customerId, by: M.alex, for: M.sana },
  );
let memBriefId;
await check('members who can see the customer read briefs; hidden customer / other tenant / anon do not', async () => {
  memBriefId = memBrief(MEM.rahul);
  eq(await count(alex.from('handoff_briefs').select('id').eq('id', memBriefId), 'alex'), 1, 'alex');
  eq(await count(sana.from('handoff_briefs').select('id').eq('id', memBriefId), 'sana shared'), 1, 'sana shared');
  ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: false } }), 'private');
  try {
    eq(await count(sana.from('handoff_briefs').select('id').eq('id', memBriefId), 'sana private'), 0, 'sana private');
  } finally {
    ok(await alex.rpc('update_workspace_settings', { org_id: ORG, patch: { share_all_customers: true } }), 'shared');
  }
  eq(await count(memOutsider.from('handoff_briefs').select('id').eq('org_id', ORG), 'outsider'), 0, 'outsider');
  fails(await anon.from('handoff_briefs').select('id'), 'anon', ['42501']);
});
await check('clients cannot insert, edit or delete briefs (service role only)', async () => {
  fails(await alex.from('handoff_briefs').insert({ org_id: ORG, customer_id: MEM.rahul, brief: { history: 'fake' } }), 'insert', ['42501']);
  fails(await alex.from('handoff_briefs').update({ brief: { history: 'edited' } }).eq('id', memBriefId), 'update', ['42501']);
  fails(await alex.from('handoff_briefs').delete().eq('id', memBriefId), 'delete', ['42501']);
  eq(psql(`select brief ->> 'history' from public.handoff_briefs where id = :'id';`, { id: memBriefId }), 'x', 'unchanged');
});
await check("ai_stage has 'handoff'; customers + handoff_briefs are in supabase_realtime", async () => {
  eq(psql(`select 'handoff' = any (enum_range(null::public.ai_stage)::text[]);`), 't', 'enum');
  eq(
    psql(`select string_agg(tablename, ',' order by tablename) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in ('customers', 'handoff_briefs');`),
    'customers,handoff_briefs',
    'publication',
  );
});

/* ═════════════ security hardening (migration 20261007000010_hardening) ═════════════ */
// Self-contained section: own helpers and ids (prefixed `hard`), so it merges cleanly with others.
// Reuses only the base helpers (clientFor, tokenForEmail, psql, asUser, putObject, …) and the
// seeded ids. Leaves the Brightline workspace as it found it, except for rows it creates.

console.log('\nHardening: AI quotas (consume_ai_quota / ai_quota_retry_after)');
const HARD = {
  alexUser: 'a1000000-0000-4000-8000-000000000001',
  ownerEmail: `hard-owner+${Date.now()}@delete.test`,
  memberEmail: `hard-member+${Date.now()}@delete.test`,
  purgeName: 'Hard Purge Person',
  wamid: `wamid.HARDPURGE${Date.now()}`,
  phone: '919999000111',
};
const hardQuota = (client, kind, extra = {}) => client.rpc('consume_ai_quota', { kind, org_id: ORG, ...extra });
const hardUsage = (member, kind) =>
  Number(psql(`select count(*) from public.ai_usage where member_id = :'m' and kind = :'k';`, { m: member, k: kind }));

await check('quota: allows up to the limit, then refuses (nothing recorded on refusal)', async () => {
  for (let i = 0; i < 3; i++) eq(ok(await hardQuota(alex, 'copilot', { per_hour: 3 }), `call ${i + 1}`), true, `call ${i + 1}`);
  eq(ok(await hardQuota(alex, 'copilot', { per_hour: 3 }), 'call 4'), false, 'call 4 refused');
  eq(hardUsage(M.alex, 'copilot'), 3, 'recorded calls');
  const wait = ok(await alex.rpc('ai_quota_retry_after', { kind: 'copilot', org_id: ORG, per_hour: 3 }), 'retry after');
  assert(wait > 0 && wait <= 3600, `retry_after ${wait}`);
});
await check('quota: rolling hour frees up, then the day limit applies, then the day frees up', async () => {
  psql(`update public.ai_usage set at = at - interval '61 minutes' where member_id = :'m' and kind = 'copilot';`, { m: M.alex });
  eq(ok(await hardQuota(alex, 'copilot', { per_hour: 3, per_day: 4 }), 'after an hour'), true, 'hour window reset');
  eq(ok(await hardQuota(alex, 'copilot', { per_hour: 3, per_day: 4 }), 'day limit'), false, 'day limit (4) refused');
  const wait = ok(await alex.rpc('ai_quota_retry_after', { kind: 'copilot', org_id: ORG, per_hour: 3, per_day: 4 }), 'retry after');
  assert(wait > 3600 && wait <= 86400, `day retry_after ${wait}`);
  psql(`update public.ai_usage set at = at - interval '25 hours' where member_id = :'m' and kind = 'copilot';`, { m: M.alex });
  eq(ok(await hardQuota(alex, 'copilot', { per_hour: 3, per_day: 4 }), 'after a day'), true, 'day window reset');
});
await check('quota: callers can tighten but never loosen the server limit (transcribe 30/hour)', async () => {
  psql(
    `insert into public.ai_usage (org_id, member_id, kind) select :'org', :'m', 'transcribe' from generate_series(1, 30);`,
    { org: ORG, m: M.sana },
  );
  eq(ok(await hardQuota(sana, 'transcribe', { per_hour: 100000, per_day: 100000 }), 'loosen'), false, 'still refused at 30/hour');
  eq(ok(await hardQuota(sana, 'copilot'), 'other kind'), true, 'other kinds unaffected');
});
await check('quota: workspace-wide daily cap applies across members and kinds', async () => {
  const used = Number(psql(`select count(*) from public.ai_usage where org_id = :'org' and at > now() - interval '1 day';`, { org: ORG }));
  psql(`update public.ai_quota_limits set per_day = :'n'::int where kind = '*';`, { n: used + 2 });
  try {
    eq(ok(await hardQuota(sana, 'draft'), 'draft 1'), true, 'draft 1');
    eq(ok(await hardQuota(alex, 'summary'), 'summary 1'), true, 'summary 1');
    eq(ok(await hardQuota(sana, 'draft'), 'draft 2'), false, 'org cap reached (Sana)');
    eq(ok(await hardQuota(alex, 'handoff'), 'handoff'), false, 'org cap reached (Alex, other kind)');
    assert(ok(await sana.rpc('ai_quota_retry_after', { kind: 'draft', org_id: ORG }), 'retry') > 0, 'retry_after > 0');
  } finally {
    psql(`update public.ai_quota_limits set per_day = 2000 where kind = '*';`);
  }
  eq(ok(await hardQuota(sana, 'draft'), 'after restore'), true, 'allowed again');
});
await check('quota: unknown kind 22023; another workspace / anon refused; tables not client-readable', async () => {
  fails(await hardQuota(alex, 'video'), 'unknown kind', ['22023']);
  fails(await hardQuota(alex, '*'), 'org pseudo-kind', ['22023']);
  fails(await hardQuota(outsider, 'copilot'), 'outsider', ['42501']);
  fails(await hardQuota(anon, 'copilot'), 'anon', ['42501', 'PGRST202']);
  fails(await alex.from('ai_usage').select('id'), 'ai_usage', ['42501']);
  fails(await alex.from('ai_quota_limits').select('kind'), 'ai_quota_limits', ['42501']);
  fails(await alex.rpc('ai_quota_wait', { p_org: ORG, p_member: M.alex, p_kind: 'copilot', p_window: '1 hour', p_limit: 1 }), 'internal helper', ['42501', 'PGRST202']);
});

console.log('\nHardening: purge_customer → Storage queue, attachments, audit / AI / webhook PII scrub');
let hardPurgeId;
let hardPurgeVoice;
let hardPurgeEvent;
let hardPurgeFile;
let hardAuditBefore; // audit_logs ids about the customer (and the max id) taken just before the purge
await check('setup: customer with a voice note + promise + fact, a file, an AI run and a webhook payload', async () => {
  hardPurgeId = ok(await alex.from('customers').insert({ org_id: ORG, name: HARD.purgeName, owner_member_id: M.alex }).select('id').single(), 'customer').id;
  hardPurgeVoice = voicePath(ORG, M.alex);
  putObject(U.alex, hardPurgeVoice);
  const cap = ok(
    await alex.rpc('save_capture', {
      customer_id: hardPurgeId,
      body: `${HARD.purgeName} wants the blue finish.`,
      kind: 'voice',
      promise_title: `Call ${HARD.purgeName} back`,
      facts: [`${HARD.purgeName} likes blue`],
      audio_path: hardPurgeVoice,
    }),
    'save_capture',
  );
  assert(cap.attachment_id && cap.commitment_id, 'capture ids');
  hardPurgeFile = `${ORG}/${hardPurgeId}/quote.pdf`;
  psql(`insert into storage.objects (bucket_id, name, metadata) values ('attachments', :'n', '{"size": 10}');`, { n: hardPurgeFile });
  psql(
    `insert into public.customer_identities (org_id, customer_id, channel, external_id, verified) values (:'org', :'c', 'whatsapp', :'phone', true);`,
    { org: ORG, c: hardPurgeId, phone: HARD.phone },
  );
  hardPurgeEvent = psql(
    `insert into public.conversation_events (org_id, customer_id, kind, channel, direction, title, body, idempotency_key)
     values (:'org', :'c', 'message', 'whatsapp', 'in', 'Message', 'Please send the quote', 'whatsapp:' || :'wamid') returning id;`,
    { org: ORG, c: hardPurgeId, wamid: HARD.wamid },
  );
  psql(
    `insert into public.ai_runs (org_id, stage, model, prompt_version, input_event_ids, output, status)
     values (:'org', 'copilot', 'test', 'test', array[:'e'::uuid], jsonb_build_object('question', 'What did ' || :'name' || ' ask?'), 'succeeded');`,
    { org: ORG, e: hardPurgeEvent, name: HARD.purgeName },
  );
  psql(
    `insert into public.webhook_events (provider, external_id, org_id, signature_valid, payload) values
       ('whatsapp', 'hard-1-' || :'wamid', :'org', true, jsonb_build_object('messages', jsonb_build_array(jsonb_build_object('id', :'wamid', 'from', :'phone')))),
       ('whatsapp', 'hard-2-' || :'wamid', :'org', true, jsonb_build_object('contacts', jsonb_build_array(jsonb_build_object('wa_id', :'phone')))),
       ('whatsapp', 'hard-3-' || :'wamid', :'org', true, '{"messages":[{"id":"wamid.SOMEONE.ELSE","from":"918888000222"}]}');`,
    { org: ORG, wamid: HARD.wamid, phone: HARD.phone },
  );
});
await check('purge_customer: member without delete rights is refused (42501), nothing removed', async () => {
  fails(await sana.rpc('purge_customer', { customer: hardPurgeId }), 'sana purge', ['42501']);
  eq(await count(alex.from('customers').select('id').eq('id', hardPurgeId), 'still there'), 1, 'customer kept');
});
await check('purge_customer: owner purges → attachments rows gone, files queued + hidden, storage-purge called', async () => {
  hardAuditBefore = psqlJson(
    `select json_build_object('max', (select max(id) from public.audit_logs),
       'ids', (select coalesce(json_agg(id), '[]') from public.audit_logs where org_id = :'org'
                 and (entity_id = :'c'::uuid or before ->> 'customer_id' = :'c' or after ->> 'customer_id' = :'c')));`,
    { org: ORG, c: hardPurgeId },
  );
  assert(hardAuditBefore.ids.length >= 3, `audit rows before purge: ${hardAuditBefore.ids.length}`);
  eq(ok(await alex.rpc('purge_customer', { customer: hardPurgeId }), 'purge'), true, 'purged');
  eq(Number(psql(`select count(*) from public.customers where id = :'c';`, { c: hardPurgeId })), 0, 'customer row');
  eq(Number(psql(`select count(*) from public.attachments where customer_id = :'c' or storage_path = :'p';`, { c: hardPurgeId, p: hardPurgeVoice })), 0, 'attachments rows');
  const queued = psqlJson(
    `select coalesce(json_agg(json_build_object('b', bucket_id, 'n', object_name, 'r', reason, 'd', done_at) order by bucket_id), '[]') from public.storage_purge_queue where object_name in (:'v', :'f');`,
    { v: hardPurgeVoice, f: hardPurgeFile },
  );
  eq(queued, [
    { b: 'attachments', n: hardPurgeFile, r: 'purge_customer', d: null },
    { b: 'voice-notes', n: hardPurgeVoice, r: 'purge_customer', d: null },
  ], 'queue');
  eq(visibleObjects(U.alex, hardPurgeVoice), 0, 'uploader can no longer read the recording');
  const call = psqlJson(`select row_to_json(c) from net.http_calls c where c.url like '%/functions/v1/storage-purge' order by id desc limit 1;`);
  assert(call, 'no storage-purge call recorded');
  eq(call.body, { reason: 'purge_customer' }, 'call body');
  eq(call.headers.Authorization, `Bearer ${env.NUDGE_SERVICE_ROLE_KEY}`, 'service key');
});
await check('purge_customer: audit rows kept (who/when/action) but no PII left in before/after/summary', async () => {
  const rows = psqlJson(
    `select coalesce(json_agg(json_build_object('action', action, 'type', entity_type, 'actor', actor_member_id, 'before', before, 'after', after, 'summary', summary) order by id), '[]')
       from public.audit_logs where org_id = :'org' and (id = any (:'ids'::bigint[]) or id > :'max'::bigint);`,
    { org: ORG, ids: `{${hardAuditBefore.ids.join(',')}}`, max: hardAuditBefore.max },
  );
  assert(rows.length >= hardAuditBefore.ids.length + 3, `expected the earlier rows + the purge's delete rows, got ${rows.length}`);
  for (const r of rows) {
    assert(r.actor === M.alex, `actor kept (${r.type} ${r.action})`);
    for (const side of [r.before, r.after]) assert(side === null || JSON.stringify(side) === '{"purged":true}', `${r.type} ${r.action} not scrubbed: ${JSON.stringify(side)}`);
  }
  assert(rows.some((r) => r.type === 'customers' && r.action === 'delete' && r.summary === 'deleted a customer and their history'), 'customer delete row');
  assert(rows.some((r) => r.type === 'customers' && r.action === 'insert' && r.summary === 'added a customer'), 'customer insert row (label dropped)');
  eq(Number(psql(`select count(*) from public.audit_logs where org_id = :'org' and (before::text like '%' || :'n' || '%' or after::text like '%' || :'n' || '%' or summary like '%' || :'n' || '%');`, { org: ORG, n: HARD.purgeName })), 0, 'name anywhere in audit_logs');
});
await check('purge_customer: AI run outputs and raw webhook payloads that mention the customer are scrubbed', async () => {
  eq(psqlJson(`select output from public.ai_runs where :'e'::uuid = any (input_event_ids);`, { e: hardPurgeEvent }), { purged: true }, 'ai_runs output');
  eq(Number(psql(`select count(*) from public.webhook_events where external_id like 'hard-%' and payload = '{"purged": true}';`)), 2, 'scrubbed payloads');
  eq(psqlJson(`select payload from public.webhook_events where external_id = 'hard-3-' || :'w';`, { w: HARD.wamid }).messages[0].id, 'wamid.SOMEONE.ELSE', 'unrelated payload kept');
});

console.log('\nHardening: export_workspace');
await check('export_workspace: owner gets every section; member / outsider / anon refused', async () => {
  fails(await sana.rpc('export_workspace', { org_id: ORG }), 'member', ['42501']);
  fails(await outsider.rpc('export_workspace', { org_id: ORG }), 'outsider', ['42501']);
  fails(await anon.rpc('export_workspace', { org_id: ORG }), 'anon', ['42501', 'PGRST202']);
  const x = ok(await alex.rpc('export_workspace', { org_id: ORG }), 'export');
  for (const k of ['format', 'version', 'exported_at', 'organization', 'members', 'customers', 'customer_identities', 'events', 'facts', 'commitments', 'extractions', 'contact_policies', 'attachments', 'tasks', 'counts', 'limits', 'truncated', 'truncated_sections']) {
    assert(k in x, `missing key ${k}`);
  }
  eq([x.format, x.version, x.organization.id, x.truncated, x.limits.events, x.limits.other], ['nudge.workspace-export', 1, ORG, false, 5000, 20000], 'header');
  eq(x.customers.length, await count(alex.from('customers').select('id').eq('org_id', ORG), 'customers'), 'customers = what the owner sees');
  eq(x.events.length, await count(alex.from('conversation_events').select('id').eq('org_id', ORG), 'events'), 'events');
  eq(x.counts.customers, x.customers.length, 'counts');
  assert(x.members.length >= 3 && x.members.every((m) => !('user_id' in m)), 'members without user ids');
  assert(x.events.every((e) => !('raw' in e) && !('org_id' in e) && !('idempotency_key' in e)), 'events stripped');
  assert(x.customers.every((c) => !('created_by' in c)), 'customers stripped of auth user ids');
  assert(x.attachments.every((a) => typeof a.storage_path === 'string'), 'attachments are metadata (paths)');
});
await check('export_workspace: audited as "exported the workspace data" in activity_feed', async () => {
  const row = ok(await alex.from('activity_feed').select('actor_name, summary, action').eq('org_id', ORG).eq('action', 'export').order('id', { ascending: false }).limit(1).single(), 'feed');
  eq([row.actor_name, row.summary], ['Alex Fernandes', 'exported the workspace data'], 'export row');
});
await check('export_workspace: events capped at the most recent 5000 with truncated flag', async () => {
  const cust = ok(await outsider.from('customers').insert({ org_id: outsiderOrg, name: 'Bulk Buyer' }).select('id').single(), 'outsider customer').id;
  psql(
    `insert into public.conversation_events (org_id, customer_id, kind, channel, direction, title, occurred_at)
     select :'org', :'c', 'message', 'whatsapp', 'in', 'Msg ' || g, now() - g * interval '1 minute' from generate_series(1, 5001) g;`,
    { org: outsiderOrg, c: cust },
  );
  const x = ok(await outsider.rpc('export_workspace', { org_id: outsiderOrg }), 'export');
  eq([x.events.length, x.truncated, x.truncated_sections, x.events[0].title, x.events[4999].title], [5000, true, ['events'], 'Msg 1', 'Msg 5000'], 'truncation');
});
await check('export_section only exports whitelisted tables (and RLS applies)', async () => {
  fails(await alex.rpc('export_section', { tbl: 'webhook_events', org_id: ORG, order_col: 'received_at', max_rows: 10, drop_keys: [] }), 'webhook_events', ['22023']);
  const s = ok(await outsider.rpc('export_section', { tbl: 'customers', org_id: ORG, order_col: 'created_at', max_rows: 10, drop_keys: [] }), 'outsider section');
  eq(s.rows.length, 0, 'outsider gets no Brightline rows');
});

console.log('\nHardening: delete_workspace');
let hardOrg;
let hardOwnerUid;
let hardVoice;
let hardMember;
const hardOwner = clientFor(tokenForEmail(HARD.ownerEmail));
await check('setup: a second workspace with an owner, a member, a customer, a note, a recording and a webhook row', async () => {
  hardOrg = ok(await hardOwner.rpc('create_organization', { name: 'Hard Delete Co' }), 'create org');
  ok(await hardOwner.rpc('invite_member', { org_id: hardOrg, email: HARD.memberEmail }), 'invite');
  hardOwnerUid = psql(`select id from auth.users where email = lower(:'e');`, { e: HARD.ownerEmail });
  const member = clientFor(tokenForEmail(HARD.memberEmail));
  await member.rpc('accept_member_invites');
  eq(await count(member.from('organizations').select('id').eq('id', hardOrg), 'member sees org'), 1, 'member joined');
  const me = ok(await hardOwner.from('organization_members').select('id').eq('org_id', hardOrg).eq('role', 'owner').single(), 'owner member').id;
  const cust = ok(await hardOwner.from('customers').insert({ org_id: hardOrg, name: 'Delete Me Customer', owner_member_id: me }).select('id').single(), 'customer').id;
  hardVoice = voicePath(hardOrg, me);
  putObject(hardOwnerUid, hardVoice);
  ok(await hardOwner.rpc('save_capture', { customer_id: cust, body: 'Delete me note', kind: 'voice', audio_path: hardVoice }), 'capture');
  psql(`insert into public.webhook_events (provider, external_id, org_id, signature_valid, payload) values ('whatsapp', 'hard-del-' || :'org', :'org', true, '{"x":1}');`, { org: hardOrg });
  hardMember = member;
});
await check('delete_workspace: member, outsider and wrong name are refused; nothing deleted', async () => {
  fails(await hardMember.rpc('delete_workspace', { org_id: hardOrg, confirm_name: 'Hard Delete Co' }), 'member', ['42501']);
  fails(await outsider.rpc('delete_workspace', { org_id: ORG, confirm_name: 'Brightline Fixtures' }), 'outsider on Brightline', ['42501']);
  fails(await hardOwner.rpc('delete_workspace', { org_id: hardOrg, confirm_name: 'Hard Delete' }), 'wrong name', ['22023']);
  fails(await anon.rpc('delete_workspace', { org_id: hardOrg, confirm_name: 'Hard Delete Co' }), 'anon', ['42501', 'PGRST202']);
  eq(Number(psql(`select count(*) from public.organizations where id = :'o';`, { o: hardOrg })), 1, 'still there');
});
await check('delete_workspace: owner with the name (any case, trimmed) → everything gone, files queued, trail kept', async () => {
  eq(ok(await hardOwner.rpc('delete_workspace', { org_id: hardOrg, confirm_name: '  hard DELETE co ' }), 'delete'), true, 'deleted');
  const left = psqlJson(
    `select json_build_object(
       'orgs', (select count(*) from public.organizations where id = :'o'),
       'members', (select count(*) from public.organization_members where org_id = :'o'),
       'customers', (select count(*) from public.customers where org_id = :'o'),
       'events', (select count(*) from public.conversation_events where org_id = :'o'),
       'attachments', (select count(*) from public.attachments where org_id = :'o'),
       'audit', (select count(*) from public.audit_logs where org_id = :'o'),
       'webhooks', (select count(*) from public.webhook_events where external_id = 'hard-del-' || :'o'));`,
    { o: hardOrg },
  );
  eq(left, { orgs: 0, members: 0, customers: 0, events: 0, attachments: 0, audit: 0, webhooks: 0 }, 'left behind');
  const rec = psqlJson(`select row_to_json(d) from public.deleted_workspaces d where org_id = :'o';`, { o: hardOrg });
  eq([rec.deleted_by, rec.member_count, rec.customer_count], [hardOwnerUid, 2, 1], 'deleted_workspaces record');
  eq(rec.name_sha256, psql(`select encode(sha256(convert_to('hard delete co', 'UTF8')), 'hex');`), 'name hash');
  eq(psql(`select reason from public.storage_purge_queue where object_name = :'v';`, { v: hardVoice }), 'delete_workspace', 'recording queued');
  assert(psqlJson(`select row_to_json(c) from net.http_calls c where c.url like '%/functions/v1/storage-purge' and c.body ->> 'reason' = 'delete_workspace' order by id desc limit 1;`), 'storage-purge call');
  eq(await count(hardOwner.from('organizations').select('id'), 'owner orgs'), 0, 'owner has no workspace now');
  fails(await alex.from('deleted_workspaces').select('org_id'), 'clients cannot read deleted_workspaces', ['42501']);
});

console.log('\nHardening: activity_feed (owners only, no raw jsonb)');
await check('activity_feed: owner sees summaries with actor names; no before/after anywhere', async () => {
  const rows = ok(await alex.from('activity_feed').select('*').eq('org_id', ORG).order('id', { ascending: false }).limit(200), 'feed');
  assert(rows.length > 10, `rows ${rows.length}`);
  eq(Object.keys(rows[0]).sort(), ['action', 'actor_kind', 'actor_member_id', 'actor_name', 'at', 'entity_id', 'entity_type', 'id', 'org_id', 'summary'], 'columns');
  assert(rows.every((r) => typeof r.summary === 'string' && r.summary.length > 0), 'every row has a summary');
  assert(rows.some((r) => r.actor_name === 'Alex Fernandes' && r.summary.startsWith('completed a promise · ')), 'completed-a-promise row');
  assert(rows.some((r) => r.actor_name === 'Alex Fernandes' && r.summary === 'changed workspace settings'), 'workspace settings are audited');
  assert(rows.some((r) => r.actor_name === 'Sana Qureshi' && r.summary.startsWith('forgot a fact · ')), 'Sana forgot a fact');
});
await check('activity_feed: keyset paging by id works (cursor = last id)', async () => {
  const page1 = ok(await alex.from('activity_feed').select('id').eq('org_id', ORG).order('id', { ascending: false }).limit(5), 'page 1');
  const page2 = ok(await alex.from('activity_feed').select('id').eq('org_id', ORG).lt('id', page1[4].id).order('id', { ascending: false }).limit(5), 'page 2');
  assert(page2.length === 5 && page2[0].id < page1[4].id, 'page 2 continues page 1');
});
await check('activity_feed: members and other workspaces see nothing', async () => {
  eq(await count(sana.from('activity_feed').select('id').eq('org_id', ORG), 'sana'), 0, 'member rows');
  eq(await count(outsider.from('activity_feed').select('id').eq('org_id', ORG), 'outsider'), 0, 'outsider rows');
  fails(await anon.from('activity_feed').select('id'), 'anon', ['42501']);
});
await check('audit_logs: owners can read the summary columns but not before/after (42501)', async () => {
  ok(await alex.from('audit_logs').select('id, action, entity_type, summary').eq('org_id', ORG).limit(1), 'summary columns');
  fails(await alex.from('audit_logs').select('before').eq('org_id', ORG).limit(1), 'before', ['42501']);
  fails(await alex.from('audit_logs').select('*').limit(1), 'select *', ['42501']);
});

console.log('\nHardening: regression checks for the sweep');
await check('catalog: no app function in public is executable by anon or PUBLIC', async () => {
  const bad = psql(
    `select coalesce(string_agg(p.oid::regprocedure::text, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
        and has_function_privilege('anon', p.oid, 'execute');`,
  );
  eq(bad, '', 'anon-executable functions');
});
await check('catalog: every SECURITY DEFINER function has a fixed search_path', async () => {
  eq(psql(`select coalesce(string_agg(p.proname, ', '), '') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prosecdef and not coalesce(p.proconfig::text like '%search_path=%', false);`), '', 'definer functions without search_path');
});
await check('catalog: RLS on every public table, views are security_invoker, no client TRUNCATE', async () => {
  eq(psql(`select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;`), '', 'tables without RLS');
  eq(psql(`select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'v' and not coalesce(c.reloptions::text like '%security_invoker=true%', false);`), '', 'views without security_invoker');
  eq(psql(`select coalesce(string_agg(c.relname, ', '), '') from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind = 'r'
              and (has_table_privilege('authenticated', c.oid, 'truncate') or has_table_privilege('anon', c.oid, 'truncate')
                   or has_table_privilege('anon', c.oid, 'select'));`), '', 'tables with client TRUNCATE or anon SELECT');
});
await check('RLS helpers are not callable signed out (anon), still work for signed-in users', async () => {
  fails(await anon.rpc('is_org_member', { org: ORG }), 'anon is_org_member', ['42501', 'PGRST202']);
  fails(await anon.rpc('try_uuid', { value: ORG }), 'anon try_uuid', ['42501', 'PGRST202']);
  eq(ok(await alex.rpc('is_org_member', { org: ORG }), 'alex is_org_member'), true, 'alex member');
  fails(await alex.rpc('audit_summary', { entity_type: 'customers', action: 'insert', before: null, after: {} }), 'internal audit_summary', ['42501', 'PGRST202']);
});
await check('voice_note_is_linked() no longer answers for other workspaces', async () => {
  eq(ok(await alex.rpc('voice_note_is_linked', { object_name: alexVoice }), 'alex'), true, 'own workspace');
  eq(ok(await outsider.rpc('voice_note_is_linked', { object_name: alexVoice }), 'outsider'), false, 'other workspace');
});
await check('attachments insert: only own uploader id and own recording paths', async () => {
  const base = { org_id: ORG, customer_id: C.rahul, storage_bucket: 'voice-notes', mime_type: 'audio/mp4' };
  fails(await alex.from('attachments').insert({ ...base, storage_path: voicePath(ORG, M.sana), uploaded_by_member_id: M.alex }), 'teammate recording', ['42501']);
  fails(await alex.from('attachments').insert({ ...base, storage_path: voicePath(ORG, M.alex) }), 'no uploader', ['42501']);
  fails(await alex.from('attachments').insert({ ...base, storage_bucket: 'avatars', storage_path: `${ORG}/x.png`, uploaded_by_member_id: M.alex }), 'other bucket', ['42501']);
  const own = voicePath(ORG, M.alex);
  ok(await alex.from('attachments').insert({ ...base, storage_path: own, uploaded_by_member_id: M.alex }), 'own recording');
  psql(`delete from public.attachments where storage_path = :'p';`, { p: own });
});
await check('storage_purge_queue / deleted_workspaces are service-only', async () => {
  fails(await alex.from('storage_purge_queue').select('id'), 'queue', ['42501']);
  eq(ok(await outsider.rpc('storage_object_purged', { bucket: 'voice-notes', object_name: hardPurgeVoice }), 'outsider purged?'), false, 'other workspace');
  eq(ok(await alex.rpc('storage_object_purged', { bucket: 'voice-notes', object_name: hardPurgeVoice }), 'alex purged?'), true, 'own workspace');
});

/* ───────────── AI suggestion integrity (migration 20261007000011) ───────────── */

console.log('\nAI suggestion integrity: "confirmed" only with a real promise of the same customer');
{
  // Two fresh pending suggestions for one customer, plus a promise that belongs to a different customer.
  const ids = psqlJson(`
    with org as (select id from public.organizations where name = 'Brightline Fixtures' limit 1),
         custs as (select c.id, row_number() over (order by c.created_at) as n from public.customers c, org where c.org_id = org.id),
         a as (select id from custs where n = 1), b as (select id from custs where n = 2),
         x1 as (insert into public.extractions (org_id, customer_id, title) select org.id, a.id, 'Integrity check one' from org, a returning id),
         x2 as (insert into public.extractions (org_id, customer_id, title) select org.id, a.id, 'Integrity check two' from org, a returning id),
         other as (select id from public.commitments where customer_id = (select id from b) limit 1)
    select json_build_object('x1', (select id from x1), 'x2', (select id from x2), 'other', (select id from other));`);

  await check('client cannot mark a suggestion confirmed without a promise', async () => {
    fails(await alex.from('extractions').update({ status: 'confirmed' }).eq('id', ids.x1).select('id'), 'bare confirm', ['23514']);
  });
  await check("client cannot confirm it against another customer's promise", async () => {
    assert(ids.other, 'seed has a promise for a second customer');
    fails(await alex.from('extractions').update({ status: 'confirmed', commitment_id: ids.other }).eq('id', ids.x1).select('id'), 'cross-customer confirm', ['23514']);
  });
  await check('confirm_extraction() still confirms (promise created, link set)', async () => {
    const commitmentId = ok(await alex.rpc('confirm_extraction', { extraction_id: ids.x1 }), 'confirm');
    const row = ok(await alex.from('extractions').select('status, commitment_id').eq('id', ids.x1).single(), 'read back');
    eq(row, { status: 'confirmed', commitment_id: commitmentId }, 'confirmed row');
  });
  await check('a confirmed suggestion cannot be reopened or re-linked', async () => {
    fails(await alex.from('extractions').update({ status: 'ignored' }).eq('id', ids.x1).select('id'), 'reopen', ['23514']);
    fails(await alex.from('extractions').update({ commitment_id: ids.other }).eq('id', ids.x1).select('id'), 'relink', ['23514']);
  });
  await check('ignoring a pending suggestion still works', async () => {
    const rows = ok(await alex.from('extractions').update({ status: 'ignored' }).eq('id', ids.x2).select('id, status'), 'ignore');
    eq(rows, [{ id: ids.x2, status: 'ignored' }], 'ignored row');
  });
}

/* ───────────── result ───────────── */

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
