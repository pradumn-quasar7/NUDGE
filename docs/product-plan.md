# Micro-CRM / Business Memory Platform

## Product thesis
Traditional CRM asks a 1–5 person business to maintain a database. This product should make the business's normal communication become the database.

**Positioning:** Your business remembers every customer conversation, promise, preference and next step — without CRM data entry.

## Core problem
Micro-businesses often work through WhatsApp, calls, email, spreadsheets and memory. The failure mode is not lack of contacts; it is lost context and missed commitments.

## Product principles
1. Zero/near-zero manual data entry.
2. Conversation-first, not pipeline-first.
3. Customer memory is the primary object.
4. Follow-up is an outcome, not a task-management ritual.
5. AI suggestions must be explainable and editable.
6. Automation must require explicit consent for outbound actions.
7. Strong tenant isolation and auditability from day one.

## Out-of-box features

### 1. Promise Radar
Detect statements such as “I’ll send the quote tomorrow”, “call me Friday”, or “I’ll check and get back to you”. Turn them into commitments with owner, due date, confidence and source message.

### 2. Customer Memory
Maintain durable facts and temporal facts separately. Example: “prefers WhatsApp” is a stable preference; “needs 50 units this month” is time-bound. Every AI-derived fact links back to its source event.

### 3. Context Resume
When a user opens a customer, show a 15-second briefing: last interaction, open promises, current request, unresolved issues, sentiment trend (optional), and suggested next action.

### 4. Follow-up Autopilot
Do not show a giant task list. Rank the 3–5 customers that need attention now, with a reason: overdue promise, high intent, unanswered quote, or expected decision date approaching.

### 5. Conversation-to-CRM
Incoming messages become events automatically. Extract contact identity, intent, product/service, amount, dates, commitments and next steps. User can correct extracted data.

### 6. “What did I promise?” search
Natural language queries over business memory: “Who am I waiting on?”, “Which customers asked for a revised quote?”, “What did I promise Rahul?”

### 7. Customer Handoff Brief
For a team member joining a customer conversation, generate a concise handoff: history, current state, commitments, sensitive notes, and recommended next action.

### 8. Relationship Health, not lead score
Avoid opaque lead scores. Explain relationship health using observable signals: response delay, unresolved promises, repeat purchase, quote activity, and inactivity.

### 9. Quiet Hours / Contact Policy
Per-customer communication rules: preferred channel, preferred hours, frequency limits and opt-out state. Prevent “automation spam”.

### 10. Conversation Evidence
Every AI-derived customer fact or commitment has a source link to the original event. This is a key trust feature.

## MVP scope
Do not build a full CRM.

**MVP:**
- iOS + Android app
- authentication
- business/workspace creation
- contacts/customers
- manual conversation/event capture
- WhatsApp webhook integration where approved/available
- customer timeline
- AI extraction
- Promise Radar
- follow-up inbox
- natural-language customer search
- push notifications
- audit trail

## Phase 2
- email integration
- calendar integration
- voice-note transcription
- quotation/document events
- team assignment
- customer handoff briefs
- configurable communication policies
- analytics

## Phase 3
- predictive churn/retention signals
- recommended next best action
- automatic quote follow-up drafts
- customer reactivation campaigns
- business memory graph
- workflow automation

## Architecture

### Client
React Native + Expo + TypeScript. One codebase for iOS and Android; use native modules only when platform-specific behavior is needed.

### Backend
Supabase initially:
- Postgres for relational business data
- Auth for identity
- Storage for attachments/audio
- Realtime for live team updates
- Edge Functions for API endpoints, webhooks and integration logic

A dedicated Python/Node service can be introduced later for long-running AI orchestration or high-volume jobs.

### AI pipeline
`raw event -> normalization -> extraction -> validation -> memory write -> commitment detection -> follow-up ranking`

Keep raw events immutable. Store AI outputs separately so they can be reprocessed when prompts/models change.

### Core data model
- organizations
- organization_members
- customers
- customer_identities
- conversations
- conversation_events
- messages
- customer_facts
- commitments
- tasks
- interactions
- attachments
- integration_accounts
- webhook_events
- ai_runs
- audit_logs

### Security
- Every business object belongs to an organization.
- Row Level Security on tenant-owned tables.
- Least-privilege service roles.
- Signed webhook verification.
- Idempotency keys for webhook processing.
- Audit log for important changes.
- Explicit consent for outbound automated messages.
- Never let an LLM directly execute arbitrary database or messaging actions; use typed tools with authorization checks.

## Critical workflows

### Incoming WhatsApp message
`WhatsApp -> webhook -> signature verification -> idempotency check -> normalize -> store raw event -> AI extraction -> update customer memory -> detect commitment -> rank follow-up -> notify user`

### User asks “What did I promise?”
`mobile -> authenticated API -> retrieval over customer events/facts/commitments -> answer with source events -> user can open original evidence`

### Follow-up
`commitment due -> scheduler/worker -> policy check -> create suggestion -> user approves -> send through integration -> record outbound event`

## Product moat
The moat should not be “we use an LLM.”

The moat becomes the **business memory graph**:
- customer identity resolution
- temporal facts
- promises
- interaction history
- outcomes
- communication preferences
- source evidence

Over time the system learns how a particular business operates without forcing the business to configure a complex CRM.

## Metrics
North-star: **customer commitments successfully completed without manual CRM administration.**

Track:
- time-to-first-value
- % of interactions automatically captured
- extraction correction rate
- commitments detected / fulfilled
- missed follow-up rate
- weekly active businesses
- customers per active business
- retention
- outbound automation approval rate

## Build order
1. Product UX prototype
2. Database + authentication + tenant isolation
3. Customer/contact timeline
4. Event ingestion model
5. AI extraction service
6. Promise Radar
7. Follow-up inbox
8. Search/copilot
9. WhatsApp integration
10. Notifications
11. Security/audit hardening
12. Beta with 5–10 real micro-businesses

## What NOT to build initially
- complex sales pipelines
- dozens of custom fields
- enterprise permissions
- marketing automation
- giant dashboards
- lead scoring
- generic chatbot
- complicated workflow builders
- 20 integrations

The first version should answer one question extremely well:

**“What do I need to know or do about my customers right now?”**
