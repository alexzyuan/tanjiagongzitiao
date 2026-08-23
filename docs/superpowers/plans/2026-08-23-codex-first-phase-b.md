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

- [x] Add tests covering untouched draft, initial failures, all delivered items withdrawn, mixed delivered/current-delivered, archived, and withdrawn-only edit semantics.
- [x] Verify the policy harness fails because the policy functions do not exist.
- [x] Implement the minimal pure policy functions.
- [x] Verify the pure domain policy with TypeScript syntax/type checking and a local red/green policy harness.

### Task 2: Use the domain policy as the server rule source

**Files:**
- Modify: `apps/api/src/modules/salary/service.ts`
- Existing coverage: `apps/api/test/salary-management-actions.test.ts`

**Consumes:** `canDeleteSalaryBatch`, `canEditSalaryItem` from `@salary/domain`.

- [x] Review existing API regression assertions for `canDelete`, delete states, withdrawn/resend states, archived editing, and in-flight guards; do not duplicate already sufficient coverage.
- [x] Replace duplicated pure delete/edit predicates in `SalaryService` with domain policy calls while keeping in-flight checks in the service.
- [x] Keep `deliverySummary(...).canDelete` as the complete server capability, including in-flight state.
- [ ] Verify the full API salary action test suite in an environment with repository dependencies available.

### Task 3: Make the Web consume server truth and item delivery truth

**Files:**
- Modify: `apps/web/src/pages/SalaryManagement.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [x] Add a Web regression test where a `partially_failed` batch contains one failed and one non-failed item; selecting the failure filter must show only the failed item.
- [x] Add a Web regression test proving server `canDelete` overrides locally inferable batch state.
- [x] Update fixtures to provide the authoritative `canDelete` capability.
- [x] Change failure filtering to `item.deliveryStatus === "failed"`.
- [x] Rename the batch alert wording from import anomaly to send anomaly where it represents delivery failure.
- [x] Remove the legacy client-side `canDelete` fallback and use server capability only.
- [ ] Verify the full Web test suite in an environment with repository dependencies available.

### Task 4: Reuse safe domain types in the Web only if it stays compile-time only

**Decision:** intentionally skipped in Phase B.

Adding a Web workspace dependency / lockfile change solely for a few duplicated compile-time types would expand the change without materially improving the single-source behavior goal. Revisit together with the later Web API-file cleanup rather than adding dependency churn here.

- [x] Do not create a new contracts package.
- [x] Keep Phase B dependency-neutral.

### Task 5: Verification and scope review

- [ ] Run `pnpm architecture:check` in a full repository environment.
- [ ] Run `pnpm test` in a full repository environment.
- [ ] Run `pnpm typecheck` in a full repository environment.
- [ ] Run `pnpm build` in a full repository environment.
- [ ] Run `git diff --check` in a full repository environment.
- [x] Confirm no DB schema, CSS, deployment, runtime dependency, `.superpowers/`, zip, or SQLite data changes in the GitHub diff.
- [x] Compare branch against `codex/codex-first-phase-a` and `main`.

## Current verification limitation

The GitHub Quality workflow currently triggers on pull requests and pushes to `main`. This branch has not been turned into a PR and therefore has no Quality run yet. Do not mark the five full-repository verification commands above complete until they actually run successfully.
