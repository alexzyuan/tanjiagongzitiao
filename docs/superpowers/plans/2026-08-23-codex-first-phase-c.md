# Codex-First Phase C Implementation Plan

> Status: implementation complete; final PR-head Quality confirmation required before merge.

**Goal:** Improve responsibility locality so ordinary salary-feature work normally requires reading only 3–6 main files, without fragmenting the codebase or changing business behavior.

**Architecture:** Keep the existing React/Fastify/SQLite architecture. Split only along existing responsibilities: salary overview vs employee detail presentation, import orchestration vs steps, API transport vs type declarations, in-memory store implementation vs public contracts, and SQLite schema/migrations vs runtime CRUD. Hidden global UI navigation is replaced with explicit props.

**Spec:** `docs/superpowers/specs/2026-08-23-codex-first-maintainability-design.md`

## Global constraints

- No new runtime dependencies.
- No ORM, Redis, MQ, DI/Repository/UseCase layers, microservices, Redux, React Query, React Router, UI framework, Tailwind, or CSS-in-JS.
- No salary lifecycle, permission, DingTalk, import, employee-visibility, archive, encryption, SQL, schema-semantic, CSS, or deployment behavior changes.
- File splitting must correspond to real responsibility boundaries, not warning suppression.

---

## Task 1 — Explicit admin navigation

- [x] Add a behavior test for opening permissions from salary management.
- [x] Remove `salary-open-permissions` CustomEvent dispatch/listener.
- [x] Remove unused `salary-open-settings` listener.
- [x] Pass `onOpenPermissions={() => setModule("permissions")}` explicitly from `App`.
- [x] Verify with GitHub Quality; final green implementation was included in run #38 and later regression runs.

Current test location after Task 4: `apps/web/src/admin-modules.test.tsx`.

---

## Task 2 — Split SalaryManagement by UI responsibility

- [x] Keep `SalaryManagement.tsx` as page/data/API/dialog orchestration.
- [x] Move month controls and batch summary cards to `SalaryBatchOverview.tsx`.
- [x] Move employee filtering/table/action presentation to `SalaryEmployeeTable.tsx`.
- [x] Keep failed filtering based on item `deliveryStatus`.
- [x] Keep server `canDelete` authoritative.
- [x] Do not move lifecycle API orchestration into child components.
- [x] Verify with GitHub Quality; run #41 passed architecture/test/typecheck/build.

No extra `SalaryItemEditor` file was created because edit dialog state remained a coherent responsibility in the page orchestrator.

---

## Task 3 — Split ImportWizard by wizard-step responsibility

- [x] Create `import/ImportUploadStep.tsx`.
- [x] Create `import/ImportMatchStep.tsx`.
- [x] Create `import/ImportConfirmStep.tsx`.
- [x] Keep step state, preview id, resolutions, API search/preview/commit and completion in `ImportWizard.tsx`.
- [x] Preserve validation/error behavior.
- [x] Verify with GitHub Quality; run #48 passed architecture/test/typecheck/build.

No extra model/store layer was added.

---

## Task 4 — Split oversized Web tests by behavior area

- [x] Move salary-management tests to `apps/web/src/salary-management.test.tsx`.
- [x] Move admin/navigation tests to `apps/web/src/admin-modules.test.tsx`.
- [x] Move app-level employee salary semantics to `apps/web/src/employee-salary.test.tsx`.
- [x] Remove obsolete oversized `App.test.tsx` after behavior-preserving relocation.
- [x] Keep existing assertions/behavior names.
- [x] Verify complete Web suite; run #52 passed architecture/test/typecheck/build.

---

## Task 5 — Split Web API transport from stable types

- [x] Keep HTTP/session/DingTalk boot transport in `apps/web/src/api.ts`.
- [x] Move stable DTO/type declarations to `apps/web/src/api-types.ts`.
- [x] Re-export types from `api.ts` for compatibility.
- [x] Add no client framework/cache/generated SDK/contracts package.
- [x] Verify with GitHub Quality; run #54 passed architecture/test/typecheck/build.

---

## Task 6 — Split DB contracts, MemorySalaryStore, and SQLite schema

- [x] Keep public DB types and `SalaryStore` interface in `packages/db/src/store.ts`.
- [x] Move `MemorySalaryStore` implementation to `packages/db/src/memory-store.ts`.
- [x] Preserve package export through `index.ts`.
- [x] Preserve the historical direct `store.ts` module import with an explicit compatibility re-export after CI exposed that contract.
- [x] Move schema creation, compatibility ALTER, and withdrawn-interaction startup normalization to `packages/db/src/sqlite-schema.ts`.
- [x] Keep runtime CRUD/mapping/transactions in `packages/db/src/sqlite-store.ts` and call `applySqliteSchema(this.db)` from construction.
- [x] Preserve SQL text, migration order, encryption, store interface and SQLite/WAL behavior.
- [x] Verify with GitHub Quality; after the compatibility re-export fix, run #60 passed architecture/test/typecheck/build.

The initial Task 6 CI failure was `MemorySalaryStore is not a constructor` because `packages/db/test/sqlite-store.test.ts` intentionally imported it from `../src/store.js`. SQLite-specific tests, including reopen/migration normalization, were already passing. The fix restored that public module path without moving implementation back.

---

## Task 7 — Locality and final verification

- [x] Rewrite `docs/AI_INDEX.md` as a current 3–6-file change map for salary UI/import/app navigation/DB work.
- [x] Update `HANDOFF.md` with Phase C ownership and verification state.
- [x] Confirm PR changed-file scope contains the expected Web/DB/docs responsibility files and no CSS/package/deployment files.
- [x] `pnpm architecture:check` — passed on documentation/locality head via Quality run #62.
- [x] `pnpm test` — passed on documentation/locality head via Quality run #62.
- [x] `pnpm typecheck` — passed on documentation/locality head via Quality run #62.
- [x] `pnpm build` — passed on documentation/locality head via Quality run #62.
- [ ] `git diff --check` — not independently runnable in this execution environment because no full authenticated local checkout is available; it is not part of current Quality workflow.
- [x] Confirm no intentional business-rule, DB schema semantic, CSS, deployment, or runtime dependency changes.
- [x] Draft PR #18 exists against `main` and has been the continuous verification surface.
- [ ] Require a fresh successful Quality run on the final documentation/checklist head, then mark PR ready and merge.

## Verification history

Key green runs during Phase C:

- #38 — explicit navigation
- #41 — SalaryManagement split
- #48 — ImportWizard split
- #52 — Web test responsibility split
- #54 — Web API/type split
- #60 — DB split after compatibility fix
- #62 — AI_INDEX/HANDOFF locality synchronization

No Phase C change has been deployed.
