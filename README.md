# Nudge — AI business memory

> Your business remembers every customer conversation, promise, preference and next step — without CRM data entry.

Nudge is a micro-CRM for 1–10 person businesses that work over WhatsApp, calls and email. Instead of asking people
to maintain a database, it turns normal conversations into **customer memory**, detects **promises**
("I'll send the quote tomorrow") and tells you **what you need to know or do right now**.

| | |
|---|---|
| Product plan | [docs/product-plan.md](docs/product-plan.md) |
| Architecture diagram | [docs/architecture.excalidraw](docs/architecture.excalidraw) (open in excalidraw.com) |
| Design system + all screens | [docs/design/screens](docs/design/screens) · HTML source in [docs/design/source](docs/design/source) |
| Contributor brief | [docs/BUILD_BRIEF.md](docs/BUILD_BRIEF.md) |
| Backend setup | [supabase/README.md](supabase/README.md) |

## Repository layout

```
app/                 Expo SDK 57 · Expo Router · TypeScript (iOS, Android, tablet, web preview)
  src/app/           routes (file-based): (tabs)/ home·customers·inbox·insights·more, onboarding/, customer/[id]/, …
  src/components/    design-system primitives (Txt, Button, Card, AiCard, Badge, Sheet, TabBar, …)
  src/theme/         tokens from "Design system 1.0" (light + dark), ThemeProvider
  src/data/          domain types, demo seed, local store (actions), selectors (risk, health, ranking)
  src/lib/           formatting (₹ Indian grouping, dates), on-device AI stand-in, Supabase client
  src/features/      screen-specific building blocks
supabase/            Postgres schema + RLS, seed, Edge Functions (WhatsApp webhook, AI extraction, copilot, scheduler)
docs/                plan, architecture, design references
```

## Run it

```bash
cd app && npm install
```

```bash
cd app && npx expo start
```

Press `w` for the web preview, or scan the QR code with Expo Go / a development build. With no Supabase
environment variables set, the app runs in **demo mode** on a seeded workspace ("Brightline Fixtures") that is
stored on-device — every action (complete a promise, confirm an extraction, add a customer) really changes state.

## Modes

- **Demo mode** (default, no env vars): a seeded workspace stored on-device. No account needed.
- **Cloud mode** (`EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `app/.env`): sign in with a 6-digit
  email code, create or join a workspace, and every action saves to Supabase (optimistic UI, re-sync on error,
  Realtime + foreground refresh). See [supabase/README.md](supabase/README.md) to set up a project.

### Run against a local backend (no Docker)

```bash
brew install postgresql@16 postgrest
```

```bash
dev/local-supabase/start.sh && node dev/local-supabase/smoke.mjs
```

```bash
node dev/local-supabase/web.mjs
```

The last command serves the app in cloud mode on http://localhost:8082 against the local API. The local auth stub has
no email codes, so sign in with the seeded accounts as described in [dev/local-supabase/README.md](dev/local-supabase/README.md).

## Build order (from the plan) and status

1. ✅ Product UX prototype — every designed screen, light/dark, phone + tablet
2. ✅ Database + authentication + tenant isolation — schema, RLS on every table, audit log
3. ✅ App ↔ backend — email-code sign-in, workspace creation and invites, cloud store, Realtime, AI extraction
   queued automatically for every event captured in the app (verified end to end against local Postgres)
4. ✅ Event ingestion model — immutable `conversation_events`, idempotent `webhook_events`
5. 🟡 AI extraction service — `ai-extract` edge function written and wired; needs a hosted project + `ANTHROPIC_API_KEY`
6. ✅ Promise Radar · 7. ✅ Follow-up inbox (+ scheduler, every 15 min via pg_cron) · 8. ✅ Search/copilot (server, with on-device fallback)
9. 🟡 WhatsApp integration — signed, idempotent webhook written; needs a Meta app + number to go live
10. ⬜ Push notifications · 11. ⬜ Security/audit hardening · 12. ⬜ Beta with 5–10 businesses

**Next phase:** push notifications, real voice transcription, then a hosted Supabase project for beta.

## Principles the code enforces

- AI never acts on its own: extractions are **pending** until a person confirms; outbound messages need a tap.
- Every AI-derived fact or promise links to its **source event** (the customer's own words).
- Raw events are immutable; AI output lives in separate tables so it can be re-processed.
- Every business row belongs to an organization and is protected by Row Level Security.
- Primary actions are ink; indigo is reserved for AI. Status is always dot + word.
