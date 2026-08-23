# Codex-First Phase D Implementation Plan

> Goal: improve CSS predictability and cheap engineering guardrails for Codex/AI-agent maintenance without redesigning the UI or adding runtime dependencies.

## Constraints

- No product/interaction redesign.
- No salary business-rule changes.
- No API/DB/DingTalk/deployment changes.
- No new runtime dependencies, CSS framework, CSS Modules, Tailwind, or CSS-in-JS.
- Preserve current visual values unless a change is explicitly needed to remove ambiguity.
- Prefer semantic names and scoped selectors over DOM-position/cascade assumptions.
- Do not create a repository-wide formatting diff merely to enable a new gate.

## Task 1 — Semantic CSS foundation

Files:
- `apps/web/src/styles/base.css`
- `apps/web/src/styles/components.css`
- `apps/web/src/styles/salary.css`
- `apps/web/src/styles.css`

- [x] Add a small semantic token set for primary/text/border/surface/success/warning/danger/shadow values.
- [x] Preserve existing legacy variables as aliases so feature CSS does not require a broad rewrite.
- [x] Replace key status/notice/shared component literals with semantic tokens.
- [x] Put CSS imports in the readable order: base → shared components → feature styles.
- [x] Preserve current rendered values; final diff review corrected token mappings that were not exactly value-equivalent.

## Task 2 — Remove fragile CSS coupling

Files:
- `apps/web/src/styles/components.css`
- `apps/web/src/styles/salary.css`
- `apps/web/src/features/salary/SalaryEmployeeTable.tsx`

- [x] Scope shared table rules under `.table-scroll` instead of global `table/th/td/tbody tr` selectors.
- [x] Keep salary employee tables covered because they already live inside `.table-scroll`.
- [x] Remove the duplicate same-file `.status-withdrawn` definition by making archived and withdrawn states explicit.
- [x] Replace `.employee-toolbar > .button:nth-last-child(2)` with an explicit semantic class on the scheduled-send button.
- [x] Preserve mobile behavior.

## Task 3 — Improve architecture size guardrails

Files:
- `scripts/architecture-rules.mjs`
- `scripts/architecture-rules.test.mjs`
- root `package.json`

- [x] Add a regression test proving large `sqlite-store.ts`/`memory-store.ts` files receive DB store size warnings.
- [x] Expand the existing DB size warning from exactly `store.ts` to `*store.ts` under `packages/db`.
- [x] Keep warnings non-blocking.
- [x] Do not add new parser/dependency infrastructure.
- [x] Wire `scripts/architecture-rules.test.mjs` into root `pnpm test`; the suite previously existed but was not executed by the root CI test command.
- [x] Verify RED → GREEN: Quality #71 failed only on the new DB-store warning regression; after the rule fix, Quality #72 passed.

## Task 4 — Evaluate a Prettier quality gate

Files evaluated:
- `package.json`
- `.github/workflows/quality.yml`

- [x] Trial `format:check` using the already-installed Prettier in PR CI.
- [x] Observe the existing baseline rather than assuming it is formatted.
- [x] Revert/defer the gate after Quality #74 reported 82 existing files outside the Prettier baseline.
- [x] Avoid a repository-wide format-only diff and add no formatting dependency.

Decision: Prettier remains installed but is not a CI hard gate. If repository formatting is standardized later, do it as a dedicated migration.

## Task 5 — Documentation and final verification

- [x] Update `docs/AI_INDEX.md` CSS/quality sections with semantic-token/scoped-selector guidance.
- [x] Update `HANDOFF.md` with Phase D state.
- [ ] Run final GitHub Quality on the final documentation-synchronized PR head.
- [x] Confirm by PR diff scope that there are no runtime dependency, business, DB schema/API, DingTalk, or deployment changes.
- [x] `git diff --check` was not independently available in a full local checkout and is not claimed as passed.
- [ ] Merge only after final Quality is green; do not deploy.

## Verification evidence before final documentation sync

- Quality #69: first CSS maintenance batch passed install / architecture / test / typecheck / build.
- Quality #71: expected RED after architecture regression suite was wired into `pnpm test`.
- Quality #72: GREEN after expanding DB store warnings to `*store.ts`.
- Quality #74: expected failure of the trial Prettier gate; 82 baseline files required formatting, so the gate was reverted.
- Quality #80 on code head `ee9804dde5da746d01aa56d26fd2a57522683c0f`: install / architecture / test / typecheck / build all passed.

The final documentation-synchronized head still requires a fresh successful Quality run before merge.
