# Nudge — build brief for contributors

Nudge is an AI business memory for 1–10 person businesses (see `docs/product-plan.md`). The app is
**Expo SDK 57 + Expo Router + TypeScript** in `app/`. Backend is **Supabase** in `supabase/`.

## Sources of truth for UI
- Rendered boards: `docs/design/screens/*.png` (read the PNG for your screens first).
- Exact HTML/CSS source of every board: `docs/design/source/*.html` — copy, spacing, sizes, colours
  and copy text come from here. Each phone is 390×844, content padding `62px 20px 140px`.
- Design rules (from 00 · Foundations): every screen answers *what is important / what should I do / why
  should I care*. One status line on top. Every card ends in one action. Show the source — the customer's
  own words. Primary actions are **ink** (`variant="primary"`); **indigo is only for AI** (`variant="ai"`,
  `AiCard`, spark icon). Status is always **dot + word** (`Badge`), never colour alone, never alarm red for
  normal risk (use `warn`). Max weight 600. Glass only on floating layers (tab bar, sheets, toasts, ask bar).

## Code conventions
- Routes live in `app/src/app/` (expo-router, typed routes). Non-route code lives outside it.
- Import path alias `@/` → `app/src/`.
- **Use the shared primitives** from `@/components` (barrel): `Txt`, `Num`, `Button`, `IconButton`, `Icon`,
  `Avatar`, `AvatarStack`, `Badge`, `Dot`, `StatusLine`, `Chip`, `Segmented`, `Card`, `AiCard`, `AiLabel`,
  `Quote`, `Sep`, `SectionLabel`, `Input`, `Group`, `SettingsRow`, `Toggle`, `TimelineGlyph`, `Skeleton`,
  `SparkPulse`, `CheckCircle`, `Glass`, `Tap`, `Screen`, `TopBar`, `LargeTitle`, `AskBar`, `Sheet`,
  `useSheetClose`, `useToast`, `EmptyState`, `useIsTablet`, `Spinner`.
  Read `app/src/components/*.tsx` before writing a screen — don't re-invent them.
- Theme: `const { c, shadow, scheme } = useTheme()` from `@/theme/ThemeProvider`; tokens in `@/theme/tokens`.
  Never hard-code colours that exist as tokens. Shadows use CSS `boxShadow` strings (`shadow.e1/e2/e3`).
  Every screen must work in light **and** dark mode.
- Type ramp via `<Txt variant=…>`: `display` 34/40, `h1` 32/38, `section` 24/30, `h2` 22/28, `h3` 17/22,
  `t` 15/21, `body` 15/22 (t2), `s` 13.5/19 (t2), `meta` 12.5/16 (t3), `cap` 12 uppercase. Numerals/money
  in `<Num>` (Geist Mono). Money via `inr()` from `@/lib/format` (Indian grouping ₹1,12,000).
- Data: `const { state, actions } = useStore()` from `@/data/store`; derived views in `@/data/selectors`
  (`commitmentRisk`, `riskBadge`, `radar`, `needsYou`, `customerStatus`, `relationshipHealth`,
  `followUps`, `eventsFor`, `groupTimeline`, `customerCommitments`, `customerById`, `eventById`,
  `pendingExtractions`, `insights`). On-device AI stand-in: `@/lib/ai` (`extractCapture`, `answer`,
  `SUGGESTED`, `parseWhen`). Types in `@/data/types`. Never hard-code demo data in screens — read it
  from the store so actions (complete, snooze, confirm…) visibly change the UI.
- Sheets/modals: routes `capture`, `voice`, `extraction/[id]`, `customer/[id]/ask` are registered as
  transparent modals in `src/app/_layout.tsx`; render `<Sheet>` as their root. Close with `useSheetClose()`.
- Touch targets ≥ 44pt; every icon-only control has `accessibilityLabel`.
- Floating tab bar screens (the 5 tabs) use `<Screen tabBar …>`; the ask bar sits at `bottom={96}` on tabs and
  `bottom={24}` on detail screens.
- Tablet (≥768 wide, `useIsTablet()`): tab bar becomes a rail (already done); layouts should not stretch
  wider than ~720 for single-column content.

## Rules for parallel work
- Only edit the files you own (listed in your task). Shared files (`src/components/*`, `src/data/*`,
  `src/theme/*`, `src/lib/*`, `src/app/_layout.tsx`) are owned by the lead — if you need a change there,
  put a local helper in your own file or a new file under `src/features/<area>/`, and mention the
  shared change you'd recommend in your final report.
- Verify with `cd app && npx tsc --noEmit` — fix every error in **your** files (others may be mid-edit).
- Don't start dev servers; the lead verifies in the browser.
