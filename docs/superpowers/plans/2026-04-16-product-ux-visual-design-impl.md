# MetaPrompt — Product UX & Visual Design: Implementation Plan

- Spec: `docs/superpowers/specs/2026-04-16-product-ux-visual-design.md`
- Status: in progress
- Sequencing rule: each phase must leave `main` in a shippable state. No phase depends on the next one being done to make sense to the user.

---

## Phase map

| # | Phase | Files (primary) | Acceptance |
|---|-------|-----------------|------------|
| 1 | Design system foundation | `styles/primitives.css`, `styles/marketing-register.css`, `index.css`, `components/Layout.tsx` | `body.register-marketing` switches on `/welcome` & `/login` & `/onboarding`; all new tokens available globally; no visual regressions in `product` register |
| 2 | Landing rewrite | `pages/Welcome.tsx`, `pages/Welcome.module.css` | Zero inline styles; hero + demo strip + how + for-who + trust + FAQ all in `register-marketing`; uses `/api/demo/generate` (already exists) |
| 3 | i18n minimal | `i18n/index.ts`, `i18n/ru.ts`, `i18n/en.ts`, header switcher | Landing + Onboarding + Auth + 404 fully translatable, switcher in header |
| 4 | Onboarding rewrite | `pages/OnboardingPreferences.tsx` (renamed to `Onboarding.tsx`), `pages/Onboarding.module.css` | 3-step progressive flow; ends with a real generated prompt loaded in Studio |
| 5 | Studio polish | `components/GenerationOutput.tsx` (if exists) or `Home.tsx`, `lib/reveal.ts`, hotkeys | Skeletons + typewriter reveal (first 500ms) + ⌘Enter/⌘K/Esc/⌘/ + seed example card |
| 6 | ⌘K Command palette | `components/CommandPalette.tsx`, `lib/hotkeys.ts` | Opens globally; library search; commands listed in spec §10.1 |
| 7 | Library-as-product | `pages/library/PromptsPanel.tsx`, new `LibrarySidebar`, new `PromptDrawer` | Smart views sidebar, drawer on click, card preview, search |
| 8 | Compare v2 (frontend + backend) | `pages/Compare.tsx`, `backend/api/compare.py`, `services/llm_client.py` usage | 3 modes, on-target run, diff toggle, judge bar-chart, winner actions, rounds history |
| 9 | Backend migrations + public health | `db/manager.py` (`_migrate_phase18`), `backend/api/public.py`, `backend/api/compare.py` extensions | New endpoints live, migration idempotent |

## Phase 1 — Design system foundation

**Goal.** Add shared primitive tokens (`--r-card`, `--shadow-soft`, `--duration-fast`, `--font-display-xl`, etc.) and a runtime register override. User-facing impact: none yet. Code impact: other phases can stop using inline styles and magic numbers.

**Tasks.**
1. Add `frontend/public/fonts/` with self-hosted `Source Serif 4 Italic` subset (Cyrillic + Latin, 600/700 weights). If offline fonts pipeline too heavy for MVP, use Google Fonts `@import` extension in `index.css` (we already ship fonts via `fonts.googleapis.com` — adding one family is consistent with the current approach, and avoids introducing a binary-asset PR). **Decision in the moment: use Google Fonts** for now; self-hosting is tracked as a follow-up (does not block).
2. Create `frontend/src/styles/primitives.css`:
   - radii (`--r-card`, `--r-control`, `--r-pill`)
   - shadows (`--shadow-soft`, `--shadow-ring`)
   - motion (`--duration-fast/med`, `--ease-out`)
   - type scale (`--fs-display-xl/lg`, `--fs-title`, `--fs-body`, `--fs-meta`, `--fs-micro`)
   - `--font-serif-italic`
3. Create `frontend/src/styles/marketing-register.css`:
   - `body.register-marketing { --bg: #f8f5f0; --text: #1a1410; --primary: #c45f28; ... }`
   - also sets `color-scheme: light` and a faint grid `--grid-line`.
4. Import both into `src/index.css` (after `theme-palettes.css`).
5. `components/Layout.tsx`: compute `register = isWelcomePublic || location.pathname === '/login' || location.pathname === '/onboarding' ? 'marketing' : 'product'`, apply to `document.body` via effect.

