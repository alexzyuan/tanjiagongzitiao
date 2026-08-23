# Codex-First Phase C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve responsibility locality so ordinary salary-feature work normally requires reading only 3–6 main files, without fragmenting the codebase or changing business behavior.

**Architecture:** Keep the existing React/Fastify/SQLite architecture. Split only along existing responsibilities: salary overview vs employee batch detail, import wizard orchestration vs wizard steps, API transport vs type groups, in-memory store implementation vs public store contracts, and SQLite schema/migrations vs SQLite runtime store behavior. Replace hidden global UI events with explicit props.

**Tech Stack:** TypeScript, React, Vitest, Fastify, SQLite, pnpm workspace.

**Spec:** `docs/superpowers/specs/2026-08-23-codex-first-maintainability-design.md` plus the approved Phase C scope from the Codex-first optimization plan.

## Global Constraints

- No new runtime dependencies.
- No ORM, Redis, MQ, DI framework, Repository/UseCase layers, or microservices.
- No Redux, React Query, React Router, UI framework, Tailwind, or CSS-in-JS.
- Do not change PostgreSQL/SQLite architecture, encryption, schema semantics, or SQL behavior merely to split files.
- Do not change salary lifecycle, permissions, DingTalk behavior, import semantics, employee visibility, or archive semantics.
- Do not split files solely to silence size warnings; every new file must own a real responsibility.
- Preserve existing public imports unless a small explicit compatibility re-export is needed.
- No deployment changes.

---

### Task 1: Replace hidden admin-navigation CustomEvent usage

**Files:**
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/pages/SalaryManagement.tsx`
- Test: `apps/web/src/App.test.tsx`

**Produces:** `SalaryManagement` receives an explicit `onOpenPermissions: () => void` prop.

- [ ] Add/adjust a test that clicks the salary-page administrator control and observes the permissions module.
- [ ] Remove `window.dispatchEvent(new CustomEvent("salary-open-permissions"))` from salary management.
- [ ] Remove the matching global event listener from `AdminApp` and pass `onOpenPermissions={() => setModule("permissions")}` explicitly.
- [ ] Remove the unused `salary-open-settings` listener if no current producer exists.
- [ ] Run Web tests and typecheck.

### Task 2: Split SalaryManagement by real UI responsibility

**Files:**
- Modify: `apps/web/src/pages/SalaryManagement.tsx`
- Create: `apps/web/src/features/salary/SalaryBatchOverview.tsx`
- Create: `apps/web/src/features/salary/SalaryEmployeeTable.tsx`
- Create only if it owns editing UI/state cleanly: `apps/web/src/features/salary/SalaryItemEditor.tsx`
- Test: salary-management tests split in Task 4

**Interfaces:**
- Overview consumes batch summaries and callbacks; it does not call lifecycle APIs itself.
- Employee table consumes a loaded batch/detail and explicit send/withdraw/edit callbacks.
- `SalaryManagement` remains the orchestration/data-loading entry point.

- [ ] Move monthly card rendering/month controls into `SalaryBatchOverview` without moving API orchestration.
- [ ] Move employee filtering/table rendering into `SalaryEmployeeTable`; failed filtering must remain `item.deliveryStatus === "failed"`.
- [ ] Keep `canDelete` server-authoritative; do not reintroduce fallback rules.
- [ ] Keep modal/editor state in the smallest coherent owner.
- [ ] Run salary-management tests and Web typecheck.

### Task 3: Split ImportWizard by wizard-step responsibility

**Files:**
- Modify: `apps/web/src/features/salary/ImportWizard.tsx`
- Create: `apps/web/src/features/salary/import/ImportUploadStep.tsx`
- Create: `apps/web/src/features/salary/import/ImportMatchStep.tsx`
- Create: `apps/web/src/features/salary/import/ImportConfirmStep.tsx`
- Create only if shared types/helpers are substantial: `apps/web/src/features/salary/import/model.ts`

**Interfaces:**
- `ImportWizard` owns step state, API orchestration, preview id, resolutions, and completion.
- Step components receive typed data/callback props and do not invent additional data stores.

- [ ] Extract upload/parse UI.
- [ ] Extract directory matching/resolution UI.
- [ ] Extract final display-settings/commit UI.
- [ ] Preserve three-step import behavior and all validation/error states.
- [ ] Run import-related Web tests and typecheck.

### Task 4: Split oversized Web tests by behavior area

**Files:**
- Modify: `apps/web/src/App.test.tsx`
- Create: `apps/web/src/salary-management.test.tsx`
- Create: `apps/web/src/admin-modules.test.tsx`
- Create: `apps/web/src/employee-salary.test.tsx`
- Create shared test helpers only if reused by 2+ files: `apps/web/src/test-fixtures.ts`

- [ ] Move salary-management behavior tests out of `App.test.tsx`.
- [ ] Move admin module smoke tests into `admin-modules.test.tsx`.
- [ ] Move employee salary semantics into `employee-salary.test.tsx`.
- [ ] Keep tests behavior-named; do not weaken assertions during relocation.
- [ ] Run the complete Web test suite.

### Task 5: Split Web API transport from stable API types

**Files:**
- Modify: `apps/web/src/api.ts`
- Create: `apps/web/src/api-types.ts`
- Create only if endpoint helpers are genuinely grouped: `apps/web/src/salary-api.ts`

- [ ] Keep `api()` and session transport logic in `api.ts`.
- [ ] Move stable response/request type declarations to `api-types.ts` and re-export from `api.ts` for compatibility where useful.
- [ ] Do not add a client framework, caching layer, generated SDK, or contracts package.
- [ ] Run Web tests/typecheck/build.

### Task 6: Physically split DB contracts, MemorySalaryStore, and SQLite schema

**Files:**
- Modify: `packages/db/src/store.ts`
- Create: `packages/db/src/memory-store.ts`
- Modify: `packages/db/src/sqlite-store.ts`
- Create: `packages/db/src/sqlite-schema.ts`
- Modify if needed: `packages/db/src/index.ts`
- Tests: existing DB/API test suites

**Interfaces:**
- `store.ts` owns public DB types and the `SalaryStore` interface.
- `memory-store.ts` owns `MemorySalaryStore` only.
- `sqlite-schema.ts` owns schema SQL/migration application helpers only.
- `sqlite-store.ts` owns runtime SQLite CRUD/store behavior and calls schema helpers.

- [ ] Move `MemorySalaryStore` implementation out of `store.ts` without changing public behavior.
- [ ] Preserve existing exports via `index.ts` / explicit re-export as needed.
- [ ] Move SQLite schema/migration setup out of `sqlite-store.ts`; do not alter SQL text or migration order.
- [ ] Run DB tests, API tests, typecheck, and build.

### Task 7: Final locality and verification review

- [ ] Confirm ordinary salary management changes now have an obvious 3–6 file reading path documented in `docs/AI_INDEX.md`.
- [ ] Update `HANDOFF.md` with Phase C current state.
- [ ] Run `pnpm architecture:check`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm build`.
- [ ] Run `git diff --check` where a full repository checkout is available.
- [ ] Confirm no business-rule, DB schema semantic, CSS, deployment, or runtime dependency changes.
- [ ] Open a PR against the then-current `main`; do not merge until Quality is green.
