# MetaPrompt — Product UX & Visual Design Spec

- Created: 2026-04-16
- Status: draft, awaiting review
- Authors: brainstorm session with product owner
- Scope: visual identity, landing, onboarding, studio polish, library-as-product, Compare v2, command palette, i18n
- Out of scope (bucket 2): public shareable prompts, batch eval, prompt import from ChatGPT/Claude conversations, rich empty-states

---

## 1. Why

The product works functionally — but visually and in UX terms it reads as *assembled by a robot*. Concretely:

- `Welcome.tsx` opens with a 5-line paragraph about OpenRouter keys, trial limits, and server-side saving before the user has any idea what the product does. All styles are inline, bypassing the theme tokens.
- `OnboardingPreferences.tsx` is three native `<select>` / `<radio>` controls for settings whose business meaning (heuristic vs LLM classifier, simple-improve preset) a beginner cannot decode.
- `Compare.tsx` compares *only the text of two prompts* — it does not run them on a target model, which is what users actually want from A/B. The judge's per-criterion scores are rendered as `JSON.stringify(...)`.
- The design system has 6+ theme palettes with real tokens (`--primary`, `--accent`, `--panel`, `--text`, `--muted`), but new marketing surfaces don't use them.
- There is no global command surface, no keyboard-driven flow, no preview-on-hover in the library — nothing that makes the product feel "alive".

This spec addresses all of the above within a constrained scope. Cross-flow scenarios and batch evaluation are explicitly deferred.

## 2. Goals & non-goals

### Goals

1. Establish a **two-register visual system**: marketing/public surfaces (landing, onboarding, auth, docs, 404) look editorial-warm; product surfaces (Studio, Library, Compare, Admin) stay on the existing warm-dark theme set.
2. Replace the current landing with a **two-entry hero** that serves beginners and advanced users in parallel, backed by a working in-page demo.
3. Replace the current onboarding with a **progressive 3-step flow** that produces a real first prompt within ~60 seconds.
4. Polish Studio without restructuring it — skeletons, streaming-feel, hotkeys, empty-state seed.
5. Turn Library from a flat grid into a working surface: smart groups, tag filters, preview drawer, diff viewer.
6. Rebuild Compare v2: three comparison modes, on-target execution, diff, structured judge visualisation, one-click "winner → Studio/Library".
7. Add ⌘K command palette.
8. Introduce a minimal RU/EN i18n layer (no external library).

### Non-goals (this iteration)

- Rewriting Studio layout. Only visual polish of existing components.
- Replacing current themes. We keep all 6+ palettes and the switcher.
- Moving the landing to a separate static/Next build — stays inside the React SPA.
- Public read-only share links, batch evaluation, external import (from ChatGPT/Claude export), multi-tenant/teams. These go to bucket 2.

## 3. Users & pains this spec actually addresses

Three composite personas. Each pain below is tagged with the section that solves it.

### Аня (beginner, 6 months of ChatGPT)
- **P1**. First screen is a wall of text about keys and limits. → §5 Landing.
- **P2**. After "try without sign-up" lands in Studio with ~15 controls — no guidance. → §7 Studio polish (seed example, skeleton), §5 Landing demo.
- **P3**. Onboarding asks about "heuristic vs LLM classifier" — meaningless to her. → §6 Onboarding.
- **P4**. Gets a prompt — doesn't know what to do with it. → §7 Studio ("Open in ChatGPT/Claude" deep link is bucket 2, but we add at least a "copy as markdown" hint).

### Максим (advanced indie dev)
- **P5**. Wants to see prompts actually run on target models side-by-side. Current Compare doesn't do that. → §9 Compare v2.
- **P6**. Wants keyboard-first flow. → §7 Studio hotkeys, §10 ⌘K.
- **P7**. Has 30 prompts in a flat grid, can't find "the good one". → §8 Library-as-product.
- **P8**. Needs diff between prompt versions and between A/B variants. → §8 Library, §9 Compare.

