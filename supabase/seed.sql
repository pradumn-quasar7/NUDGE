-- ─────────────────────────────────────────────────────────────────────────────
-- Nudge · demo workspace "Brightline Fixtures" (mirrors app/src/data/seed.ts)
--
-- All timestamps are relative to now() in the workspace timezone (Asia/Kolkata),
-- so the demo always reads as "this week".
--
-- Members are seeded WITHOUT auth accounts. Sign up locally as
-- alex@brightline.in (owner), sana@brightline.in or ravi@brightline.in and the
-- on_auth_user_created trigger links you to the seeded membership.
--
-- Stable UUIDs: the first block encodes the table
--   b1 org · b2 members · b3 customers · b4 events · b5 facts · b6 commitments
--   b7 extractions · b8 notifications · b9 suggestions · ba integrations
--   bb contact policies · bc identities · bd annotations
-- ─────────────────────────────────────────────────────────────────────────────

do $seed$
declare
  tz   constant text := 'Asia/Kolkata';
  d    constant interval := interval '1 day';
  h    constant interval := interval '1 hour';
  mi   constant interval := interval '1 minute';
  -- local midnight today, as timestamptz
  t0   timestamptz := date_trunc('day', now() at time zone tz) at time zone tz;
  dow  integer := extract(dow from (now() at time zone tz))::integer;
  yr   integer := extract(year from (now() at time zone tz))::integer;
  mon  integer;
  sat  integer;
  sun  integer;

  org    constant uuid := 'b1000000-0000-4000-8000-000000000001';
  alex   constant uuid := 'b2000000-0000-4000-8000-000000000001';
  sana   constant uuid := 'b2000000-0000-4000-8000-000000000002';
  ravi   constant uuid := 'b2000000-0000-4000-8000-000000000003';
  neha_m constant uuid := 'b2000000-0000-4000-8000-000000000004';

  c_rahul  constant uuid := 'b3000000-0000-4000-8000-000000000001';
  c_priya  constant uuid := 'b3000000-0000-4000-8000-000000000002';
  c_aman   constant uuid := 'b3000000-0000-4000-8000-000000000003';
  c_neha   constant uuid := 'b3000000-0000-4000-8000-000000000004';
  c_vikram constant uuid := 'b3000000-0000-4000-8000-000000000005';
  c_meera  constant uuid := 'b3000000-0000-4000-8000-000000000006';
  c_arjun  constant uuid := 'b3000000-0000-4000-8000-000000000007';
  c_dev    constant uuid := 'b3000000-0000-4000-8000-000000000008';
  c_kavya  constant uuid := 'b3000000-0000-4000-8000-000000000009';
  c_sunil  constant uuid := 'b3000000-0000-4000-8000-000000000010';
  c_farah  constant uuid := 'b3000000-0000-4000-8000-000000000011';

  p_rahul_quote constant uuid := 'b6000000-0000-4000-8000-000000000001';
  p_priya_call  constant uuid := 'b6000000-0000-4000-8000-000000000003';
  x_rahul       constant uuid := 'b7000000-0000-4000-8000-000000000001';

  i integer;
  done_titles    text[] := array['Share delivery slot with Neha', 'Send GST invoice to Sunil', 'Confirm colour swatches with Farah',
                                 'Call Dev about audit dates', 'Send Arjun the reorder list', 'Book transport for Priya',
                                 'Share warranty card with Neha'];
  done_customers uuid[];
