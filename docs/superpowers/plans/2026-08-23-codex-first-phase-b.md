# Codex-First Phase B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make salary lifecycle rules single-source and remove two known UI semantic drifts without adding architecture or runtime dependencies.

**Architecture:** Keep pure lifecycle/action rules in `@salary/domain`; keep runtime/in-flight checks in `SalaryService`; make API summary capabilities authoritative for the Web UI. The Web UI consumes `canDelete` and per-item `deliveryStatus` rather than reconstructing server rules.

**Tech Stack:** TypeScript, Vitest, Fastify, React, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-23-codex-first-maintainability-design.md`

## Global Constraints

- No new runtime dependencies.
- No database/schema changes.
- No deployment changes.
- No unrelated refactor or file-size cleanup.
- Preserve SQLite, encryption, authorization, DingTalk delivery, and archive behavior.
- Use TDD for behavior changes.

---

### Task 1: Add pure salary action policies

**Files:**
- Modify: `packages/domain/src/salary.ts`
- Modify: `packages/domain/test/salary.test.ts`

**Produces:**
- `canDeleteSalaryBatch(input)` for persistence-independent delete eligibility.
- `canEditSalaryItem(input)` for persistence-independent edit eligibility.

- [ ] Add tests covering untouched draft, initial failures, all delivered items withdrawn, mixed delivered/current-delivered, archived, and withdrawn-only edit semantics.
- [ ] Verify tests fail because the policy functions do not exist.
- [ ] Implement the minimal pure policy functions.
- [ ] Verify domain tests pass.

### Task 2: Use the domain policy as the server rule source

**Files:**
- Modify: `apps/api/src/modules/salary/service.ts`
- Modify: `apps/api/test/salary-management-actions.test.ts`

**Consumes:** `canDeleteSalaryBatch`, `canEditSalaryItem` from `@salary/domain`.

- [ ] Add/adjust API regression assertions proving `canDelete` is returned by batch summaries for deletable and non-deletable states and that delete/edit still reject in-flight/archived invalid operations.
- [ ] Verify the new capability assertions fail against any missing authoritative behavior.
- [ ] Replace duplicated pure delete/edit predicates in `SalaryService` with domain policy calls while keeping in-flight checks in the service.
- [ ] Keep `deliverySummary(...).canDelete` as the complete server capability, including in-flight state.
- [ ] Verify API salary action tests pass.

### Task 3: Make the Web consume server truth and item delivery truth

**Files:**
- Modify: `apps/web/src/pages/SalaryManagement.tsx`
- Modify: `apps/web/src/App.test.tsx`
- Modify if necessary: `apps/web/src/api.ts`

- [ ] Add a Web regression test where a `partially_failed` batch contains one failed and one non-failed item; selecting the failure filter must show only the failed item.
- [ ] Add a Web regression test proving a draft with `canDelete: false` stays non-deletable and `canDelete: true` is enabled, regardless of locally inferred state.
- [ ] Update fixtures to provide the authoritative `canDelete` capability.
- [ ] Change failure filtering to `item.deliveryStatus === "failed"`.
- [ ] Rename the batch alert wording from import anomaly to send anomaly where it represents delivery failure.
- [ ] Remove the legacy client-side `canDelete` fallback and use `batch.canDelete` only.
- [ ] Verify Web tests pass.

### Task 4: Reuse safe domain types in the Web only if it stays compile-time only

**Files:**
- Modify only if necessary: `apps/web/src/api.ts`
- Modify only if necessary: `apps/web/package.json`
- Modify only if necessary: `pnpm-lock.yaml`

- [ ] Reuse domain types only where they remove exact duplicate stable types and remain `import type` only.
- [ ] Do not create a new contracts package.
- [ ] Skip this task if it would enlarge Phase B beyond a small compile-time cleanup.

### Task 5: Verification and scope review

- [ ] Run `pnpm architecture:check`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check`.
- [ ] Confirm no DB schema, CSS, deployment, dependency-infrastructure, `.superpowers/`, zip, or SQLite data changes.
- [ ] Compare branch against `codex/codex-first-phase-a` and `main` and report Phase B-only vs cumulative changes.