### Лиза (prompt engineer, client-facing)
- **P11**. Judge output as raw JSON is undemonstrable to a client. → §9 Compare v2 judge visualisation.

Pains 9 (reproducibility of tier→model mapping at a past date), 10 (share link with verdict), 12 (batch eval) are **bucket 2**. They are listed in §13 so they are not forgotten.

## 4. Design system

### 4.1 Two registers, one palette

We do **not** introduce a new palette. We split existing `--primary / --accent / --panel / --text / --muted` tokens into two runtime scopes:

- **`product` scope** (default): uses the current `theme-palettes.css` tokens, unchanged. Applies everywhere inside `/home`, `/library`, `/compare`, `/admin`, `/settings`.
- **`marketing` scope**: applied only on the body of `/`, `/welcome`, `/login`, `/onboarding`, `/docs`, `/404`. Overrides the tokens to a cream-editorial palette:
  - `--bg: #f8f5f0` (warm paper)
  - `--surface: #ffffff`
  - `--panel: rgba(26, 20, 16, 0.05)`
  - `--text: #1a1410` (charcoal ink)
  - `--muted: rgba(26, 20, 16, 0.62)`
  - `--primary: #c45f28` (terracotta, already in `orange-light` theme — reused intentionally)
  - `--primary-strong: #a34d1f`
  - `--accent: #d97b45` (amber, same as orange-warm)
  - `--grid-line: rgba(26, 20, 16, 0.06)` (barely-visible editorial grid on landing only)

User's chosen theme still applies once they log in and enter the product; marketing pages are register-invariant by design (they're the "cover of the magazine", not a personalisable surface).

Technical approach: add `<body class="register-marketing">` / `register-product` from the route wrapper. CSS:

```css
body.register-marketing {
  --bg: #f8f5f0;
  --text: #1a1410;
  /* ... overrides ... */
}
```

No new theme file. No changes to `theme-palettes.css`. User's stored preference is untouched.

### 4.2 Typography tokens

Add to `frontend/src/styles/typography.css` (new):

- `--font-display`: **Inter Tight** (weights 500/600/700) — marketing headlines and product H1.
- `--font-serif-italic`: **GT Sectra** *(or free alternative: **Source Serif 4 Italic**, or **Newsreader Italic**)* — used for 1-word accent in marketing headlines only. No serif body text anywhere.
- `--font-ui`: **Inter** (weights 400/500/600) — default UI font, same as current.
- `--font-mono`: existing monospace.

Delivery: self-host via `@font-face` with `woff2` files under `frontend/public/fonts/`. **No** dynamic external requests (no Google Fonts, no bunny.net). Reason: network failure on first load kills the brand feel. Total weight budget: ≤ 180KB for all weights combined (subset to Cyrillic + Latin + numerals + common punctuation).

Tokens:
- `--fs-display-xl: clamp(44px, 6vw, 96px)` — landing hero headline.
- `--fs-display-lg: clamp(32px, 4vw, 56px)` — section headlines.
- `--fs-title: 22px` — card titles.
- `--fs-body: 15px` — base.
- `--fs-meta: 13px` — metadata.
- `--fs-micro: 11px` — badges, counters.

Line-heights: tight (1.05) for display, 1.5 for body.

### 4.3 Component tokens

Reusable primitives that any new marketing/product surface uses. Collected in `frontend/src/styles/primitives.css`:

- `--r-card: 14px`, `--r-control: 10px`, `--r-pill: 999px`.
- `--shadow-soft: 0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.08)` — marketing.
- `--shadow-ring: 0 0 0 1px rgba(255,255,255,0.06)` — product dark surfaces.
- `--duration-fast: 120ms`, `--duration-med: 220ms`, `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`.

All new marketing/onboarding code uses these tokens. No inline `style={{ border: '1px solid rgba(...)' }}` — that's the main source of the current "robot-assembled" feel.

