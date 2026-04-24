---
name: superpowers
description: >-
  Use for multi-step product work, large refactors, and UX/API changes in this
  repo. Load before acting when plans/specs in docs/superpowers apply, or when
  the user references superpowers, plans, or agentic execution workflows.
---

# Superpowers (this repository)

## When this skill applies

- The user mentions **superpowers**, **plans/specs**, **subagent-driven** execution, or **checkbox plans** in `docs/superpowers/`.
- The task is a **non-trivial** change across frontend (`frontend/`), backend (`backend/`), DB (`db/`), or product UX — especially anything covered by an existing plan or spec under `docs/superpowers/`.
- You are about to **implement** something that already has a written plan with `- [ ]` steps — follow that plan and tick work off deliberately.

## Instruction priority

1. **User’s explicit instructions** (chat, `README.md`, workspace rules) — highest.
2. **This skill + matching docs in `docs/superpowers/`** — override ad-hoc habits where they conflict.
3. **Default assumptions** — lowest.

## Where the “superpowers” knowledge lives

| Area | Path |
|------|------|
| Product / UX specs | `docs/superpowers/specs/` |
| Execution plans (checkbox steps, agent notes) | `docs/superpowers/plans/` |
| Discovery / inventory | `docs/superpowers/audit/` |

Before coding a large slice: **read** the relevant spec and/or plan in that tree (use the Read tool on those files). If the user points at a specific plan file, treat it as the source of truth for scope and order.

## Cursor-specific behaviour

- **Skills in this repo**: When this skill applies, also check **other** project skills under `.cursor/skills/` and workspace rules under `.cursor/rules/` for overlapping guidance.
- **Globally installed Superpowers plugin** (if present on the machine): process-oriented skills there (e.g. brainstorming, systematic debugging, TDD, executing plans) **stack** with this file — use them when their descriptions match the task; this skill ties them to **this codebase** and **`docs/superpowers/`**.

## Red flags (same discipline as upstream “using superpowers”)

If you catch yourself thinking “I’ll just skim the repo first” or “this is too small for a plan” while the user actually asked for a planned feature or a plan file exists — **stop**, open the matching `docs/superpowers/` doc, then proceed.

## Skill order (when several apply)

1. **Process** first (debugging, planning, brainstorming) — defines *how* to work.
2. **Implementation** second — UI patterns, API shapes, tests.

Example: “Fix failing tests after refactor” → debugging / verification discipline first, then localized code changes.

## Product context (one line)

**Prompt Optimizer / MetaPrompt**: FastAPI + React SPA; main studio is `frontend` routes like `/home`; plans under `docs/superpowers/` often reference Library, onboarding, Compare, and admin — align changes with those docs when they exist.

## Использование в Cursor (как `/brainstorming`)

Плагин Superpowers регистрирует slash-команды **только для своих скиллов** в кэше плагина. Проектный файл `.cursor/skills/.../SKILL.md` **сам по себе** не даёт `/superpowers`.

В этом репозитории добавлена **Cursor slash-команда**: в поле чата агента введи **`/`** и выбери **`superpowers`** (источник — `.cursor/commands/superpowers.md`). Она подключает этот скилл так же явно, как ты раньше вызывал brainstorming.
