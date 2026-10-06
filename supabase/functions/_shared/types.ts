// Row shapes for the tables the edge functions touch (mirror supabase/migrations).
// Regenerate a full Database type with `supabase gen types typescript --local` if needed.

export type Channel = "whatsapp" | "phone" | "email" | "instagram" | "manual" | "upi";
export type MemberRole = "owner" | "member";
export type EventKind = "message" | "call" | "email" | "quote" | "payment" | "note" | "task" | "promise" | "followup";
export type Direction = "in" | "out" | "internal";
export type FactKind = "preference" | "temporal" | "note";
export type CommitmentStatus = "open" | "done" | "snoozed" | "dismissed";
export type Promisor = "us" | "customer";
export type AiStage = "extraction" | "copilot" | "summary" | "followup";
export type AiRunStatus = "running" | "succeeded" | "failed" | "rejected" | "skipped";

export type OrgRow = {
  id: string;
  name: string;
  sells: string | null;
  timezone: string;
  settings: {
    share_all_customers?: boolean;
    hand_off_when_away?: boolean;
    members_can_delete?: boolean;
    notifications?: "needs_you" | "all" | "off";
  };
};

export type MemberRow = {
  id: string;
  org_id: string;
  user_id: string | null;
  name: string;
  email: string;
  role: MemberRole;
  title: string | null;
  status: "active" | "invited";
};

export type CustomerRow = {
  id: string;
  org_id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  headline: string;
  summary: string | null;
  lifetime_value: number | string;
  owner_member_id: string | null;
  preferred_channel: Channel;
  archived_at: string | null;
};

export type EventRow = {
  id: string;
  org_id: string;
  customer_id: string;
  kind: EventKind;
  channel: Channel;
  direction: Direction;
  occurred_at: string;
  title: string;
  body: string | null;
  amount: number | string | null;
  ref: string | null;
  author_member_id: string | null;
};

export type FactRow = {
  id: string;
  org_id: string;
  customer_id: string;
  kind: FactKind;
  text: string;
  valid_until: string | null;
  source_event_id: string | null;
  confidence: number | string;
  superseded_by: string | null;
  created_at: string;
};

export type CommitmentRow = {
  id: string;
  org_id: string;
  customer_id: string;
  title: string;
  owner_member_id: string | null;
  due_at: string;
  status: CommitmentStatus;
  promisor: Promisor;
  source_event_id: string | null;
  quote: string | null;
  quote_by: string | null;
  completed_at: string | null;
  created_at: string;
};

export type ExtractionField = { key: string; label: string; value: string; checked: boolean };

/** Row returned by public.followup_candidates(). */
export type FollowupCandidate = {
  commitment_id: string;
  org_id: string;
  customer_id: string;
  customer_name: string;
  title: string;
  due_at: string;
  owner_member_id: string | null;
  promisor: Promisor;
  quote: string | null;
  org_timezone: string;
  policy_timezone: string | null;
  preferred_channel: Channel;
  preferred_hours_start: string | null; // "17:00:00"
  preferred_hours_end: string | null;
  max_messages_per_week: number | null;
  opted_out: boolean;
  outbound_last_7d: number | string;
};

/** Same contract as `CopilotAnswer` in app/src/lib/ai.ts, plus evidence ids. */
export type CopilotRow = { customerId: string; title: string; meta: string; tone?: "warn" | "ok" | "neutral" };
export type CopilotAnswer = {
  text: { t: string; b?: boolean }[];
  rows?: CopilotRow[];
  stats?: { value: string; label: string }[];
  actions: { label: string; kind: "ai" | "primary" | "secondary"; route?: string }[];
  evidence: string;
  understoodAs?: string;
};
export type CopilotResponse = CopilotAnswer & { evidenceEventIds: string[]; aiRunId: string | null };