### 4.4 Motion

- `prefers-reduced-motion: reduce` — disables all non-essential transitions.
- Default transitions for mount: opacity 0→1 + translateY(2px→0), duration 220ms, ease-out.
- Skeletons: shimmer of 1800ms loop, only while actively waiting, never on idle surfaces.
- Streaming-feel on first generation response: see §7.3.

No `framer-motion`. No new deps. Pure CSS transitions + one small shared `useReveal()` hook (IntersectionObserver).

## 5. Landing (`/welcome`, redirects from `/`)

### 5.1 Structure

```
<header>       thin nav: logo-glyph + MetaPrompt wordmark | Product · Studio · Library · Pricing · Docs | [RU/EN] [Log in] [Start free →]
<hero>         two-entry hero (see 5.2)
<demo-strip>   live in-page demo (see 5.3)
<how>          3 horizontal scenes (5.4)
<for-who>      two columns: beginner / engineer (5.5)
<trust>        models catalogue + health status mini-widget (5.6)
<faq>          keys, limits, data, openrouter — moved from the current wall-of-text (5.7)
<footer>       minimal: github, docs, status, ru/en
```

### 5.2 Hero

Left column (60% width):
- Eyebrow `STUDIO · v0.9` in small-caps terracotta.
- Headline, display-xl, charcoal, tight tracking. The headline is **not** the product name — it's a value proposition. Example (copy goes through §12):
  > From rough intent to a prompt that actually *works*.
  where *works* is in `--font-serif-italic`, terracotta.
- Subtitle, 18px, `--muted`, 1 sentence, max 12 words.
- Two CTAs side-by-side:
  - Primary, terracotta solid: **"Показать на моей задаче →"** (scrolls to demo-strip, focuses textarea).
  - Secondary, ghost with amber underline: **"Открыть Studio →"** (takes to `/login` → `/home`).
- Footnote microcopy, 13px, muted: "Без ключей. Без регистрации. Без обещаний."

Right column (40%):
- A single product screenshot of Studio composer, rendered as a real React preview (static), with a subtle `transform: perspective(800px) rotateY(-2deg)`. Not a PNG — actual markup + CSS so it scales.
- Over it, a small floating tag: "Tier: Advanced" matching the active tier system.

No marketing-y "gradient blob background". One diagonal warm light leak top-right (radial gradient on `::after`), opacity 0.08.

### 5.3 Demo strip

Replaces the current inline demo box. Full-width strip, cream paper surface with `--grid-line` grid:

- One input: large textarea, 3 rows, placeholder rotates through 4 real example tasks (`setInterval` 4s, pause on focus).
- One button: "Сгенерировать промпт".
- Result area: appears below with a typed-in animation (see §7.3). Shows the prompt block with syntax highlighting for sections (Role / Context / Task / Constraints / Output).
- Under result: 3 actions — `Копировать`, `Открыть в Studio →`, `Сравнить вариант B` (deep-links to Compare pre-filled).
- Rate-limit footnote, 11px muted: "5 запросов / 5 мин · 20 / день".

No login gate. Uses `/api/demo/generate` (already exists).

### 5.4 How-it-works (3 scenes)

A horizontal scroll-snap strip (desktop) / vertical stack (mobile). Each scene is:

- Left: a short numbered heading (`01`, `02`, `03`), 1-sentence description.
- Right: a real product screenshot with one annotated hotspot (terracotta pin + 1-line caption).

Scenes:
1. `01 Compose` — Studio composer.
2. `02 Compare` — Compare v2 with the judge bar-chart (§9).
3. `03 Keep` — Library with a prompt drawer open (§8).

### 5.5 For-who

Two-column block:
- **Для новичка**: 3 bullets, each with a glyph-icon. Tone: "Не нужно знать, что такое Chain-of-Thought, чтобы получить хороший результат."
- **Для инженера**: 3 bullets. Tone: "Метрики, версии, judge, diff, OpenRouter-ключ — как ты ожидаешь."