**Acceptance.**
- `/home` and `/library` look identical to before.
- `/welcome` body has class `register-marketing`; `--bg` resolves to `#f8f5f0` in devtools.
- Theme switcher still works on `/home`.

## Phase 2 — Landing rewrite

**Goal.** Replace `Welcome.tsx` with the layout described in spec §5, using only tokens from Phase 1. No inline styles. i18n keys wired but default strings still RU (Phase 3 adds EN).

**Tasks.**
1. Rewrite `Welcome.tsx` with sections: hero, demo strip, how (3 scenes), for-who, trust, faq, footer. All strings as `t('landing.…')`.
2. New `Welcome.module.css` using the register palette + primitives. (Keep `Landing.module.css` as legacy for now; it can be deleted in Phase 2 cleanup.)
3. Demo strip uses `api.demoGenerate`. Result rendered with the (not-yet-built) `<TypewriterReveal/>` from Phase 5 **—** for now, plain render; we'll retrofit typewriter in Phase 5.
4. Trust section: placeholder markup; the live data comes from Phase 9's `/api/public/model-health-snapshot`. Until then, static mock in-code clearly marked with `// TODO(phase-9)`.
5. FAQ: accordion with 6 rows from spec §5.7, content migrated from the current hero paragraph.

**Acceptance.**
- `grep -n 'style={{' frontend/src/pages/Welcome.tsx` = no matches.
- Visual QA against mockup direction B+C.
- Landing strings exist in `i18n/ru.ts` even if `en.ts` is empty at this phase.

## Phases 3–9

Same structure, shorter. Each builds on the previous, none critical-path for Phase 1-2 merging.

**Phase 3 — i18n**:
- `LanguageContext` + `useT` + lazy-loaded dicts.
- Switcher button in `Layout` header (both registers).
- Populate `en.ts` for all landing keys first, onboarding next.
- Persistence: `localStorage['metaprompt-lang']`, default from `navigator.language`.

**Phase 4 — Onboarding**:
- Rewrite as 3-step scroll flow; preserve existing API to save preferences + add `user_goal`, `default_tier` (migration in Phase 9).
- Step 3 hits `/api/generate` with user's chosen defaults and writes result to a new `recentSessions` entry so `/home` already shows it.

**Phase 5 — Studio polish**:
- `lib/reveal.ts` with `useTypewriterReveal`.
- Retrofit into Welcome demo and Onboarding Step 3.
- Add hotkeys in `Home.tsx`.
- Add "seed example" card when `recentSessions.length === 0`.
- Replace spinners with shimmering skeleton in generation output.

**Phase 6 — ⌘K**:
- Global listener.
- Components: `CommandPalette.tsx`, `CommandList.tsx`, fuzzy matcher in `lib/fuzzy.ts`.
- Integration points: open command, recent compare, switch theme (hidden in marketing register per spec §10.1), switch language.

**Phase 7 — Library drawer + smart views**:
- New `LibrarySidebar.tsx` with static smart-view definitions.
- New `PromptDrawer.tsx`.
- URL sync: `?open=<id>`.
- Reuse `SimpleLineDiff` for versions.

**Phase 8 — Compare v2**:
- Frontend: three-tab layout, per-column on-target run with token-cost preview, diff toggle, judge bar-chart, winner menu, `compareRecent.ts`.
- Backend: `POST /api/compare/run-on-target`, extended `/api/compare/judge` response shape (backward compatible), rate limiting against host key and per-user `compare_rounds_per_day`.

**Phase 9 — Migrations + public health**:
- `_migrate_phase18_onboarding_profile`: `preferences.user_goal TEXT NULL`, `preferences.default_tier TEXT NULL`, `user_usage_limits.compare_rounds_per_day INTEGER NULL`.
- `GET /api/public/model-health-snapshot` — reads existing `model_health` table, projects to tier/mode statuses, cache 5 min.

---

## Work order in this session

Doing now: **Phase 1 → Phase 2**. Stopping after that. Subsequent phases in follow-up sessions.

Reason for the break after Phase 2: landing is a demonstrable visible step ("look, new landing"); phases 3-9 are deeper and each wants its own code review. Packaging 9 phases into one giant diff is a merge-and-review anti-pattern.
