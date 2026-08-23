# HANDOFF

> Current-state handoff only. Historical task logs and old implementation narratives belong in `CODEX_TASKS.md`, `docs/superpowers/`, or `docs/history/` and are not default agent context.

## 1. Current repository state

- Repository: `alexzyuan/tanjiagongzitiao`
- Current `main` baseline for this handoff: `cd923b79277dde069f4983f6ec1c29fab7e2deab`
- Active documentation work branch: `codex/codex-first-phase-a`
- This branch is documentation-only and is not merged or deployed.
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

## 6. Current known maintainability targets

These are improvement candidates, not automatic authorization to refactor:

- `apps/web/src/pages/SalaryManagement.tsx` is large and should only be split by real UI responsibility when that work is explicitly taken on.
- `apps/web/src/features/salary/ImportWizard.tsx` is large and should only be split by real wizard-step responsibility.
- `packages/db/src/store.ts` / `sqlite-store.ts` are growing and may later be physically split by store/schema responsibility without introducing repository/DI layers.
- Web salary capability rules should increasingly rely on server/domain truth instead of UI fallbacks.
- CSS should move toward semantic tokens/classes and away from fragile DOM-position selectors/global element leakage.
- `CODEX_TASKS.md` contains substantial historical task material and should eventually be archived/split, but Phase A intentionally does not rewrite it destructively.

File-size architecture warnings are signals only; do not refactor solely to make warnings disappear.

## 7. Current documentation contract

- `AGENTS.md` — permanent execution constraints and Codex-First rules.
- `docs/ARCHITECTURE.md` — current system architecture/ownership/invariants.
- `docs/BUSINESS_RULES.md` — current salary business intent.
- `docs/AI_INDEX.md` — change map: task → files to read first.
- `HANDOFF.md` — current status only.
- `docs/history/` — historical material, non-default context.
- `docs/superpowers/specs/` and `docs/superpowers/plans/` — approved designs/plans and historical implementation context.
- `CODEX_TASKS.md` — legacy task/phase record; read only when historical phase context is required.

## 8. Git / deployment rules

- Use `codex/*` branches for non-trivial work.
- Protect local/untracked user files; do not use destructive cleanup/reset commands.
- Do not commit `.env`, production secrets, SQLite DB/backup files, dependency caches, `.superpowers/`, or local source archives.
- Do not merge or deploy without explicit user authorization.
- Production changes require separate backup/readiness/rollback verification.

## 9. Definition of completion for normal code work

Before reporting completion, actually run the relevant target tests plus:

```bash
pnpm architecture:check
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

If a repository `format:check` script is added later, run it as well.

Never report a command as passed unless it actually ran successfully.
