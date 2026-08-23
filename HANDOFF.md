# HANDOFF

> Current-state handoff only. Historical task logs and old implementation narratives belong in `CODEX_TASKS.md`, `docs/superpowers/`, or `docs/history/` and are not default agent context.

## 1. Current repository state

- Repository: `alexzyuan/tanjiagongzitiao`
- Current `main` baseline for this handoff: `cd923b79277dde069f4983f6ec1c29fab7e2deab`
- Active work branch: `codex/codex-first-phase-b`
- Pull request: `#17` targeting `main`.
- The branch contains the Phase A Codex-first documentation baseline plus the Phase B salary-policy single-source cleanup.
- It is not deployed.
- The latest code-bearing head `e9d0515cc05234f3b81d45675d28f3629377b5f7` passed GitHub Quality run `#31` (`32617527197`): install, architecture check, test, typecheck, and build all succeeded.
- Any commit after that verified head, including documentation-only synchronization, must receive a fresh successful Quality run before merge.
- Production commit is **not** treated as known from this file; verify production runtime/release state directly before any deploy/rollback decision.

## 2. Product state

The project is a DingTalk internal salary-slip application.

Current established capabilities include:

- admin salary management;
- three-step Excel import and DingTalk directory matching;
- encrypted SQLite salary storage;
- DingTalk/session authentication;
- DingTalk work-notification `link` delivery;
- batch and individual salary send flows;
- withdrawal/edit/resend flows;
- employee mobile salary view and confirmation;
- permissions/admin management;
- evidence/audit/report/settings features;
- one-shot archive worker;
- CI architecture/test/typecheck/build quality gate;
- deployment health/readiness/rollback hardening in current `main`.

## 3. Current architecture

Read `docs/ARCHITECTURE.md` for the authoritative current structure.

Summary:

```text
apps/web (React)
    ↓ HTTP
apps/api (Fastify)
  ├─ packages/domain
  ├─ packages/db → SQLite/WAL
  └─ packages/dingtalk → DingTalk APIs

apps/worker → packages/db/domain
(one-shot, externally scheduled)
```

Keep the system lightweight. Do not add Redis, a second production database, ORM, MQ, resident scheduler, Redux/React Query/Router, Tailwind/CSS-in-JS, or complex application-layer abstractions without explicit architecture approval.

## 4. Hard business/security boundaries

- Salary fields are encrypted at rest with AES-256-GCM.
- Employee salary access is isolated server-side by authenticated identity.
- `visibleFields` filtering is server-side.
- Salary values and sensitive personal data must not be written to logs/audit metadata/docs.
- Current verified notification channel is DingTalk work notification `asyncsend_v2` using a `link` message.
- The project does not use DING.
- Local withdrawal does not mean a delivered DingTalk notification was remotely deleted.
- Archived salary is not editable through normal salary management actions.
- Employee salary visibility is limited to the recent configured history window (currently 12 months).
- Production SQLite must use an absolute path outside release directories.
- Archive worker remains one-shot and externally scheduled.

Read `docs/BUSINESS_RULES.md` before changing salary lifecycle, delete/edit/withdraw/resend, employee view/confirm, or archive behavior.

## 5. Agent reading order

For a normal new task:

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/AI_INDEX.md`
4. `docs/BUSINESS_RULES.md` when business semantics are involved
5. directly relevant implementation + tests

Do not load the large historical `CODEX_TASKS.md` by default.

## 6. Phase B current rule ownership

Phase B establishes the following current ownership:

- Pure delete eligibility lives in `packages/domain/src/salary.ts` as `canDeleteSalaryBatch`.
- Pure edit eligibility lives in `packages/domain/src/salary.ts` as `canEditSalaryItem`.
- Runtime in-flight send protection remains in `apps/api/src/modules/salary/service.ts` / delivery service and is not moved into domain.
- Batch-list `canDelete` is calculated by the server and the Web UI consumes that capability instead of reconstructing lifecycle rules.
- Employee failure filtering uses the employee item's latest `deliveryStatus`, not only the batch-level `partially_failed` state.
- The UI wording for delivery failure is “发送异常”, not “导入数据异常”.

Do not reintroduce a client-side delete fallback unless a separately approved backwards-compatibility requirement requires it.

## 7. Current known maintainability targets

These are improvement candidates, not automatic authorization to refactor:

- `apps/web/src/pages/SalaryManagement.tsx` is large and should only be split by real UI responsibility when that work is explicitly taken on.
- `apps/web/src/features/salary/ImportWizard.tsx` is large and should only be split by real wizard-step responsibility.
- `packages/db/src/store.ts` / `sqlite-store.ts` are growing and may later be physically split by store/schema responsibility without introducing repository/DI layers.
- CSS should move toward semantic tokens/classes and away from fragile DOM-position selectors/global element leakage.
- `CODEX_TASKS.md` contains substantial historical task material and should eventually be archived/split, but Phase A intentionally did not rewrite it destructively.

File-size architecture warnings are signals only; do not refactor solely to make warnings disappear.

## 8. Current documentation contract

- `AGENTS.md` — permanent execution constraints and Codex-First rules.
- `docs/ARCHITECTURE.md` — current system architecture/ownership/invariants.
- `docs/BUSINESS_RULES.md` — current salary business intent.
- `docs/AI_INDEX.md` — change map: task → files to read first.
- `HANDOFF.md` — current status only.
- `docs/history/` — historical material, non-default context.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — approved designs/plans and historical implementation context.
- `CODEX_TASKS.md` — legacy task/phase record; read only when historical phase context is required.

## 9. Git / deployment rules

- Use `codex/*` branches for non-trivial work.
- Protect local/untracked user files; do not use destructive cleanup/reset commands.
- Do not commit `.env`, production secrets, SQLite DB/backup files, dependency caches, `.superpowers/`, or local source archives.
- Do not merge or deploy without explicit user authorization.
- Production changes require separate backup/readiness/rollback verification.

## 10. Verification state

Phase B verification evidence so far:

- Pure domain policy was independently syntax/type checked and exercised with a small red/green policy harness during implementation.
- GitHub branch scope/diff and PR changed-file scope have been checked.
- PR #17 Quality run #30 exposed an `exactOptionalPropertyTypes` compile failure (`TS2379`); the root cause was fixed without changing business semantics.
- PR #17 Quality run #31 on `e9d0515cc05234f3b81d45675d28f3629377b5f7` completed successfully through:

```bash
pnpm install --frozen-lockfile
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
```

- `git diff --check` is not part of the current GitHub Quality workflow and still requires separate verification before final integration if available.
- Any commit after the verified head must receive a fresh successful Quality run before merge.

Never report a command as passed unless it actually ran successfully.
