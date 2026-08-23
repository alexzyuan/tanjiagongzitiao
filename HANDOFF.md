# HANDOFF

> Current-state handoff only. Historical task logs and old implementation narratives belong in `CODEX_TASKS.md`, `docs/superpowers/`, or `docs/history/` and are not default agent context.

## 1. Repository state

- Repository: `alexzyuan/tanjiagongzitiao`
- Codex-first maintainability Phases A–C are integrated into `main`.
- Phase D is tracked by PR `#19` from `codex/codex-first-phase-d` to `main` and contains CSS predictability plus low-cost engineering guardrails only.
- Phase D does not change salary business rules, API contracts, DB schema semantics, encryption, DingTalk behavior, runtime dependencies, or deployment behavior.
- No production deployment is part of Phase D.
- Production runtime/release state must be verified directly before any deploy or rollback decision; do not infer it from this file.

## 2. Product architecture

The project is a DingTalk internal salary-slip application using React, Fastify, SQLite/WAL, AES-256-GCM salary-field encryption, DingTalk work notifications, and a one-shot archive worker.

Hard invariants:

- employee salary isolation and `visibleFields` filtering are server-side boundaries;
- salary/personal secrets never belong in logs, audit metadata, docs, or commits;
- verified DingTalk notification channel is work notification `asyncsend_v2` with a `link` message;
- local withdrawal does not delete an already-delivered DingTalk notification;
- archived salary is immutable through normal salary-management edit flows;
- production SQLite uses an absolute path outside release directories;
- archive worker remains one-shot and externally scheduled;
- no Redis/PostgreSQL/ORM/MQ/DI/Redux/React Query/Router/Tailwind/CSS-in-JS without explicit architecture approval.

Read `docs/ARCHITECTURE.md` for architecture and `docs/BUSINESS_RULES.md` before changing salary lifecycle semantics.

## 3. Default Codex / agent reading order

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/AI_INDEX.md`
4. `docs/BUSINESS_RULES.md` when business semantics are involved
5. only directly relevant implementation and tests

Do not load `CODEX_TASKS.md`, old plans, or history by default.

## 4. Responsibility locality from Phase C

### Web salary management

- `apps/web/src/pages/SalaryManagement.tsx` — page/data/API orchestration and dialog state.
- `apps/web/src/features/salary/SalaryBatchOverview.tsx` — month/batch summary presentation.
- `apps/web/src/features/salary/SalaryEmployeeTable.tsx` — employee table/filter/action presentation.
- Admin navigation is explicit through props/App state; do not restore global CustomEvent navigation.

### Import

- `ImportWizard.tsx` owns wizard state, preview/resolution state, and API orchestration.
- `features/salary/import/ImportUploadStep.tsx`, `ImportMatchStep.tsx`, and `ImportConfirmStep.tsx` own step presentation only.

### Web API

- `apps/web/src/api.ts` owns HTTP/session/DingTalk boot transport.
- `apps/web/src/api-types.ts` owns stable Web/API DTO declarations; `api.ts` re-exports types for compatibility.

### DB

- `packages/db/src/store.ts` owns public DB types and the `SalaryStore` contract plus the compatibility re-export for `MemorySalaryStore`.
- `packages/db/src/memory-store.ts` owns the in-memory implementation.
- `packages/db/src/sqlite-store.ts` owns runtime SQLite CRUD/mapping/transactions.
- `packages/db/src/sqlite-schema.ts` owns schema creation/compatibility migration setup.
- `packages/db/src/crypto.ts` owns salary payload encryption/decryption.

## 5. Phase D CSS conventions

- Semantic color/surface/status/shadow custom properties live in `apps/web/src/styles/base.css`.
- Existing legacy CSS variables remain compatibility aliases; do not mass-rewrite feature styles merely to remove aliases.
- Shared table selectors in `components.css` are scoped under `.table-scroll`; avoid global `table/th/td/tbody tr` selectors.
- Use explicit semantic classes rather than DOM-position selectors such as `nth-last-child`.
- Keep semantically different statuses explicit, including archived vs withdrawn.
- Maintenance-only CSS changes should preserve rendered values unless the task explicitly asks for visual redesign.

## 6. Engineering guardrails

- `pnpm architecture:check` enforces hard dependency/import/infrastructure rules and reports non-blocking size/selector warnings.
- `pnpm test` now also executes `scripts/architecture-rules.test.mjs`; architecture-rule tests are no longer orphaned from CI.
- DB size warnings apply to `*store.ts` under `packages/db`, not only `store.ts`.
- Prettier is installed but is not a CI hard gate. A Phase D trial of `prettier --check .` found 82 existing files outside the formatting baseline, so the gate was reverted rather than creating a repository-wide format-only diff.
- If formatting is standardized later, do it as an isolated migration rather than mixing it with feature work.

## 7. Known maintainability targets

- `SalaryManagement.tsx` remains slightly above the 400-line architecture warning threshold. Do not split it solely to remove the warning; split only if a real responsibility emerges.
- Architecture file-size warnings are prompts for review, not automatic refactor orders.
- `CODEX_TASKS.md` remains historical material rather than default agent context.

## 8. Verification / integration rules

Before merging a non-trivial branch, verify the exact PR head with the GitHub Quality workflow:

```bash
pnpm install --frozen-lockfile
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
```

`git diff --check` is not currently part of the GitHub Quality workflow; do not claim it passed unless it was actually run in a full checkout.

Use `codex/*` branches for non-trivial work. Do not commit secrets, SQLite DB/backups, dependency caches, `.superpowers/`, or source archives. Deployment is a separate operation requiring backup/readiness/rollback verification.