### 5.6 Trust / models

Mini-widget that pulls from `/admin/model-health` (public subset, no auth — or cached snapshot endpoint if we don't want to expose health live). Shows 6 badges: `Auto / Fast / Mid / Advanced` × `Text / Vision`, each green/yellow/red with the underlying model name on hover. This is the **honest** replacement for "we use the best models" — we show they're actually alive today.

Backend note: expose `GET /api/public/model-health-snapshot` that returns a sanitised view of `model_health` — no internal model IDs if we consider them sensitive; just tier/mode → status.

### 5.7 FAQ

Six accordion rows, collapsed by default. This is where the current hero-paragraph text migrates to:
- "Зачем мне свой OpenRouter-ключ?"
- "Что такое пробный режим и какие лимиты?"
- "Что вы сохраняете?"
- "В чём разница между Auto / Fast / Mid / Advanced?"
- "Можно ли использовать без регистрации?"
- "Как вы считаете completeness-score?"

## 6. Onboarding (`/onboarding`)

Replaces `OnboardingPreferences.tsx`. Full-page scroll, 3 segments, progress bar sticky on top (`1/3 · 2/3 · 3/3`), Skip link top-right.

### 6.1 Step 1 — "Что ты делаешь с LLM"

6 large tile-cards (2×3 grid), each with a glyph icon, title, 1-line description:
- *Пишу тексты и контент*
- *Работаю с кодом*
- *Делаю агентов / пайплайны*
- *Анализирую и структурирую*
- *Творчество и идеи*
- *Другое*

Selection is single-choice (radio semantics, but tile-styled). On select:
- Right-side preview panel updates with a matched preset name and the 2-3 techniques that preset will enable by default ("Few-shot, Chain-of-thought").
- No step auto-advance — user clicks "Дальше".

Maps to: `preferences.user_goal` (new field, TEXT nullable) + default preset for simple improve.

### 6.2 Step 2 — "Как ты хочешь, чтобы модель думала"

3 tile-cards:
- *Быстро — мне нужен результат сейчас* → `tier=fast`, `classifier=heuristic`.
- *Сбалансированно* (default) → `tier=auto`, `classifier=llm`.
- *Аккуратно — пусть подумает* → `tier=advanced`, `classifier=llm`.

Each card has a hint line: "≈ что-то быстрое и дешёвое", "≈ универсально", "≈ больше рассуждений и шагов".

Under the hood, maps to the existing `preferences.task_classifier_mode` and `preferences.default_tier` (new field, TEXT).

### 6.3 Step 3 — "Первый промпт"

A textarea pre-filled with a scenario based on Step 1 selection. Example for "Пишу тексты": "Напиши промпт для описания товара в интернет-магазине так, чтобы он подходил под SEO и не звучал рекламно."

Below: big Generate button. Clicking it:
- Calls `/api/generate` with the user's chosen defaults from Steps 1-2.
- Result streams into the same page (§7.3 streaming-feel).
- Post-generation, one CTA: "Открыть в Studio →" (takes user to `/home` with the generated prompt loaded as the current session).

If user clicks Skip at any step — we record a default profile (`tier=auto`, `classifier=llm`, no goal) and go to `/home`.

### 6.4 Progressive disclosure principle

**Never show the word "heuristic" or "preset" in onboarding UI.** Internal field names are internal. Any term that requires the user to Google it is excluded from this surface.

## 7. Studio polish (`/home`)

We do not restructure. Changes are additive / replacements.

### 7.1 Skeletons

Replace spinners in: generation output panel, library list, compare columns, admin metrics. Shape of skeleton matches the shape of the expected result (not generic rectangles). Shimmer animation only.

### 7.2 Seed example

If `recentSessions.length === 0` and output is empty → composer shows below it a dimmed card: "Пример. Так будет выглядеть результат.", with a real static pre-generated prompt. Clicking "Загрузить этот пример" fills the composer with the seed task. Clears automatically after first generation.

### 7.3 Streaming feel

Even if backend returns full response at once: on render, type in the result character-by-character at ~8ms/char for the **first** 500ms worth of characters (~60 chars), then instantly append the rest. Reason: user perceives "alive", but we don't pay the price of actual token streaming.

Implementation: a small `useTypewriterReveal(text, { fastAfterMs: 500 })` hook in `frontend/src/lib/reveal.ts`. Respects `prefers-reduced-motion`.

### 7.4 Hotkeys

Global (Studio only):
- `⌘K` / `Ctrl+K` — open command palette (§10). Overrides textarea focus if palette isn't already open.
- `⌘Enter` / `Ctrl+Enter` — trigger Generate (works from inside textarea).
- `Esc` — if result panel is open, clear it; else blur focus.
- `⌘/` — focus composer textarea.

Discoverable via a small `?` button next to the avatar → shows a hotkeys cheatsheet modal.

### 7.5 Microcopy pass

Every user-facing string in Studio reviewed against §12 (tone of voice). Specific fixes:
- "Deepseek Chat рекоменд." — already removed in prior iteration; verify none remains.
- Error toasts: replace generic "Ошибка генерации" with context-aware messages from backend (already supported — just wiring).

### 7.6 Motion

- Composer footer tier dropdown open/close: 160ms transition (current is abrupt).
- Results panel appearance: opacity 0→1 + 4px slide-up, 220ms, once per session.
- No bounce, no spring.

## 8. Library-as-product (`/library`)

### 8.1 Left sidebar — smart groups

Replaces the current tag-only filter sidebar. Section structure:

- **Views** (synthetic, computed client-side or via new endpoint):
  - *Недавние* — last 7 days of `updated_at`.
  - *Лучшие по completeness* — top 10 by metric.
  - *Не трогал месяц* — `updated_at < now - 30d`.
  - *Без тегов* — prompts with empty `tags` array.
- **Теги** — existing, but collapsible section.
- **Модели** — new: group by `target_model`. Shows count per model.

Clicking a view filters the main grid. Multi-select by ⇧+click (already usable on tag chips; extend).

### 8.2 Grid → preview drawer

Current: click on card → inline expand. New: click → right-side drawer (40% width, slides from right), contains:
- Title, tags, metadata (target model, created/updated).
- Full prompt body with markdown rendering (reuse `MarkdownOutput`).
- Versions tab: list of historical versions with diff against current (reuse `SimpleLineDiff`).
- Translation toggle (already implemented — keep).
- Actions: "Открыть в Studio", "Сравнить как B", "Дублировать", "Удалить", "Скопировать как markdown".

Drawer closes on `Esc`, click-outside, or back button (sync with URL: `/library?open=<id>`).

### 8.3 Card preview

On card itself (grid view): first 3 lines of the prompt in monospace, dimmed; then tags row; then a micro-metric row (e.g. `82% · 412 tok · ru`). Hover: tiny slide-up 2px, shadow deepens.

### 8.4 Search

Top bar input, debounced 150ms. Searches title + body + tags. No backend change needed (client-side over the loaded list; if list > 300 items, we switch to server-side — that's bucket 2).

### 8.5 Empty state (first-time user)

Not an empty grid. Shows 3 "starter templates" with a single "Добавить в библиотеку" button on each. Content of starters is seeded client-side from `frontend/src/data/starter-prompts.ts` (new file). User's choice in onboarding Step 1 filters which 3 show up.

## 9. Compare v2 (`/compare`)

Biggest functional rewrite in this spec. Rebuilds `Compare.tsx` without removing anything currently useful.

### 9.1 Three modes (segmented tabs at the top)

- **Techniques** (current behaviour): one task, one target model, two different technique sets → two prompts.
- **Models** (new): one task, one technique set, two different tiers or explicit models → two prompts and (see 9.2) two on-target outputs.
- **Prompts** (new): user provides two prompts (A and B) directly (paste or pick from library), one target model → two on-target outputs only.

### 9.2 On-target execution (main change)

New UI section under each prompt column:
- Button: "Прогнать на target-модели" (or auto-runs on generation if option enabled).
- Result: the actual completion from the target model, streamed or typewriter-revealed.
- Two metrics chips on the output: latency, output tokens.

**Trial budgeting** (from §5 decision): on-target run is counted against user's trial budget (or their own key's credits). Per-session cap: 10 rounds/day for trial users, unlimited for own-key.

Backend: new endpoint `POST /api/compare/run-on-target` — accepts `{ prompt, target_model, temperature, top_p }`, returns `{ output, latency_ms, output_tokens }`. Shares the `llm_client` synchronous path already present.

### 9.3 Diff viewer

Toggle above results: `Текст | Diff`. Diff mode switches both columns into a synchronised side-by-side diff highlighting A vs B at the line level (reuse logic behind `SimpleLineDiff`, adapt for 2-column).

Diff applies to:
- Prompts (default toggle).
- On-target outputs (second toggle when outputs are present).

### 9.4 Judge — structured visualisation

Backend change: `/api/compare/judge` extended to return a structured payload:
```json
{
  "winner": "a" | "b" | "tie",
  "reasoning": "...markdown...",
  "criteria": [
    {"name": "clarity",       "a": 8, "b": 6, "comment": "..."},
    {"name": "completeness",  "a": 7, "b": 9, "comment": "..."},
    {"name": "safety",        "a": 9, "b": 9, "comment": "..."},
    {"name": "brevity",       "a": 6, "b": 8, "comment": "..."}
  ]
}
```

Frontend renders a horizontal bar chart: 4 rows, 2 bars each (A terracotta, B amber), max 10. Winner bar gets a checkmark glyph. Reasoning collapsed under a "Пояснение судьи" accordion.

If the judge LLM returns non-structured reasoning (old format), we fall back to the current raw rendering — compatibility kept for one release.

### 9.5 Winner → Studio / Library

Once judge runs, a terracotta button appears: "Забрать победителя" — opens a menu:
- "Открыть в Studio" (loads winner prompt as current session).
- "Сохранить в библиотеку" (opens save dialog with winner pre-filled).
- "Экспорт сравнения .md" (local download of the full A/B pair + outputs + judge verdict, all in markdown — client-side only, no backend).

### 9.6 Rounds history

`compareRecent.ts` analogous to `recentSessions.ts`, localStorage, MAX=20. Each round = `{ task, mode, variants, judgeResult, timestamp }`. Sidebar shows last 10 with 1-line preview, click to restore state.

### 9.7 Re-generate with edits

Each prompt column has an "Изменить" button → flips to inline editor → "Re-generate" only regenerates that side. Target-run results flagged stale when the prompt changes (small amber pill "промпт изменился, перезапустить").

## 10. Command palette (⌘K)

New component `frontend/src/components/CommandPalette.tsx`. Global, opens on `⌘K` / `Ctrl+K`. Closes on `Esc`.

### 10.1 Contents

- **Search**: by title over `library` items, fuzzy match (small custom matcher, no `fuse.js` dep). Top 8 results with highlighted match.
- **Commands** section (fixed, not searched when query is empty):
  - Новый промпт — `⌘N`
  - Последнее сравнение — `⌘⇧C`
  - Переключить тему — `⌘T` (cycles through available themes) — **скрыт в marketing register**, так как user-theme там не применяется (§4.1).
  - Язык: RU / EN — `⌘L` (доступен в обоих регистрах).
  - Помощь / хоткеи — `?`
  - Выйти — `⌘Q`

### 10.2 Implementation constraints

- No external library. Internal `useHotkey(combo, handler)` hook in `frontend/src/lib/hotkeys.ts`.
- Focus trap + portal (reuse `PortalDropdown` primitive).
- Accessible: `role="dialog"`, `aria-modal="true"`, list uses `role="listbox"` with `aria-activedescendant`.

## 11. i18n — RU + EN without a library

### 11.1 Approach

- Two dictionary files: `frontend/src/i18n/ru.ts` and `en.ts`. Shape: flat key→string map with dotted namespaces (`landing.hero.title`, `onboarding.step1.heading`, etc.).
- One hook: `useT()` returns a `t(key, vars?)` function. Vars via `{name}` placeholders.
- Language state in a `LanguageContext`, persisted in localStorage, default from `navigator.language` (`ru` if starts with `ru`, else `en`).
- Switcher in the shell header (marketing register) and in ⌘K (product register).

### 11.2 Scope for this iteration

Translate:
- Landing (all sections)
- Onboarding (all 3 steps)
- Login / signup page
- 404 / error pages
- ⌘K command labels
- Toast messages

**Out of scope for i18n now** (stays RU-only):
- Studio inner labels
- Library inner labels
- Admin
- Compare labels

Reason: time. The prompt *content* translation is already covered by `services.translator`. i18n for the whole app is a separate 2-week effort that we don't need to block this spec on.

### 11.3 File structure

```
frontend/src/i18n/
  index.ts          # useT, LanguageContext
  ru.ts             # { 'landing.hero.title': '...', ... }
  en.ts
  keys.ts           # generated type-safe union of valid keys (optional, nice-to-have)
```

## 12. Tone of voice

Rules for all new microcopy. Applied retroactively to anything we touch in this spec.

- **Short**. If a sentence is > 12 words on the landing, it's too long.
- **Specific**. "Помогает писать промпты" → "От общей задачи к готовому промпту, который можно копировать."
- **Confident but not hype**. Never: "лучший", "революционный", "всё в одном месте".
- **Quiet humour allowed once per screen**. Example: "Промпт-инженерия — это не магия. Но иногда выглядит так."
- **Never apologetic**. "К сожалению, что-то пошло не так" → "Не получилось. Попробуй ещё раз или напиши нам."
- **Russian typography**: ё where correct, «ёлочки» for quotes, тире не дефис, неразрывные пробелы перед единицами ("5 запросов", "60 сек").

Copy review is a step before merge for all pages touched by this spec.

## 13. Bucket 2 (parked, not in this iteration)

Documented here so they're not re-discovered from scratch later:

- **B1 — Public shareable link for a Compare round**: URL with signed token, shows A/B + judge verdict read-only. Covers pain 10.
- **B2 — Import from ChatGPT/Claude conversation**: paste exported text → extract system prompt and last task → seed a new prompt draft. Covers beginner-to-advanced bridge.
- **B3 — Batch evaluation**: one prompt × N inputs → pass-rate + failure examples. Covers pain 12.
- **B4 — Reproducibility snapshot on each saved prompt**: pin the tier→model resolution at save time to `prompt_model_snapshot`. Covers pain 9.
- **B5 — Smart empty-states everywhere**: beyond library starter templates. For admin, compare, sessions.
- **B6 — Cross-flows wizards**: "мой промпт не работает" → guided fix loop.
- **B7 — Full-app i18n** (Studio + Library + Admin + Compare).

## 14. Success criteria

This iteration is done when:

1. A stranger landing on `/` understands within 10 seconds what the product does, without scrolling.
2. A stranger can generate their first prompt without logging in, via the landing demo strip.
3. New user going through onboarding finishes in ≤ 90 seconds and exits with a real prompt loaded in Studio.
4. Compare v2 shows two on-target outputs for a prompt side-by-side with a structured judge verdict.
5. ⌘K opens from anywhere, finds library items, runs basic commands.
6. `/` and `/onboarding` contain zero inline `style={{}}` — all styling through design-system tokens.
7. All landing/onboarding strings exist in both `ru.ts` and `en.ts`, and switcher works.
8. Lighthouse score for landing: ≥ 92 performance, ≥ 95 accessibility on desktop.
9. Visual QA pass: all 6+ themes render correctly in product register; marketing register looks identical regardless of user's stored theme.

## 15. Backend extensions required

Kept deliberately minimal.

- `POST /api/compare/run-on-target` — new endpoint, synchronous, returns `{ output, latency_ms, output_tokens }`. Trial-budget aware.
- `/api/compare/judge` — extended response with `criteria[]` per §9.4. Backwards compatible (old clients still read `reasoning` + `winner`).
- `GET /api/public/model-health-snapshot` — new, unauthenticated, cached 5 min. Returns tier/mode → `ok|degraded|down`.
- `DB`: add `preferences.user_goal TEXT` and `preferences.default_tier TEXT`. New migration `_migrate_phase18_onboarding_profile`.

No other backend changes in this spec.

## 16. Risks & mitigations

- **Risk**: RU+EN i18n blows up scope. **Mitigation**: limit to landing/onboarding/auth/404 now (§11.2); full-app i18n is bucket 2.
- **Risk**: On-target Compare burns trial budget fast. **Mitigation**: per-day cap, clear UI counter, admin override per user.
- **Risk**: Fonts self-host adds 180KB. **Mitigation**: subset aggressively; `font-display: swap`; preload only display weight for above-the-fold.
- **Risk**: Command palette conflicts with textarea shortcuts. **Mitigation**: ⌘K propagates past textareas; ⌘Enter/⌘/ scoped to Studio only.
- **Risk**: Two-register CSS leaks (user lands on `/login`, gets marketing register, then navigates to `/home` and we forget to switch). **Mitigation**: register-class applied at `AppRouter` level, not at page level; snapshot tests covering register switch on all top-level routes.

## 17. Resolved decisions (previously "open questions")

Owner said "решай сам". Decisions locked in:

- **Q1 — Landing hero headline**. Pattern: `<Sans> <serif-italic-word> <Sans>`. RU: **«От общей задачи — к промпту, который *работает*.»** (serif-italic on *работает*). EN: **"From rough intent to a prompt that *works*."**. Eyebrow above: `STUDIO · v0.9` в small-caps terracotta. Subtitle RU: «Пишешь задачу одной строчкой — получаешь структурированный промпт, который можно копировать в любую LLM.»
- **Q2 — Compare on-target daily cap**.
  - Trial user (host key): **10 rounds/day** (an on-target pair = 2 calls counts as 1 round). Per-session hard cap 3.
  - Own-key user: unlimited at our level, bounded by their OpenRouter credit.
  - Admin can override per user via existing `user_usage_limits` (`compare_rounds_per_day` — new integer field).
- **Q3 — `/api/public/model-health-snapshot`**. Returns **tier/mode statuses only** (`auto_text: ok`, `advanced_vision: degraded`), without OpenRouter slugs. Admins see slugs through the existing `/api/admin/model-health`. Cached 5 min, in-process.
- **Q4 — ⌘T theme cycle**. Include **all themes** currently registered in `ThemeContext` (all 6+). Order = registration order in `theme-palettes.css`. In marketing register the command is hidden (see §10.1 patch).
- **Q5 — Onboarding Step 3 abuse**. Onboarding runs **after** login (today's routing keeps it under `RequireAuth` — see `App.tsx:54`), so the "email-verified before Step 3" check is effectively already there (account creation = signup). Additionally apply the existing `check_user_rate_limit` path with the same 10 req/5 min budget as `/api/generate`. No extra gate.

---

## 18. What this spec deliberately does not cover

- Pricing page copy & tiers.
- Billing, payments, subscription model.
- Teams / multi-user workspaces.
- Mobile app, native clients.
- Self-hosted deployment story changes.

Those are separate decisions and will get their own specs when their time comes.
