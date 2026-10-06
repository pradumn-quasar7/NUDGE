import type {
  AppNotification,
  Commitment,
  Customer,
  CustomerEvent,
  CustomerFact,
  Extraction,
  InboxItem,
  Integration,
  Invoice,
  Member,
  Organization,
  Settings,
} from './types';

/**
 * Demo workspace — "Brightline Fixtures", the business used throughout the design files.
 * All times are relative to `now` so the demo always reads as "this week".
 */

const H = 3_600_000;
const D = 24 * H;

export function buildSeed(now = Date.now()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const t0 = today.getTime();
  /** n days ago at hh:mm */
  const at = (daysAgo: number, hh = 10, mm = 0) => t0 - daysAgo * D + hh * H + mm * 60_000;
  /** n days from today at hh:mm */
  const on = (daysAhead: number, hh = 18, mm = 0) => t0 + daysAhead * D + hh * H + mm * 60_000;
  /** Weekday offset: last occurrence of weekday (0=Sun) before today. */
  const lastWeekday = (wd: number) => {
    const diff = (today.getDay() - wd + 7) % 7 || 7;
    return diff;
  };
  const mon = lastWeekday(1);
  const sat = lastWeekday(6);
  const sun = lastWeekday(0);

  const org: Organization = {
    id: 'org_brightline',
    name: 'Brightline Fixtures',
    sells: 'Retail display fixtures & shelving',
    handles: ['Custom orders', 'Bulk quotes'],
    channels: ['whatsapp', 'phone', 'email'],
    plan: 'pro',
  };

  const members: Member[] = [
    { id: 'm_alex', name: 'Alex Fernandes', email: 'alex@brightline.in', role: 'owner', title: 'Owner', status: 'active' },
    { id: 'm_sana', name: 'Sana Qureshi', email: 'sana@brightline.in', role: 'member', title: 'Sales', status: 'active' },
    { id: 'm_ravi', name: 'Ravi Patel', email: 'ravi@brightline.in', role: 'member', title: 'Operations', status: 'active' },
    { id: 'm_neha_inv', name: 'neha@brightline.in', email: 'neha@brightline.in', role: 'member', status: 'invited', invitedAt: at(mon) },
  ];

  const cust = (c: Partial<Customer> & Pick<Customer, 'id' | 'name' | 'headline'>): Customer => ({
    preferredChannel: 'whatsapp',
    customerSince: at(120),
    lifetimeValue: 0,
    ownerId: 'm_alex',
    createdAt: at(120),
    ...c,
  });

  const customers: Customer[] = [
    cust({
      id: 'c_rahul',
      name: 'Rahul Sharma',
      company: 'Sharma Retail',
      phone: '+91 98200 11234',
      customerSince: new Date(today.getFullYear(), 2, 3).getTime(),
      lifetimeValue: 84_500,
      headline: 'Waiting for revised quotation',
      summary:
        'Rahul usually prefers WhatsApp and typically responds within 1–2 days. He is currently evaluating the premium package and finds pricing a little high.',
      summarySources: { messages: 14, calls: 2, updatedAt: at(0, 7, 2) },
    }),
    cust({
      id: 'c_priya',
      name: 'Priya Mehta',
      company: 'Mehta Home Stores',
      phone: '+91 98111 44120',
      preferredChannel: 'phone',
      customerSince: at(200),
      lifetimeValue: 1_46_000,
      headline: 'Delivery call · 11:00',
      summary:
        'Priya prefers calls after 5 pm. Her second order is usually about twice the first. She is waiting to hear when the Andheri delivery will arrive.',
      summarySources: { messages: 22, calls: 5, updatedAt: at(0, 7, 2) },
    }),
    cust({
      id: 'c_aman',
      name: 'Aman Verma',
      company: 'Verma Electronics',
      customerSince: new Date(today.getFullYear(), 0, 12).getTime(),
      lifetimeValue: 1_12_000,
      headline: 'Hasn’t replied in 6 days',
      summary:
        'Paid 2 of 3 invoices. Last message 6 days ago — usually replies the same day. Needs 50 units by the 28th and asked for a payment link for ₹40,000.',
      summarySources: { messages: 18, calls: 1, updatedAt: at(0, 8, 12) },
    }),
    cust({
      id: 'c_neha',
      name: 'Neha Kapoor',
      company: 'Kapoor Boutique',
      customerSince: at(160),
      lifetimeValue: 58_000,
      headline: 'Paid ₹18,000',
      summary: 'Neha pays on time over UPI and orders seasonally before festivals.',
      summarySources: { messages: 9, calls: 1, updatedAt: at(mon) },
    }),
    cust({
      id: 'c_vikram',
      name: 'Vikram Rao',
      customerSince: at(sun),
      createdAt: at(sun),
      preferredChannel: 'instagram',
      source: 'Instagram',
      headline: 'New · found you on Instagram',
      summary: 'New enquiry from Instagram about wall shelving for a café.',
      summarySources: { messages: 3, calls: 0, updatedAt: at(sun) },
    }),
    cust({
      id: 'c_meera',
      name: 'Meera Iyer',
      customerSince: at(8),
      createdAt: at(8),
      preferredChannel: 'instagram',
      source: 'Instagram',
      headline: 'Asked for the catalogue',
      summary: 'New customer from Instagram. Asked for the catalogue twice and has not received it yet.',
      summarySources: { messages: 4, calls: 0, updatedAt: at(6) },
    }),
    cust({
      id: 'c_arjun',
      name: 'Arjun Nair',
      company: 'Nair Supermart',
      customerSince: at(300),
      lifetimeValue: 2_40_000,
      headline: 'Usually reorders monthly — due now',
      summary: 'Arjun reorders gondola shelving roughly every month. His last order was 34 days ago.',
      summarySources: { messages: 31, calls: 6, updatedAt: at(1) },
    }),
    cust({
      id: 'c_dev',
      name: 'Dev Khanna',
      company: 'Khanna Pharma',
      customerSince: at(260),
      lifetimeValue: 96_000,
      headline: 'Last order Aug',
      summarySources: { messages: 12, calls: 2, updatedAt: at(9) },
    }),
    cust({
      id: 'c_kavya',
      name: 'Kavya Joshi',
      company: 'Joshi Opticals',
      customerSince: at(40),
      lifetimeValue: 0,
      headline: 'Quote viewed twice',
      summary: 'Kavya viewed the quotation twice but has not replied. Interested in the premium finish.',
      summarySources: { messages: 6, calls: 1, updatedAt: at(12) },
    }),
    cust({
      id: 'c_sunil',
      name: 'Sunil Gupta',
      company: 'Gupta Hardware',
      customerSince: at(400),
      lifetimeValue: 3_10_000,
      headline: 'Installation done · happy',
      summarySources: { messages: 40, calls: 9, updatedAt: at(2) },
    }),
    cust({
      id: 'c_farah',
      name: 'Farah Khan',
      company: 'Bloom Florists',
      customerSince: at(90),
      lifetimeValue: 34_000,
      headline: 'Shared layout photos',
      summarySources: { messages: 8, calls: 0, updatedAt: at(3) },
    }),
  ];

  let n = 0;
  const ev = (e: Omit<CustomerEvent, 'id'>): CustomerEvent => ({ id: `e_${++n}`, ...e });

  const events: CustomerEvent[] = [
    // Rahul
    ev({ customerId: 'c_rahul', kind: 'note', channel: 'manual', direction: 'internal', at: at(32, 11), title: 'Note', body: 'Prefers deliveries after 6 pm.', authorId: 'm_alex' }),
    ev({ customerId: 'c_rahul', kind: 'payment', channel: 'upi', direction: 'in', at: at(24, 13), title: 'Paid', amount: 22_500, ref: 'UPI · INV-0079' }),
    ev({ customerId: 'c_rahul', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(8, 16), title: 'Quotation requested', body: 'Can you send me a quote for the 4-tier racks?' }),
    ev({ customerId: 'c_rahul', kind: 'call', channel: 'phone', direction: 'out', at: at(7, 15), title: 'Call · 6 min', aiNote: 'Wants the premium finish for 3 stores.' }),
    ev({ customerId: 'c_rahul', kind: 'quote', channel: 'email', direction: 'out', at: at(6, 12), title: 'Quotation sent', amount: 62_000, ref: 'Q-0142 · email' }),
    ev({ customerId: 'c_rahul', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(sat, 17, 20), title: 'Asked for a discount', body: 'Any discount if we take more units?' }),
    ev({ customerId: 'c_rahul', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(mon, 18, 30), title: 'Asked for 50 units', body: 'Can you do 50 units of the 4-tier rack? Need them before Diwali.' }),
    ev({ customerId: 'c_rahul', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(mon, 18, 31), title: 'Price feedback', body: 'Also the price from last time was a bit high.' }),
    ev({ customerId: 'c_rahul', kind: 'message', channel: 'whatsapp', direction: 'out', at: at(mon, 18, 42), title: 'You replied', body: 'Yes, possible. I’ll send the updated quote tomorrow.', authorId: 'm_alex' }),
    // Priya
    ev({ customerId: 'c_priya', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(2, 9, 12), title: 'Asked when delivery arrives', body: 'Hi Alex, when will the delivery reach Andheri?' }),
    ev({ customerId: 'c_priya', kind: 'message', channel: 'whatsapp', direction: 'out', at: at(2, 9, 40), title: 'You replied', body: 'Should be Thursday. I’ll call you tomorrow to confirm the slot.', authorId: 'm_alex' }),
    ev({ customerId: 'c_priya', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(2, 9, 41), title: 'Okay, thanks.', body: 'Okay, thanks.' }),
    ev({ customerId: 'c_priya', kind: 'call', channel: 'phone', direction: 'out', at: at(40, 17, 30), title: 'Call · 12 min', aiNote: 'Second order will be roughly double the first.' }),
    // Aman
    ev({ customerId: 'c_aman', kind: 'payment', channel: 'upi', direction: 'in', at: at(30), title: 'Paid', amount: 36_000, ref: 'UPI · INV-0071' }),
    ev({ customerId: 'c_aman', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(sat, 11), title: 'Wants a payment link', body: 'Please send the payment link for the balance ₹40,000.' }),
    ev({ customerId: 'c_aman', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(0, 8, 12), title: 'Needs 50 units by the 28th', body: 'We will need 50 units by the 28th for the new branch.' }),
    // Neha
    ev({ customerId: 'c_neha', kind: 'payment', channel: 'upi', direction: 'in', at: at(mon, 14), title: 'Paid', amount: 18_000, ref: 'UPI · INV-0087' }),
    // Vikram
    ev({ customerId: 'c_vikram', kind: 'message', channel: 'instagram', direction: 'in', at: at(sun, 19), title: 'New enquiry', body: 'Do you make wall shelves for cafés?' }),
    // Meera
    ev({ customerId: 'c_meera', kind: 'message', channel: 'instagram', direction: 'in', at: at(8, 12), title: 'Asked for the catalogue', body: 'Could you share your catalogue?' }),
    ev({ customerId: 'c_meera', kind: 'message', channel: 'instagram', direction: 'in', at: at(6, 18), title: 'Asked for the catalogue again', body: 'Hi, still waiting for the catalogue 🙂' }),
    // Arjun / Dev / Kavya
    ev({ customerId: 'c_arjun', kind: 'quote', channel: 'email', direction: 'out', at: at(34), title: 'Order confirmed', amount: 48_000, ref: 'SO-0311' }),
    ev({ customerId: 'c_arjun', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(6), title: 'Thanks for the delivery', body: 'Received, thanks!' }),
    ev({ customerId: 'c_dev', kind: 'quote', channel: 'email', direction: 'out', at: at(50), title: 'Order delivered', amount: 32_000, ref: 'SO-0290' }),
    ev({ customerId: 'c_dev', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(9), title: 'Said he’ll come back after audit', body: 'Will get back after our audit.' }),
    ev({ customerId: 'c_kavya', kind: 'quote', channel: 'email', direction: 'out', at: at(14), title: 'Quotation sent', amount: 74_000, ref: 'Q-0139' }),
    ev({ customerId: 'c_kavya', kind: 'note', channel: 'manual', direction: 'internal', at: at(12), title: 'Quote viewed twice', body: 'Opened the quotation PDF twice.' }),
    ev({ customerId: 'c_sunil', kind: 'task', channel: 'manual', direction: 'internal', at: at(2), title: 'Installation complete', authorId: 'm_ravi' }),
    ev({ customerId: 'c_farah', kind: 'message', channel: 'whatsapp', direction: 'in', at: at(3), title: 'Shared layout photos', body: 'Sending photos of the shop layout.' }),
  ];

  const facts: CustomerFact[] = [
    { id: 'f1', customerId: 'c_rahul', kind: 'preference', text: 'Prefers WhatsApp', confidence: 0.92, createdAt: at(60) },
    { id: 'f2', customerId: 'c_rahul', kind: 'preference', text: 'Prefers deliveries after 6 pm', sourceEventId: 'e_1', confidence: 0.98, createdAt: at(32) },
    { id: 'f3', customerId: 'c_rahul', kind: 'temporal', text: 'Needs 50 × 4-tier rack before Diwali', validUntil: on(25), sourceEventId: 'e_7', confidence: 0.9, createdAt: at(mon) },
    { id: 'f4', customerId: 'c_rahul', kind: 'note', text: 'Finds price high', sourceEventId: 'e_8', confidence: 0.8, createdAt: at(mon) },
    { id: 'f5', customerId: 'c_priya', kind: 'preference', text: 'Prefers calls after 5 pm', confidence: 0.9, createdAt: at(90) },
    { id: 'f6', customerId: 'c_aman', kind: 'temporal', text: 'Needs 50 units by the 28th', validUntil: on(22), confidence: 0.88, createdAt: at(0, 8, 12) },
  ];

  const commitments: Commitment[] = [
    {
      id: 'p_rahul_quote',
      customerId: 'c_rahul',
      title: 'Send revised quotation',
      ownerId: 'm_alex',
      dueAt: Math.max(on(0, 18), Math.min(now + 7 * H, on(0, 23, 30))),
      status: 'open',
      promisor: 'us',
      sourceEventId: 'e_9',
      quote: 'Yeah, I’ll send the updated quote tomorrow.',
      quoteBy: 'You',
      confidence: 0.94,
      createdAt: at(mon, 18, 42),
      draftHint: 'Start from Q-0142 (₹62,000), updated to 50 units. He asked for a discount on Sat.',
    },
    {
      id: 'p_aman_link',
      customerId: 'c_aman',
      title: 'Send payment link to Aman',
      ownerId: 'm_alex',
      dueAt: Math.max(on(0, 19), Math.min(now + 5 * H, on(0, 23, 30))),
      status: 'open',
      promisor: 'us',
      sourceEventId: 'e_15',
      quote: 'Please send the payment link for the balance ₹40,000.',
      quoteBy: 'Aman',
      confidence: 0.9,
      createdAt: at(sat, 11),
    },
    {
      id: 'p_priya_call',
      customerId: 'c_priya',
      title: 'Call Priya regarding delivery',
      ownerId: 'm_alex',
      dueAt: on(1, 11),
      status: 'open',
      promisor: 'us',
      sourceEventId: 'e_11',
      quote: 'I’ll call you tomorrow to confirm the slot.',
      quoteBy: 'You',
      confidence: 0.92,
      createdAt: at(2, 9, 40),
    },
    {
      id: 'p_rahul_slots',
      customerId: 'c_rahul',
      title: 'Share installation slots',
      ownerId: 'm_alex',
      dueAt: on(3, 12),
      status: 'open',
      promisor: 'us',
      sourceEventId: 'e_4',
      quote: 'I’ll share the installation slots by Friday.',
      quoteBy: 'You',
      confidence: 0.86,
      createdAt: at(7, 15),
    },
    { id: 'p_meera_cat', customerId: 'c_meera', title: 'Share the catalogue with Meera', ownerId: 'm_sana', dueAt: on(2, 12), status: 'open', promisor: 'us', confidence: 0.8, createdAt: at(6) },
    { id: 'p_kavya_samples', customerId: 'c_kavya', title: 'Send premium finish samples', ownerId: 'm_sana', dueAt: on(3, 17), status: 'open', promisor: 'us', confidence: 0.82, createdAt: at(12) },
    { id: 'p_sunil_invoice', customerId: 'c_sunil', title: 'Send final installation invoice', ownerId: 'm_ravi', dueAt: on(4, 12), status: 'open', promisor: 'us', confidence: 0.9, createdAt: at(2) },
    { id: 'p_farah_layout', customerId: 'c_farah', title: 'Suggest a layout for Bloom', ownerId: 'm_alex', dueAt: on(5, 12), status: 'open', promisor: 'us', confidence: 0.75, createdAt: at(3) },
    // Kept this week
    ...['Share delivery slot with Neha', 'Send GST invoice to Sunil', 'Confirm colour swatches with Farah', 'Call Dev about audit dates', 'Send Arjun the reorder list', 'Book transport for Priya', 'Share warranty card with Neha'].map(
      (title, i): Commitment => ({
        id: `p_done_${i}`,
        customerId: ['c_neha', 'c_sunil', 'c_farah', 'c_dev', 'c_arjun', 'c_priya', 'c_neha'][i],
        title,
        ownerId: i % 3 === 0 ? 'm_sana' : 'm_alex',
        dueAt: at(Math.min(i, 5)),
        status: 'done',
        promisor: 'us',
        confidence: 0.9,
        createdAt: at(8),
        completedAt: at(Math.min(i, 5), 16),
      }),
    ),
  ];

  const extractions: Extraction[] = [
    {
      id: 'x_rahul',
      customerId: 'c_rahul',
      sourceEventId: 'e_9',
      sourceLabel: 'From your reply at 6:42 pm.',
      title: 'Send revised quotation to Rahul tomorrow.',
      dueAt: on(0, 18),
      fields: [
        { key: 'requirement', label: 'Requirement', value: '50 × 4-tier rack', checked: true },
        { key: 'deadline', label: 'Deadline', value: 'before Diwali', checked: true },
        { key: 'note', label: 'Note', value: 'finds price high', checked: false },
      ],
      status: 'confirmed',
      createdAt: at(mon, 18, 43),
    },
    {
      id: 'x_kavya',
      customerId: 'c_kavya',
      sourceLabel: 'From Kavya’s WhatsApp, yesterday 5:10 pm.',
      title: 'Call Kavya on Thursday about the premium finish.',
      dueAt: on(2, 12),
      fields: [
        { key: 'interest', label: 'Interest', value: 'Premium finish', checked: true },
        { key: 'budget', label: 'Budget', value: 'around ₹70,000', checked: true },
      ],
      status: 'pending',
      createdAt: at(1, 17, 10),
    },
    {
      id: 'x_vikram',
      customerId: 'c_vikram',
      sourceLabel: 'From Vikram’s Instagram DM, yesterday 7:30 pm.',
      title: 'Send café wall-shelf options to Vikram.',
      dueAt: on(1, 12),
      fields: [
        { key: 'requirement', label: 'Requirement', value: 'Wall shelves · café', checked: true },
        { key: 'note', label: 'Note', value: 'opening next month', checked: false },
      ],
      status: 'pending',
      createdAt: at(1, 19, 30),
    },
  ];

  const notifications: AppNotification[] = [
    {
      id: 'n1',
      kind: 'customer',
      customerId: 'c_rahul',
      title: [{ t: 'Rahul', b: true }, { t: ' accepted the revised quote' }],
      meta: 'WhatsApp',
      at: at(0, 9, 14),
      read: false,
      actions: [{ label: 'Create invoice', primary: true }, { label: 'Reply' }],
    },
    {
      id: 'n2',
      kind: 'promise_due',
      customerId: 'c_priya',
      title: [{ t: 'Promise due in 2 hours: ' }, { t: 'call Priya about delivery', b: true }],
      meta: 'Promise Radar',
      at: at(0, 9),
      read: false,
    },
    {
      id: 'n3',
      kind: 'ai_commitments',
      title: [{ t: 'I noticed 2 new commitments in yesterday’s chats' }],
      meta: 'Waiting for your confirmation',
      at: at(0, 7, 2),
      read: true,
    },
    {
      id: 'n4',
      kind: 'payment',
      customerId: 'c_neha',
      title: [{ t: 'Neha paid ' }, { t: '₹18,000', b: true }, { t: ' · INV-0087 settled' }],
      meta: 'Mon',
      at: at(mon, 14),
      read: true,
    },
    {
      id: 'n5',
      kind: 'task',
      title: [{ t: 'Sana completed “Measure Store 4”' }],
      meta: 'Mon',
      at: at(mon, 12),
      read: true,
    },
  ];

  const inbox: InboxItem[] = [
    { id: 'i_rahul', customerId: 'c_rahul', bucket: 'needs_reply', what: 'Waiting for revised quotation', why: 'Promised yesterday', whyTone: 'warn', action: { label: 'Send now', variant: 'primary' }, at: at(mon, 18, 31) },
    { id: 'i_priya', customerId: 'c_priya', bucket: 'needs_reply', what: 'Asked when delivery arrives', why: 'Reply drafted from dispatch notes', whyTone: 'acc', whyAi: true, action: { label: 'Review', variant: 'tonal' }, at: at(2, 9, 12) },
    { id: 'i_aman', customerId: 'c_aman', bucket: 'needs_reply', what: 'Wants a payment link', why: 'ready to collect', whyTone: 'neutral', amount: 40_000, action: { label: 'Send link', variant: 'secondary' }, at: at(3, 11) },
    { id: 'i_meera', customerId: 'c_meera', bucket: 'needs_reply', what: 'Asked for the catalogue, twice', why: 'New customer · Instagram', whyTone: 'neutral', action: { label: 'Share', variant: 'secondary' }, at: at(6, 18) },
    { id: 'i_kavya', customerId: 'c_kavya', bucket: 'waiting', what: 'Viewed the quotation twice', why: 'No reply in 12 days', whyTone: 'neutral', action: { label: 'Nudge', variant: 'secondary' }, at: at(12) },
    { id: 'i_dev', customerId: 'c_dev', bucket: 'waiting', what: 'Getting back after their audit', why: 'Said he’d reply this week', whyTone: 'neutral', action: { label: 'Check in', variant: 'secondary' }, at: at(9) },
    { id: 'i_vikram', customerId: 'c_vikram', bucket: 'waiting', what: 'Thinking about café shelves', why: 'New · Instagram', whyTone: 'neutral', action: { label: 'Follow up', variant: 'secondary' }, at: at(sun, 19) },
  ];

  const integrations: Integration[] = [
    { id: 'int_ig', name: 'Instagram', kind: 'instagram', status: 'paused', detail: 'Paused · permission expired yesterday', lastSyncAt: at(1) },
    { id: 'int_wa', name: 'WhatsApp Business', kind: 'whatsapp', status: 'connected', detail: '214 chats from the last 90 days', lastSyncAt: now - 2 * 60_000 },
    { id: 'int_gmail', name: 'Gmail', kind: 'gmail', status: 'connected', detail: 'Quotes, invoices, threads', lastSyncAt: now - 5 * 60_000 },
    { id: 'int_calls', name: 'Phone calls', kind: 'calls', status: 'connected', detail: 'Call log + voice notes', lastSyncAt: now - 9 * 60_000 },
    { id: 'int_pay', name: 'Payments', kind: 'payments', status: 'available', detail: 'Send links, see who paid' },
    { id: 'int_cal', name: 'Calendar', kind: 'calendar', status: 'available', detail: 'Site visits and calls' },
  ];

  const invoices: Invoice[] = [0, 1, 2].map((i) => {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    return { id: `inv_${i}`, date: d.getTime(), amount: 1499, status: 'paid' as const };
  });

  const settings: Settings = {
    shareAllCustomers: true,
    handOffWhenAway: true,
    membersCanDelete: false,
    notifications: 'needs_you',
  };

  return {
    org,
    me: 'm_alex',
    members,
    customers,
    events,
    facts,
    commitments,
    extractions,
    notifications,
    inbox,
    integrations,
    invoices,
    settings,
  };
}

export type SeedData = ReturnType<typeof buildSeed>;
