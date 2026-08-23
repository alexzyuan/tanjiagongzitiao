# Codex-First Phase A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish a small, durable documentation system that gives Codex the current architecture, business rules, change map, and handoff state without requiring historical task logs as default context.

**Architecture:** Documentation-only change. `AGENTS.md` becomes the permanent execution contract; `docs/ARCHITECTURE.md`, `docs/BUSINESS_RULES.md`, and `docs/AI_INDEX.md` become current-truth references; `HANDOFF.md` becomes a concise current-state record; `docs/history/` is explicitly historical.

**Tech Stack:** Markdown, existing GitHub repository structure.

**Spec:** `docs/superpowers/specs/2026-08-23-codex-first-maintainability-design.md`

## Global Constraints

- Do not change application behavior, database schema, CSS, runtime dependencies, CI, deployment automation, or production configuration.
- Do not merge or deploy.
- Preserve existing security invariants and DingTalk boundaries.
- Do not delete `CODEX_TASKS.md` in Phase A; reclassify it as legacy/non-default context only.
- Keep documentation concise enough to be useful as agent context.

---

### Task 1: Add current architecture documentation

**Files:**
- Create: `docs/ARCHITECTURE.md`

**Interfaces:**
- Consumes: current repository layout and `AGENTS.md` architecture rules.
- Produces: current runtime diagram, module ownership, data paths, invariants, and dependency direction.

- [ ] **Step 1:** Document runtime topology and package/app ownership.
- [ ] **Step 2:** Document salary write/read/import/archive paths.
- [ ] **Step 3:** Document hard security/runtime invariants.
- [ ] **Step 4:** Verify all referenced paths exist in current `main`.

### Task 2: Add business rules documentation

**Files:**
- Create: `docs/BUSINESS_RULES.md`

**Interfaces:**
- Consumes: `packages/domain/src/salary.ts`, current salary services/tests, and current `AGENTS.md` rules.
- Produces: concise lifecycle/action semantics for salary batches, items, delivery, evidence, view/confirm, archive, and delete/edit/resend behavior.

- [ ] **Step 1:** Document batch lifecycle and meaning of states.
- [ ] **Step 2:** Document delete/edit/withdraw/resend semantics.
- [ ] **Step 3:** Document employee read/view/confirm semantics and archive boundary.
- [ ] **Step 4:** State that code/tests are executable truth and this file explains intent.

### Task 3: Add Codex change map

**Files:**
- Create: `docs/AI_INDEX.md`

**Interfaces:**
- Consumes: current file layout.
- Produces: common-task → read-first-file mapping.

- [ ] **Step 1:** Map salary lifecycle, delivery, import, employee page, permissions, evidence/reporting, DB/encryption, DingTalk, CSS, deployment, architecture checks.
- [ ] **Step 2:** Keep entries concise and avoid duplicating implementation details.

### Task 4: Update permanent agent rules

**Files:**
- Modify: `AGENTS.md`

**Interfaces:**
- Consumes: existing hard security/stack/git constraints and the approved Codex-First principles.
- Produces: permanent agent execution contract with default reading order and Codex-First rules.

- [ ] **Step 1:** Preserve all current hard security and DingTalk constraints.
- [ ] **Step 2:** Add Codex-First principles.
- [ ] **Step 3:** Change default context guidance from mandatory `CODEX_TASKS.md` reading to current-truth docs first.
- [ ] **Step 4:** Mark historical task logs as optional unless the task requires historical reasoning.

### Task 5: Rewrite current handoff and define history boundary

**Files:**
- Modify: `HANDOFF.md`
- Create: `docs/history/README.md`

**Interfaces:**
- Consumes: current `main` state and existing handoff facts.
- Produces: concise current-state handoff plus an explicit location/contract for history.

- [ ] **Step 1:** Replace stale historical narrative in `HANDOFF.md` with current purpose, current main baseline, runtime/production boundaries, known warnings, and next-work guidance.
- [ ] **Step 2:** Remove stale baseline SHAs and obsolete “default next task” instructions.
- [ ] **Step 3:** Add `docs/history/README.md` explaining what belongs in history and that it is not default agent context.
- [ ] **Step 4:** Keep `CODEX_TASKS.md` untouched but explicitly classify it as legacy/historical task material.

### Task 6: Documentation verification

**Files:**
- Review all Phase A files.

**Interfaces:**
- Consumes: all outputs above.
- Produces: verified documentation-only diff.

- [ ] **Step 1:** Compare branch against `main` and confirm only Markdown files changed.
- [ ] **Step 2:** Check all referenced repository paths exist.
- [ ] **Step 3:** Check current main SHA references are consistent.
- [ ] **Step 4:** Confirm no secrets, production credentials, local paths, SQLite files, or `.superpowers/` content were added.
- [ ] **Step 5:** Report branch, commit(s), changed files, and verification results; do not merge or deploy.
