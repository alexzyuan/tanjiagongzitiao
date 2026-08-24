# HANDOFF

> Current-state handoff only. Historical task logs and superseded plans belong in `CODEX_TASKS.md`, `docs/superpowers/`, or `docs/history/` and are not default agent context.

## Repository state

- Repository: `alexzyuan/tanjiagongzitiao`
- `main`: `efd7aba75c896a1b89ee541bad53e8477bc3c44a`
- Codex-first Phases A–D: merged
- Open PRs: none at the time of this handoff
- Active refactor: none
- Next work: normal product-driven iteration; no Phase E/F is pre-approved

The current working tree may contain user-owned untracked files. Preserve them and never stage `.superpowers/`, source archives, SQLite files, dependency caches, or secrets.

## Current architecture

Read these files in order for a normal task:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/AI_INDEX.md`
4. `docs/BUSINESS_RULES.md` when salary lifecycle, permissions, employee visibility, confirmation, withdrawal, resend, or archive semantics are involved

The application is React + Fastify + TypeScript + SQLite/WAL with AES-256-GCM salary-field encryption, DingTalk work-notification `link` delivery, and a one-shot externally scheduled archive worker.

Hard boundaries include:

- employee identity isolation and server-side `visibleFields` filtering;
- encrypted salary storage and no sensitive values in logs, audit metadata, docs, or Git;
- local withdrawal is not remote deletion of an already-delivered DingTalk notification;
- archived salary is immutable through normal edit flows;
- production SQLite uses an absolute path outside release directories;
- no Redis/PostgreSQL/ORM/MQ/DI/Redux/React Query/new Router/Tailwind/CSS-in-JS without explicit approval.

## Current responsibility map

- Salary lifecycle: `packages/domain/src/salary.ts`, `apps/api/src/modules/salary/service.ts`, `apps/api/src/modules/salary/delivery.ts`
- Employee salary access: `apps/api/src/modules/salary/employee.ts`, `apps/web/src/pages/EmployeeSalary.tsx`
- Import: `apps/api/src/modules/salary/import.ts`, `apps/web/src/features/salary/ImportWizard.tsx`, `apps/web/src/features/salary/import/`
- Salary management Web: `apps/web/src/pages/SalaryManagement.tsx`, `apps/web/src/features/salary/`
- Persistence/encryption: `packages/db/src/store.ts`, `memory-store.ts`, `sqlite-store.ts`, `sqlite-schema.ts`, `crypto.ts`
- Architecture checks: `scripts/architecture-rules.mjs`, `scripts/architecture-rules.test.mjs`, `deploy.sh`

## Completed maintainability work

- Phase A: current-truth architecture, business-rule, AI change-map, and history-boundary documentation
- Phase B: domain/service policy locality and server-authoritative salary capabilities
- Phase C: Web salary/import responsibility locality, API type separation, and DB physical split
- Phase D: semantic CSS tokens, scoped table rules, explicit CSS ownership, architecture regression coverage, and non-blocking warning cleanup

The remaining file-size warnings are review signals, not automatic refactor orders. Prettier remains installed but is not a CI hard gate.

## Production boundary

The Phase A–D merge did not imply production deployment. Before any deploy or rollback, verify the live release, commit, SQLite path, service status, backup, readiness, homepage, and `/healthz` directly. Use the existing `deploy.sh` and keep rollback capability.

## Change and verification discipline

- Use a `codex/*` branch for non-trivial work.
- Keep business rules in their authoritative domain/API source; Web consumes server capabilities.
- Behavior fixes require a failing regression test before the minimal implementation change.
- Before merging a non-trivial branch, run the exact Quality checks: `pnpm install --frozen-lockfile`, `pnpm architecture:check`, `pnpm test`, `pnpm typecheck`, and `pnpm build`; run `git diff --check` separately.
- Do not push, merge, or deploy without explicit user authorization.
