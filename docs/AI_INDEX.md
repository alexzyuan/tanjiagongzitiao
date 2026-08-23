# AI Change Index

> Fast change map for Codex/AI agents. Use this to decide what to read first. It intentionally points to current sources of truth instead of duplicating implementation details.

## Default reading order

For a normal task:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. the relevant section below
4. `docs/BUSINESS_RULES.md` when salary lifecycle, permissions, employee visibility, confirmation, withdrawal, resend, or archive semantics are involved
5. only the directly relevant implementation and tests

Do **not** load `CODEX_TASKS.md`, `docs/history/`, or old implementation plans by default.

---

## Salary batch lifecycle / admin actions

Read first:

- `packages/domain/src/salary.ts`
- `apps/api/src/modules/salary/service.ts`
- `apps/api/src/modules/salary/delivery.ts` when send/withdraw/resend is involved
- `apps/api/test/salary-management-actions.test.ts`
- `docs/BUSINESS_RULES.md`

Use for delete/edit/archive/state-transition/capability changes. Pure rules belong in domain; runtime/in-flight checks stay in API orchestration.

---

## Salary management Web UI

Read first:

- `apps/web/src/pages/SalaryManagement.tsx`
- `apps/web/src/features/salary/SalaryBatchOverview.tsx`
- `apps/web/src/features/salary/SalaryEmployeeTable.tsx`
- `apps/web/src/salary-management.test.tsx`
- `apps/web/src/api-types.ts` only when response/DTO shape changes
- `apps/web/src/styles/salary.css` only when visual behavior changes

Responsibilities:

- `SalaryManagement.tsx` — page orchestration, loading, API actions, edit/delete dialog state.
- `SalaryBatchOverview.tsx` — month controls and batch summary cards; no lifecycle API calls.
- `SalaryEmployeeTable.tsx` — loaded employee rows, filtering, row actions; failed filtering uses item `deliveryStatus`.

Business capabilities such as `canDelete` remain server-authoritative.

---

## Salary import / Excel matching

Read first:

- `apps/api/src/modules/salary/import.ts`
- `apps/api/src/modules/salary/routes.ts`
- `apps/web/src/features/salary/ImportWizard.tsx`
- the one relevant step under `apps/web/src/features/salary/import/`
- import-related API/Web tests

Step ownership:

- `ImportUploadStep.tsx` — upload/parse presentation.
- `ImportMatchStep.tsx` — directory matching/resolution presentation.
- `ImportConfirmStep.tsx` — salary-slip settings/final confirmation presentation.
- `ImportWizard.tsx` — step state, preview id, resolutions, API search/preview/commit orchestration.

Do not move independent data stores or API orchestration into step components without a real need.

---

## DingTalk send / withdraw / resend

Read first:

- `apps/api/src/modules/salary/delivery.ts`
- `packages/dingtalk/src/`
- relevant salary API tests
- `docs/BUSINESS_RULES.md`

Remember: the verified channel is DingTalk work notification `asyncsend_v2` with a `link` message. Local withdrawal is not remote deletion.

---

## Employee salary page

Read first:

- `apps/api/src/modules/salary/employee.ts`
- employee routes in `apps/api/src/modules/salary/routes.ts`
- `apps/web/src/pages/EmployeeSalary.tsx`
- `apps/web/src/pages/EmployeeSalary.test.tsx`
- `apps/web/src/employee-salary.test.tsx` when app-level employee routing/semantics matter
- `docs/BUSINESS_RULES.md`

Employee identity isolation and `visibleFields` filtering are server-side security boundaries.

---

## App shell / admin navigation / session boot

Read first:

- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/admin-modules.test.tsx`
- the destination page/component involved

Admin navigation is explicit through props/state. Do not reintroduce global `CustomEvent` navigation for normal module transitions.

`api.ts` owns HTTP/session/DingTalk boot transport. Stable DTO/type declarations live in `api-types.ts` and are re-exported from `api.ts` for compatibility.

---

## Permissions / administrators

Read first:

- `packages/domain/src/authorization.ts`
- `apps/api/src/modules/authorization/`
- `apps/web/src/pages/PermissionCenter.tsx`
- `apps/web/src/pages/PermissionCenter.test.tsx`
- `apps/web/src/admin-modules.test.tsx` when navigation is involved

---

## Database contract / Memory store

Read first:

- `packages/db/src/store.ts`
- `packages/db/src/memory-store.ts`
- `packages/db/test/`
- the API/domain test exercising the behavior

Ownership:

- `store.ts` — public DB types and `SalaryStore` contract only, plus compatibility re-export for `MemorySalaryStore`.
- `memory-store.ts` — in-memory implementation used by tests/local flows.

Do not add Repository/UnitOfWork/DI layers merely because the implementation is in a separate file.

---

## SQLite queries / schema / encryption

Read first:

- `packages/db/src/sqlite-store.ts`
- `packages/db/src/sqlite-schema.ts`
- `packages/db/src/crypto.ts`
- `packages/db/test/sqlite-store.test.ts`
- `packages/domain/src/salary.ts` when state transitions are involved

Ownership:

- `sqlite-store.ts` — runtime SQLite CRUD, mapping, transactions, store behavior.
- `sqlite-schema.ts` — schema creation, compatibility ALTERs, startup data normalization/migration helpers.
- `crypto.ts` — salary-field encryption/decryption.

Production remains SQLite/WAL. Schema SQL or migration order must not change during a file-only refactor.

---

## Evidence / audit / reporting

Read first:

- `apps/api/src/modules/audit/`
- `apps/api/src/modules/reports/`
- relevant methods in `packages/db/src/store.ts` and the selected implementation (`memory-store.ts` or `sqlite-store.ts`)
- `apps/web/src/pages/EvidenceCenter.tsx` or `ReportCenter.tsx`
- relevant tests

Do not place salary values or sensitive personal data in audit/evidence metadata.

---

## DingTalk integration

Read first:

- `packages/dingtalk/src/`
- auth-related modules under `apps/api/src/modules/auth/`
- `apps/web/src/api.ts` for DingTalk JSAPI/session bootstrapping

Do not guess unsupported card payload fields on the existing work-notification endpoint.

---

## CSS / shared Web presentation

Read first:

- `apps/web/src/styles/base.css`
- `apps/web/src/styles/components.css`
- the single feature stylesheet involved (`salary.css`, `employee.css`, `import.css`, or `admin.css`)
- the relevant TSX component
- `scripts/architecture-rules.mjs` only when selector/dependency rules matter

Use semantic classes/tokens, avoid DOM-position coupling, and avoid global selectors leaking into unrelated features.

---

## Worker / archive

Read first:

- `apps/worker/`
- archive methods in `packages/db/src/store.ts` plus the active store implementation
- `docs/ARCHITECTURE.md`
- `docs/BUSINESS_RULES.md`

Invariant: worker is one-shot; scheduling is external.

---

## Architecture checks / dependencies

Read first:

- `scripts/architecture-rules.mjs`
- `scripts/check-architecture.mjs`
- root/package-level `package.json`
- `.github/workflows/quality.yml`
- `AGENTS.md`

Hard architecture violations fail CI. File-size warnings are prompts to inspect responsibility, not automatic refactor orders.

---

## Deployment / operations

Read first:

- `deploy.sh`
- `.env.example`
- deployment/operations docs
- `HANDOFF.md`

Never output secrets. Production SQLite stays outside release directories, and deployment must preserve backup/readiness/rollback capability.

---

## Historical design decisions

Only when the current task specifically needs origin/history:

- `docs/superpowers/specs/`
- `docs/superpowers/plans/`
- `docs/history/`
- `CODEX_TASKS.md`

These are not default current-truth context.
