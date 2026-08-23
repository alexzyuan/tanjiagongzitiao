# AI Change Index

> Fast change map for Codex/AI agents. Use this to decide what to read first. It intentionally avoids duplicating implementation details.

## Default reading order

For a normal repository task, read:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. the relevant section below
4. `docs/BUSINESS_RULES.md` if salary lifecycle/permissions/employee behavior is involved
5. only the directly relevant code and tests

Do **not** load `CODEX_TASKS.md` or `docs/history/` by default unless the task explicitly depends on historical reasoning.

---

## Salary batch lifecycle / admin actions

Read first:

- `packages/domain/src/salary.ts`
- `apps/api/src/modules/salary/service.ts`
- `apps/api/test/salary-management-actions.test.ts`
- `docs/BUSINESS_RULES.md`

Typical tasks:

- delete rules
- edit rules
- archive rules
- state transitions
- batch capabilities

---

## DingTalk send / withdraw / resend

Read first:

- `apps/api/src/modules/salary/delivery.ts`
- `packages/dingtalk/src/`
- salary delivery-related API tests
- `docs/BUSINESS_RULES.md`

Typical tasks:

- single send
- batch send
- resend
- withdrawal
- in-flight concurrency protection
- DingTalk work-notification payloads

Remember: current verified channel is work notification `asyncsend_v2` using a `link` message. Local withdrawal is not remote deletion.

---

## Salary import / Excel matching

Read first:

- `apps/api/src/modules/salary/import.ts`
- `apps/api/src/modules/salary/routes.ts`
- `apps/web/src/features/salary/ImportWizard.tsx`
- import-related API/Web tests

Typical tasks:

- workbook parsing
- header aliases
- summary rows
- employee matching
- temporary previews
- import confirmation

---

## Salary management Web UI

Read first:

- `apps/web/src/pages/SalaryManagement.tsx`
- `apps/web/src/features/salary/`
- `apps/web/src/api.ts`
- `apps/web/src/styles/salary.css`
- relevant Web tests

Typical tasks:

- batch list
- employee table
- delete/edit dialogs
- filters
- status display
- month selection

Business capability must come from server/domain truth rather than being re-derived in the UI.

---

## Employee salary page

Read first:

- `apps/api/src/modules/salary/employee.ts`
- employee salary routes in `apps/api/src/modules/salary/routes.ts`
- `apps/web/src/pages/EmployeeSalary.tsx`
- `apps/web/src/pages/EmployeeSalary.test.tsx`
- `docs/BUSINESS_RULES.md`

Typical tasks:

- own-salary access
- recent salary list
- view tracking
- confirmation
- withdrawal/reconfirmation behavior

Security boundary: employee identity isolation and `visibleFields` filtering are server-side.

---

## Permissions / administrators

Read first:

- `packages/domain/src/authorization.ts`
- `apps/api/src/modules/authorization/`
- `apps/web/src/pages/PermissionCenter.tsx`
- `apps/web/src/pages/PermissionCenter.test.tsx`

Typical tasks:

- main admin
- sub-admin
- batch admin
- directory validation

---

## Evidence / audit / reporting

Read first:

- `apps/api/src/modules/audit/`
- `apps/api/src/modules/reports/`
- evidence/report methods in `packages/db/src/store.ts` and `packages/db/src/sqlite-store.ts`
- `apps/web/src/pages/EvidenceCenter.tsx`
- `apps/web/src/pages/ReportCenter.tsx`
- relevant tests

Typical tasks:

- delivery evidence
- viewed/confirmed evidence
- audit events
- report totals

Do not place salary values or sensitive personal data in audit/evidence metadata.

---

## Database / encryption / migrations

Read first:

- `packages/db/src/store.ts`
- `packages/db/src/sqlite-store.ts`
- `packages/db/src/crypto.ts`
- `packages/domain/src/salary.ts`

Typical tasks:

- SalaryStore contract
- SQLite queries
- schema compatibility
- encrypted salary fields
- memory-store behavior

Production remains SQLite/WAL. Do not introduce ORM or a second database without explicit architecture approval.

---

## DingTalk integration

Read first:

- `packages/dingtalk/src/`
- auth-related modules under `apps/api/src/modules/auth/`
- `apps/web/src/api.ts` for DingTalk JSAPI/session bootstrapping

Typical tasks:

-免登/auth
- directory lookup
- work notifications
- DingTalk transport/error handling

Do not guess unsupported card payload fields on the existing work-notification endpoint.

---

## Shared Web components

Read first:

- `apps/web/src/components/`
- `apps/web/src/styles/components.css`
- `apps/web/src/styles/base.css`

Typical tasks:

- modal
- field
- status
- loading/empty state
- shared table/button behavior

Prefer reusing an existing shared component only when semantics truly match.

---

## CSS / visual maintenance

Read first:

- `apps/web/src/styles.css`
- `apps/web/src/styles/base.css`
- `apps/web/src/styles/components.css`
- the feature-specific stylesheet (`salary.css`, `employee.css`, `import.css`, or `admin.css`)
- `scripts/architecture-rules.mjs` for duplicate-selector checks

Principles:

- plain CSS remains the default;
- prefer semantic class names/tokens;
- avoid selectors coupled to DOM position when a named class is clearer;
- avoid global selectors that unintentionally style unrelated feature markup.

---

## App shell / navigation / session boot

Read first:

- `apps/web/src/App.tsx`
- `apps/web/src/api.ts`
- `apps/web/src/App.test.tsx`
- auth/session API modules

Typical tasks:

- admin navigation
- app boot
- employee/admin viewport routing
- session loading/errors

---

## Worker / archive

Read first:

- `apps/worker/`
- archive methods in `packages/db/`
- `docs/ARCHITECTURE.md`

Invariant: worker is one-shot; scheduling is external.

---

## Architecture checks / dependencies

Read first:

- `scripts/architecture-rules.mjs`
- `scripts/check-architecture.mjs`
- root/package-level `package.json`
- `.github/workflows/quality.yml`
- `AGENTS.md`

Typical tasks:

- dependency boundaries
- banned infrastructure
- file-size warnings
- CSS duplicate warnings
- CI quality gate

---

## Deployment / operations

Read first:

- `deploy.sh`
- `.env.example`
- deployment-related files under repository root/docs
- `HANDOFF.md`

Rules:

- never output secret values;
- production SQLite path stays outside release directories;
- deployment must preserve backup/rollback capability;
- do not modify production/deploy behavior during unrelated feature work.

---

## Historical design decisions

Only when the current task specifically needs origin/history:

- `docs/superpowers/specs/`
- `docs/superpowers/plans/`
- `docs/history/`
- `CODEX_TASKS.md`

These are not default current-truth context.