begin
  -- Last occurrence of a weekday strictly before today (seed.ts lastWeekday).
  mon := coalesce(nullif((dow - 1 + 7) % 7, 0), 7);
  sat := coalesce(nullif((dow - 6 + 7) % 7, 0), 7);
  sun := coalesce(nullif((dow - 0 + 7) % 7, 0), 7);

  -- ───────────── organization + members ─────────────
  insert into public.organizations (id, name, sells, handles, channels, plan, timezone, settings)
  values (
    org, 'Brightline Fixtures', 'Retail display fixtures & shelving',
    array['Custom orders', 'Bulk quotes'], array['whatsapp', 'phone', 'email']::public.channel[], 'pro', tz,
    jsonb_build_object('share_all_customers', true, 'hand_off_when_away', true,
                       'members_can_delete', false, 'notifications', 'needs_you')
  );

  insert into public.organization_members (id, org_id, name, email, role, title, status, invited_at, created_at) values
    (alex,   org, 'Alex Fernandes',     'alex@brightline.in', 'owner',  'Owner',      'active',  null,            t0 - 400 * d),
    (sana,   org, 'Sana Qureshi',       'sana@brightline.in', 'member', 'Sales',      'active',  null,            t0 - 300 * d),
    (ravi,   org, 'Ravi Patel',         'ravi@brightline.in', 'member', 'Operations', 'active',  null,            t0 - 200 * d),
    (neha_m, org, 'neha@brightline.in', 'neha@brightline.in', 'member', null,         'invited', t0 - mon * d + 10 * h, t0 - mon * d + 10 * h);

  -- ───────────── customers ─────────────
  insert into public.customers (
    id, org_id, name, company, phone, preferred_channel, customer_since, lifetime_value, headline,
    summary, summary_message_count, summary_call_count, summary_updated_at, source, owner_member_id, created_at
  ) values
    (c_rahul, org, 'Rahul Sharma', 'Sharma Retail', '+91 98200 11234', 'whatsapp',
     make_date(yr, 3, 3)::timestamp at time zone tz, 84500, 'Waiting for revised quotation',
     'Rahul usually prefers WhatsApp and typically responds within 1–2 days. He is currently evaluating the premium package and finds pricing a little high.',
     14, 2, t0 + 7 * h + 2 * mi, null, alex, t0 - 120 * d + 10 * h),
    (c_priya, org, 'Priya Mehta', 'Mehta Home Stores', '+91 98111 44120', 'phone',
     t0 - 200 * d + 10 * h, 146000, 'Delivery call · 11:00',
     'Priya prefers calls after 5 pm. Her second order is usually about twice the first. She is waiting to hear when the Andheri delivery will arrive.',
     22, 5, t0 + 7 * h + 2 * mi, null, alex, t0 - 120 * d + 10 * h),
    (c_aman, org, 'Aman Verma', 'Verma Electronics', null, 'whatsapp',
     make_date(yr, 1, 12)::timestamp at time zone tz, 112000, 'Hasn’t replied in 6 days',
     'Paid 2 of 3 invoices. Last message 6 days ago — usually replies the same day. Needs 50 units by the 28th and asked for a payment link for ₹40,000.',
     18, 1, t0 + 8 * h + 12 * mi, null, alex, t0 - 120 * d + 10 * h),
    (c_neha, org, 'Neha Kapoor', 'Kapoor Boutique', null, 'whatsapp',
     t0 - 160 * d + 10 * h, 58000, 'Paid ₹18,000',
     'Neha pays on time over UPI and orders seasonally before festivals.',
     9, 1, t0 - mon * d + 10 * h, null, alex, t0 - 120 * d + 10 * h),
    (c_vikram, org, 'Vikram Rao', null, null, 'instagram',
     t0 - sun * d + 10 * h, 0, 'New · found you on Instagram',
     'New enquiry from Instagram about wall shelving for a café.',
     3, 0, t0 - sun * d + 10 * h, 'Instagram', alex, t0 - sun * d + 10 * h),
    (c_meera, org, 'Meera Iyer', null, null, 'instagram',
     t0 - 8 * d + 10 * h, 0, 'Asked for the catalogue',
     'New customer from Instagram. Asked for the catalogue twice and has not received it yet.',
     4, 0, t0 - 6 * d + 10 * h, 'Instagram', alex, t0 - 8 * d + 10 * h),
    (c_arjun, org, 'Arjun Nair', 'Nair Supermart', null, 'whatsapp',
     t0 - 300 * d + 10 * h, 240000, 'Usually reorders monthly — due now',
     'Arjun reorders gondola shelving roughly every month. His last order was 34 days ago.',
     31, 6, t0 - 1 * d + 10 * h, null, alex, t0 - 120 * d + 10 * h),
    (c_dev, org, 'Dev Khanna', 'Khanna Pharma', null, 'whatsapp',
     t0 - 260 * d + 10 * h, 96000, 'Last order Aug',
     null, 12, 2, t0 - 9 * d + 10 * h, null, alex, t0 - 120 * d + 10 * h),
    (c_kavya, org, 'Kavya Joshi', 'Joshi Opticals', null, 'whatsapp',
     t0 - 40 * d + 10 * h, 0, 'Quote viewed twice',
     'Kavya viewed the quotation twice but has not replied. Interested in the premium finish.',
     6, 1, t0 - 12 * d + 10 * h, null, alex, t0 - 120 * d + 10 * h),
    (c_sunil, org, 'Sunil Gupta', 'Gupta Hardware', null, 'whatsapp',
     t0 - 400 * d + 10 * h, 310000, 'Installation done · happy',
     null, 40, 9, t0 - 2 * d + 10 * h, null, alex, t0 - 120 * d + 10 * h),
    (c_farah, org, 'Farah Khan', 'Bloom Florists', null, 'whatsapp',
     t0 - 90 * d + 10 * h, 34000, 'Shared layout photos',
     null, 8, 0, t0 - 3 * d + 10 * h, null, alex, t0 - 120 * d + 10 * h);

  insert into public.customer_identities (id, org_id, customer_id, channel, external_id, display_name, verified) values
    ('bc000000-0000-4000-8000-000000000001', org, c_rahul,  'whatsapp',  '919820011234',   'Rahul Sharma', true),
    ('bc000000-0000-4000-8000-000000000002', org, c_rahul,  'phone',     '919820011234',   'Rahul Sharma', true),
    ('bc000000-0000-4000-8000-000000000003', org, c_priya,  'whatsapp',  '919811144120',   'Priya Mehta',  true),
    ('bc000000-0000-4000-8000-000000000004', org, c_priya,  'phone',     '919811144120',   'Priya Mehta',  true),
    ('bc000000-0000-4000-8000-000000000005', org, c_vikram, 'instagram', 'demo-ig-vikram', 'Vikram Rao',   false),
    ('bc000000-0000-4000-8000-000000000006', org, c_meera,  'instagram', 'demo-ig-meera',  'Meera Iyer',   false);

  -- ───────────── conversation_events (immutable history) ─────────────
  insert into public.conversation_events (id, org_id, customer_id, kind, channel, direction, occurred_at, title, body, amount, ref, author_member_id) values
    -- Rahul
    ('b4000000-0000-4000-8000-000000000001', org, c_rahul, 'note',    'manual',   'internal', t0 - 32 * d + 11 * h,             'Note', 'Prefers deliveries after 6 pm.', null, null, alex),
    ('b4000000-0000-4000-8000-000000000002', org, c_rahul, 'payment', 'upi',      'in',       t0 - 24 * d + 13 * h,             'Paid', null, 22500, 'UPI · INV-0079', null),
    ('b4000000-0000-4000-8000-000000000003', org, c_rahul, 'message', 'whatsapp', 'in',       t0 - 8 * d + 16 * h,              'Quotation requested', 'Can you send me a quote for the 4-tier racks?', null, null, null),
    ('b4000000-0000-4000-8000-000000000004', org, c_rahul, 'call',    'phone',    'out',      t0 - 7 * d + 15 * h,              'Call · 6 min', null, null, null, null),
    ('b4000000-0000-4000-8000-000000000005', org, c_rahul, 'quote',   'email',    'out',      t0 - 6 * d + 12 * h,              'Quotation sent', null, 62000, 'Q-0142 · email', null),
    ('b4000000-0000-4000-8000-000000000006', org, c_rahul, 'message', 'whatsapp', 'in',       t0 - sat * d + 17 * h + 20 * mi,  'Asked for a discount', 'Any discount if we take more units?', null, null, null),
    ('b4000000-0000-4000-8000-000000000007', org, c_rahul, 'message', 'whatsapp', 'in',       t0 - mon * d + 18 * h + 30 * mi,  'Asked for 50 units', 'Can you do 50 units of the 4-tier rack? Need them before Diwali.', null, null, null),
    ('b4000000-0000-4000-8000-000000000008', org, c_rahul, 'message', 'whatsapp', 'in',       t0 - mon * d + 18 * h + 31 * mi,  'Price feedback', 'Also the price from last time was a bit high.', null, null, null),
    ('b4000000-0000-4000-8000-000000000009', org, c_rahul, 'message', 'whatsapp', 'out',      t0 - mon * d + 18 * h + 42 * mi,  'You replied', 'Yes, possible. I’ll send the updated quote tomorrow.', null, null, alex),
    -- Priya
    ('b4000000-0000-4000-8000-000000000010', org, c_priya, 'message', 'whatsapp', 'in',       t0 - 2 * d + 9 * h + 12 * mi,     'Asked when delivery arrives', 'Hi Alex, when will the delivery reach Andheri?', null, null, null),
    ('b4000000-0000-4000-8000-000000000011', org, c_priya, 'message', 'whatsapp', 'out',      t0 - 2 * d + 9 * h + 40 * mi,     'You replied', 'Should be Thursday. I’ll call you tomorrow to confirm the slot.', null, null, alex),
    ('b4000000-0000-4000-8000-000000000012', org, c_priya, 'message', 'whatsapp', 'in',       t0 - 2 * d + 9 * h + 41 * mi,     'Okay, thanks.', 'Okay, thanks.', null, null, null),
    ('b4000000-0000-4000-8000-000000000013', org, c_priya, 'call',    'phone',    'out',      t0 - 40 * d + 17 * h + 30 * mi,   'Call · 12 min', null, null, null, null),
    -- Aman
    ('b4000000-0000-4000-8000-000000000014', org, c_aman,  'payment', 'upi',      'in',       t0 - 30 * d + 10 * h,             'Paid', null, 36000, 'UPI · INV-0071', null),
    ('b4000000-0000-4000-8000-000000000015', org, c_aman,  'message', 'whatsapp', 'in',       t0 - sat * d + 11 * h,            'Wants a payment link', 'Please send the payment link for the balance ₹40,000.', null, null, null),
    ('b4000000-0000-4000-8000-000000000016', org, c_aman,  'message', 'whatsapp', 'in',       t0 + 8 * h + 12 * mi,             'Needs 50 units by the 28th', 'We will need 50 units by the 28th for the new branch.', null, null, null),
    -- Neha
    ('b4000000-0000-4000-8000-000000000017', org, c_neha,  'payment', 'upi',      'in',       t0 - mon * d + 14 * h,            'Paid', null, 18000, 'UPI · INV-0087', null),
    -- Vikram
    ('b4000000-0000-4000-8000-000000000018', org, c_vikram, 'message', 'instagram', 'in',     t0 - sun * d + 19 * h,            'New enquiry', 'Do you make wall shelves for cafés?', null, null, null),
    -- Meera
    ('b4000000-0000-4000-8000-000000000019', org, c_meera, 'message', 'instagram', 'in',      t0 - 8 * d + 12 * h,              'Asked for the catalogue', 'Could you share your catalogue?', null, null, null),
    ('b4000000-0000-4000-8000-000000000020', org, c_meera, 'message', 'instagram', 'in',      t0 - 6 * d + 18 * h,              'Asked for the catalogue again', 'Hi, still waiting for the catalogue 🙂', null, null, null),
    -- Arjun / Dev / Kavya / Sunil / Farah
    ('b4000000-0000-4000-8000-000000000021', org, c_arjun, 'quote',   'email',    'out',      t0 - 34 * d + 10 * h,             'Order confirmed', null, 48000, 'SO-0311', null),
    ('b4000000-0000-4000-8000-000000000022', org, c_arjun, 'message', 'whatsapp', 'in',       t0 - 6 * d + 10 * h,              'Thanks for the delivery', 'Received, thanks!', null, null, null),
    ('b4000000-0000-4000-8000-000000000023', org, c_dev,   'quote',   'email',    'out',      t0 - 50 * d + 10 * h,             'Order delivered', null, 32000, 'SO-0290', null),
    ('b4000000-0000-4000-8000-000000000024', org, c_dev,   'message', 'whatsapp', 'in',       t0 - 9 * d + 10 * h,              'Said he’ll come back after audit', 'Will get back after our audit.', null, null, null),
    ('b4000000-0000-4000-8000-000000000025', org, c_kavya, 'quote',   'email',    'out',      t0 - 14 * d + 10 * h,             'Quotation sent', null, 74000, 'Q-0139', null),
    ('b4000000-0000-4000-8000-000000000026', org, c_kavya, 'note',    'manual',   'internal', t0 - 12 * d + 10 * h,             'Quote viewed twice', 'Opened the quotation PDF twice.', null, null, null),
    ('b4000000-0000-4000-8000-000000000027', org, c_sunil, 'task',    'manual',   'internal', t0 - 2 * d + 10 * h,              'Installation complete', null, null, null, ravi),
    ('b4000000-0000-4000-8000-000000000028', org, c_farah, 'message', 'whatsapp', 'in',       t0 - 3 * d + 10 * h,              'Shared layout photos', 'Sending photos of the shop layout.', null, null, null);

  -- AI call takeaways (CustomerEvent.aiNote) live outside the immutable event.
  insert into public.event_annotations (id, org_id, event_id, customer_id, kind, text) values
    ('bd000000-0000-4000-8000-000000000001', org, 'b4000000-0000-4000-8000-000000000004', c_rahul, 'ai_note', 'Wants the premium finish for 3 stores.'),
    ('bd000000-0000-4000-8000-000000000002', org, 'b4000000-0000-4000-8000-000000000013', c_priya, 'ai_note', 'Second order will be roughly double the first.');

  -- ───────────── customer_facts ─────────────
  insert into public.customer_facts (id, org_id, customer_id, kind, text, valid_until, source_event_id, confidence, created_at) values
    ('b5000000-0000-4000-8000-000000000001', org, c_rahul, 'preference', 'Prefers WhatsApp',                     null,                 null,                                   0.92, t0 - 60 * d + 10 * h),
    ('b5000000-0000-4000-8000-000000000002', org, c_rahul, 'preference', 'Prefers deliveries after 6 pm',        null,                 'b4000000-0000-4000-8000-000000000001', 0.98, t0 - 32 * d + 10 * h),
    ('b5000000-0000-4000-8000-000000000003', org, c_rahul, 'temporal',   'Needs 50 × 4-tier rack before Diwali', t0 + 25 * d + 18 * h, 'b4000000-0000-4000-8000-000000000007', 0.90, t0 - mon * d + 10 * h),
    ('b5000000-0000-4000-8000-000000000004', org, c_rahul, 'note',       'Finds price high',                     null,                 'b4000000-0000-4000-8000-000000000008', 0.80, t0 - mon * d + 10 * h),
    ('b5000000-0000-4000-8000-000000000005', org, c_priya, 'preference', 'Prefers calls after 5 pm',             null,                 null,                                   0.90, t0 - 90 * d + 10 * h),
    ('b5000000-0000-4000-8000-000000000006', org, c_aman,  'temporal',   'Needs 50 units by the 28th',           t0 + 22 * d + 18 * h, null,                                   0.88, t0 + 8 * h + 12 * mi);

  -- ───────────── commitments (Promise Radar) ─────────────
  insert into public.commitments (id, org_id, customer_id, title, owner_member_id, due_at, status, promisor, source_event_id, quote, quote_by, confidence, created_at, draft_hint) values
    (p_rahul_quote, org, c_rahul, 'Send revised quotation', alex,
     greatest(t0 + 18 * h, least(now() + 7 * h, t0 + 23 * h + 30 * mi)), 'open', 'us',
     'b4000000-0000-4000-8000-000000000009', 'Yeah, I’ll send the updated quote tomorrow.', 'You', 0.94,
     t0 - mon * d + 18 * h + 42 * mi, 'Start from Q-0142 (₹62,000), updated to 50 units. He asked for a discount on Sat.'),
    ('b6000000-0000-4000-8000-000000000002', org, c_aman, 'Send payment link to Aman', alex,
     greatest(t0 + 19 * h, least(now() + 5 * h, t0 + 23 * h + 30 * mi)), 'open', 'us',
     'b4000000-0000-4000-8000-000000000015', 'Please send the payment link for the balance ₹40,000.', 'Aman', 0.90,
     t0 - sat * d + 11 * h, null),
    (p_priya_call, org, c_priya, 'Call Priya regarding delivery', alex,
     t0 + 1 * d + 11 * h, 'open', 'us',
     'b4000000-0000-4000-8000-000000000011', 'I’ll call you tomorrow to confirm the slot.', 'You', 0.92,
     t0 - 2 * d + 9 * h + 40 * mi, null),
    ('b6000000-0000-4000-8000-000000000004', org, c_rahul, 'Share installation slots', alex,
     t0 + 3 * d + 12 * h, 'open', 'us',
     'b4000000-0000-4000-8000-000000000004', 'I’ll share the installation slots by Friday.', 'You', 0.86,
     t0 - 7 * d + 15 * h, null),
    ('b6000000-0000-4000-8000-000000000005', org, c_meera, 'Share the catalogue with Meera', sana,
     t0 + 2 * d + 12 * h, 'open', 'us', null, null, null, 0.80, t0 - 6 * d + 10 * h, null),
    ('b6000000-0000-4000-8000-000000000006', org, c_kavya, 'Send premium finish samples', sana,
     t0 + 3 * d + 17 * h, 'open', 'us', null, null, null, 0.82, t0 - 12 * d + 10 * h, null),
    ('b6000000-0000-4000-8000-000000000007', org, c_sunil, 'Send final installation invoice', ravi,
     t0 + 4 * d + 12 * h, 'open', 'us', null, null, null, 0.90, t0 - 2 * d + 10 * h, null),
    ('b6000000-0000-4000-8000-000000000008', org, c_farah, 'Suggest a layout for Bloom', alex,
     t0 + 5 * d + 12 * h, 'open', 'us', null, null, null, 0.75, t0 - 3 * d + 10 * h, null);

  -- Kept this week
  done_customers := array[c_neha, c_sunil, c_farah, c_dev, c_arjun, c_priya, c_neha];
  for i in 0..6 loop
    insert into public.commitments (id, org_id, customer_id, title, owner_member_id, due_at, status, promisor, confidence, created_at, completed_at)
    values (
      ('b6000000-0000-4000-8000-0000000000' || (10 + i)::text)::uuid,
      org,
      done_customers[i + 1],
      done_titles[i + 1],
      case when i % 3 = 0 then sana else alex end,
      t0 - least(i, 5) * d + 10 * h,
      'done',
      'us',
      0.9,
      t0 - 8 * d + 10 * h,
      t0 - least(i, 5) * d + 16 * h
    );
  end loop;

  -- ───────────── extractions ("I noticed a commitment") ─────────────
  insert into public.extractions (id, org_id, customer_id, source_event_id, source_label, title, due_at, fields, promisor, quote, quote_by, confidence, status, commitment_id, created_at) values
    (x_rahul, org, c_rahul, 'b4000000-0000-4000-8000-000000000009', 'From your reply at 6:42 pm.',
     'Send revised quotation to Rahul tomorrow.', t0 + 18 * h,
     '[{"key":"requirement","label":"Requirement","value":"50 × 4-tier rack","checked":true},
       {"key":"deadline","label":"Deadline","value":"before Diwali","checked":true},
       {"key":"note","label":"Note","value":"finds price high","checked":false}]'::jsonb,
     'us', 'Yes, possible. I’ll send the updated quote tomorrow.', 'You', 0.94, 'confirmed', p_rahul_quote,
     t0 - mon * d + 18 * h + 43 * mi),
    ('b7000000-0000-4000-8000-000000000002', org, c_kavya, null, 'From Kavya’s WhatsApp, yesterday 5:10 pm.',
     'Call Kavya on Thursday about the premium finish.', t0 + 2 * d + 12 * h,
     '[{"key":"interest","label":"Interest","value":"Premium finish","checked":true},
       {"key":"budget","label":"Budget","value":"around ₹70,000","checked":true}]'::jsonb,
     'us', null, null, 0.84, 'pending', null, t0 - 1 * d + 17 * h + 10 * mi),
    ('b7000000-0000-4000-8000-000000000003', org, c_vikram, null, 'From Vikram’s Instagram DM, yesterday 7:30 pm.',
     'Send café wall-shelf options to Vikram.', t0 + 1 * d + 12 * h,
     '[{"key":"requirement","label":"Requirement","value":"Wall shelves · café","checked":true},
       {"key":"note","label":"Note","value":"opening next month","checked":false}]'::jsonb,
     'us', null, null, 0.8, 'pending', null, t0 - 1 * d + 19 * h + 30 * mi);

  update public.commitments set extraction_id = x_rahul where id = p_rahul_quote;

  -- ───────────── notifications ─────────────
  insert into public.notifications (id, org_id, kind, customer_id, commitment_id, title, meta, actions, created_at, read_at) values
    ('b8000000-0000-4000-8000-000000000001', org, 'customer', c_rahul, null,
     '[{"t":"Rahul","b":true},{"t":" accepted the revised quote"}]', 'WhatsApp',
     '[{"label":"Create invoice","primary":true},{"label":"Reply"}]', t0 + 9 * h + 14 * mi, null),
    ('b8000000-0000-4000-8000-000000000002', org, 'promise_due', c_priya, p_priya_call,
     '[{"t":"Promise due in 2 hours: "},{"t":"call Priya about delivery","b":true}]', 'Promise Radar',
     null, t0 + 9 * h, null),
    ('b8000000-0000-4000-8000-000000000003', org, 'ai_commitments', null, null,
     '[{"t":"I noticed 2 new commitments in yesterday’s chats"}]', 'Waiting for your confirmation',
     null, t0 + 7 * h + 2 * mi, t0 + 7 * h + 2 * mi),
    ('b8000000-0000-4000-8000-000000000004', org, 'payment', c_neha, null,
     '[{"t":"Neha paid "},{"t":"₹18,000","b":true},{"t":" · INV-0087 settled"}]', 'Mon',
     null, t0 - mon * d + 14 * h, t0 - mon * d + 14 * h),
    ('b8000000-0000-4000-8000-000000000005', org, 'task', null, null,
     '[{"t":"Sana completed “Measure Store 4”"}]', 'Mon',
     null, t0 - mon * d + 12 * h, t0 - mon * d + 12 * h);

  -- ───────────── follow-up inbox (InboxItem) ─────────────
  insert into public.followup_suggestions (id, org_id, customer_id, bucket, what, why, why_tone, why_ai, amount, action_label, action_variant, at, dedupe_key) values
    ('b9000000-0000-4000-8000-000000000001', org, c_rahul,  'needs_reply', 'Waiting for revised quotation',  'Promised yesterday',                 'warn',    false, null,  'Send now',  'primary',   t0 - mon * d + 18 * h + 31 * mi, 'seed:rahul'),
    ('b9000000-0000-4000-8000-000000000002', org, c_priya,  'needs_reply', 'Asked when delivery arrives',    'Reply drafted from dispatch notes',  'acc',     true,  null,  'Review',    'tonal',     t0 - 2 * d + 9 * h + 12 * mi,    'seed:priya'),
    ('b9000000-0000-4000-8000-000000000003', org, c_aman,   'needs_reply', 'Wants a payment link',           'ready to collect',                   'neutral', false, 40000, 'Send link', 'secondary', t0 - 3 * d + 11 * h,             'seed:aman'),
    ('b9000000-0000-4000-8000-000000000004', org, c_meera,  'needs_reply', 'Asked for the catalogue, twice', 'New customer · Instagram',           'neutral', false, null,  'Share',     'secondary', t0 - 6 * d + 18 * h,             'seed:meera'),
    ('b9000000-0000-4000-8000-000000000005', org, c_kavya,  'waiting',     'Viewed the quotation twice',     'No reply in 12 days',                'neutral', false, null,  'Nudge',     'secondary', t0 - 12 * d + 10 * h,            'seed:kavya'),
    ('b9000000-0000-4000-8000-000000000006', org, c_dev,    'waiting',     'Getting back after their audit', 'Said he’d reply this week',          'neutral', false, null,  'Check in',  'secondary', t0 - 9 * d + 10 * h,             'seed:dev'),
    ('b9000000-0000-4000-8000-000000000007', org, c_vikram, 'waiting',     'Thinking about café shelves',    'New · Instagram',                    'neutral', false, null,  'Follow up', 'secondary', t0 - sun * d + 19 * h,           'seed:vikram');

  -- ───────────── integrations (no secrets — token_secret_id stays null) ─────────────
  -- The WhatsApp row's external_account_id is the phone_number_id webhooks are routed by.
  insert into public.integration_accounts (id, org_id, provider, name, status, detail, external_account_id, last_sync_at) values
    ('ba000000-0000-4000-8000-000000000001', org, 'instagram', 'Instagram',         'paused',    'Paused · permission expired yesterday', null,              t0 - 1 * d + 10 * h),
    ('ba000000-0000-4000-8000-000000000002', org, 'whatsapp',  'WhatsApp Business', 'connected', '214 chats from the last 90 days',       '100000000000001', now() - 2 * mi),
    ('ba000000-0000-4000-8000-000000000003', org, 'gmail',     'Gmail',             'connected', 'Quotes, invoices, threads',             null,              now() - 5 * mi),
    ('ba000000-0000-4000-8000-000000000004', org, 'calls',     'Phone calls',       'connected', 'Call log + voice notes',                null,              now() - 9 * mi),
    ('ba000000-0000-4000-8000-000000000005', org, 'payments',  'Payments',          'available', 'Send links, see who paid',              null,              null),
    ('ba000000-0000-4000-8000-000000000006', org, 'calendar',  'Calendar',          'available', 'Site visits and calls',                 null,              null);

  -- ───────────── contact policies (Quiet Hours) ─────────────
  insert into public.contact_policies (id, org_id, customer_id, preferred_channel, preferred_hours_start, preferred_hours_end, max_messages_per_week, opted_out, notes) values
    ('bb000000-0000-4000-8000-000000000001', org, c_priya, 'phone',    '17:00', '20:30', 3,    false, 'Prefers calls after 5 pm'),
    ('bb000000-0000-4000-8000-000000000002', org, c_rahul, 'whatsapp', '10:00', '20:00', 4,    false, null),
    ('bb000000-0000-4000-8000-000000000003', org, c_aman,  'whatsapp', null,    null,    2,    false, null);
end;
$seed$;
