# HANDOFF

> Current-state handoff only. Historical task logs and old implementation narratives belong in `CODEX_TASKS.md`, `docs/superpowers/`, or `docs/history/` and are not default agent context.

## 1. Current repository state

- Repository: `alexzyuan/tanjiagongzitiao`
- Current integrated `main` baseline for Phase C: `d45a6f6aa75fb210032802a13893e51bdf3ddf14` (Codex-first Phases A+B merged).
- Active work branch: `codex/codex-first-phase-c`.
- Pull request: `#18` targeting `main`, currently used as the continuous Quality verification surface.
- Phase C is a responsibility-locality refactor; it must not change salary business semantics, permissions, DB schema semantics, encryption, DingTalk behavior, CSS, runtime dependencies, or deployment behavior.
- Latest code-bearing Phase C head `2c2f2925ce1e683f2b75ce7366996ad0c3e93b26` passed GitHub Quality run `#60` (`32620349755`): install, architecture check, test, typecheck, and build all succeeded.
- Documentation/locality synchronization commits after that code-bearing head still require a fresh successful Quality run on the final PR head before merge.
- Phase C has not been deployed.
- Production commit is **not** treated as known from this file; verify production runtime/release state directly before any deploy/rollback decision.

## 2. Product state

The project is a DingTalk internal salary-slip application with:

- admin salary management;
- three-step Excel import and DingTalk directory matching;
- encrypted SQLite salary storage;
- DingTalk/session authentication;
- DingTalk work-notification `link` delivery;
- batch and individual send;
- withdrawal/edit/resend;
- employee mobile salary view and confirmation;
- permissions/admin management;
- evidence/audit/report/settings;
- one-shot archive worker;
- GitHub Quality architecture/test/typecheck/build gate;
- deployment health/readiness/rollback hardening already present in integrated `main`.

## 3. Architecture and hard boundaries

Read `docs/ARCHITECTURE.md` for current architecture and `docs/BUSINESS_RULES.md` before changing salary lifecycle behavior.

Hard invariants remain:

- salary fields encrypted at rest with AES-256-GCM;
- employee salary isolation and `visibleFields` filtering enforced server-side;
- salary/personal secrets never written to logs/audit metadata/docs;
- verified DingTalk notification channel remains work notification `asyncsend_v2` with a `link` message;
- local withdrawal is not remote deletion of an already-delivered DingTalk notification;
- archived salary is immutable through normal salary management edit flows;
- recent employee history window remains 12 months unless separately changed;
- production SQLite uses an absolute path outside release directories and remains WAL-based;
- archive worker remains one-shot and externally scheduled;
- no Redis/PostgreSQL/ORM/MQ/DI/Redux/React Query/Router/Tailwind/CSS-in-JS without explicit architecture approval.

## 4. Codex / Agent reading order

For a normal task:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/AI_INDEX.md`
4. `docs/BUSINESS_RULES.md` when business semantics are involved
5. only directly relevant implementation and tests

Do not load the large historical `CODEX_TASKS.md` by default.

## 5. Current salary rule ownership from Phase B

- Pure batch-delete eligibility: `packages/domain/src/salary.ts` → `canDeleteSalaryBatch`.
- Pure item-edit eligibility: `packages/domain/src/salary.ts` → `canEditSalaryItem`.
- Runtime/in-flight send protection stays in API service/delivery code.
- Web batch deletion uses server `canDelete`; do not reintroduce a client-side lifecycle fallback.
- Failed employee filtering uses item-level `deliveryStatus`.
- Delivery failure wording is “发送异常”, not “导入数据异常”.

## 6. Phase C responsibility ownership

### Web salary management

- `apps/web/src/pages/SalaryManagement.tsx` — page/data/API orchestration and dialog state.
- `apps/web/src/features/salary/SalaryBatchOverview.tsx` — month/batch summary presentation.
- `apps/web/src/features/salary/SalaryEmployeeTable.tsx` — employee table/filter/action presentation.
- Admin-module navigation is explicit through props/App state; do not restore global CustomEvent navigation.

### Import

- `ImportWizard.tsx` owns wizard state, preview/resolution state, and API orchestration.
- `features/salary/import/ImportUploadStep.tsx`, `ImportMatchStep.tsx`, and `ImportConfirmStep.tsx` own step presentation only.

### Web API

- `apps/web/src/api.ts` owns HTTP/session/DingTalk boot transport.
- `apps/web/src/api-types.ts` owns stable Web/API DTO declarations; `api.ts` re-exports types for compatibility.

### DB

- `packages/db/src/store.ts` owns public DB types and the `SalaryStore` contract; it keeps a compatibility re-export of `MemorySalaryStore` for existing module imports.
- `packages/db/src/memory-store.ts` owns `MemorySalaryStore` implementation.
- `packages/db/src/sqlite-store.ts` owns SQLite runtime CRUD/mapping/transactions.
- `packages/db/src/sqlite-schema.ts` owns schema creation, compatibility ALTER, and startup withdrawn-interaction normalization.
- `packages/db/src/crypto.ts` owns salary payload encryption/decryption.

The DB split is physical only. SQL text, migration order, encryption behavior, store interface, and SQLite architecture must remain unchanged unless separately approved.

## 7. Tests after Phase C

Web behavior tests are organized by responsibility rather than one oversized `App.test.tsx`:

- `apps/web/src/salary-management.test.tsx`
- `apps/web/src/admin-modules.test.tsx`
- `apps/web/src/employee-salary.test.tsx`
- page-local tests remain next to their pages where already appropriate.

Test names should continue to describe protected behavior.

## 8. Current known maintainability targets

- `SalaryManagement.tsx` is now approximately just over the 400-line architecture warning threshold (latest Quality warning: 414 > 400). Do **not** split further solely to clear the warning; only split again if a real new responsibility appears.
- CSS semantic-token/class cleanup remains a separate future phase; Phase C intentionally does not change CSS.
- `CODEX_TASKS.md` remains legacy historical material and should not enter default agent context.

## 9. Verification state

Phase C evidence so far:

- Tasks 1–5 each received successful GitHub Quality verification during implementation.
- Task 6 initially exposed one compatibility regression: `packages/db/test/sqlite-store.test.ts` imports `MemorySalaryStore` directly from `../src/store.js`. The physical split removed that historical module export.
- The root cause was fixed by adding an explicit compatibility re-export from `store.ts`; no implementation or business behavior changed.
- Quality run #60 on code head `2c2f2925ce1e683f2b75ce7366996ad0c3e93b26` then passed:

```bash
pnpm install --frozen-lockfile
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
```

- `git diff --check` is not part of the current GitHub Quality workflow and has not been independently run in a full local checkout in this execution environment.
- The **final PR head** must receive another fresh successful Quality run after the documentation/locality sync before Phase C can be merged.

Never report a command as passed unless it actually ran successfully.

## 10. Git / deployment rules

- Use `codex/*` branches for non-trivial work.
- Protect user/local files; do not use destructive reset/clean commands.
- Do not commit `.env`, secrets, SQLite DB/backups, dependency caches, `.superpowers/`, or source archives.
- Do not deploy as part of this maintainability refactor.
- Production changes require separate backup/readiness/rollback verification.
