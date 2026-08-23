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

- [ ] Add a small semantic token set for primary/text/border/surface/success/warning/danger/shadow values.
- [ ] Preserve existing legacy variables as aliases so feature CSS does not require a broad rewrite.
- [ ] Replace key status/notice/shared component literals with semantic tokens.
- [ ] Put CSS imports in the readable order: base → shared components → feature styles.
- [ ] Preserve current rendered values.

## Task 2 — Remove fragile CSS coupling

Files:
- `apps/web/src/styles/components.css`
- `apps/web/src/styles/salary.css`
- `apps/web/src/features/salary/SalaryEmployeeTable.tsx`

- [ ] Scope shared table rules under `.table-scroll` instead of global `table/th/td/tbody tr` selectors.
- [ ] Keep salary employee tables covered because they already live inside `.table-scroll`.
- [ ] Remove the duplicate same-file `.status-withdrawn` definition by making archived and withdrawn states explicit.
- [ ] Replace `.employee-toolbar > .button:nth-last-child(2)` with an explicit semantic class on the scheduled-send button.
- [ ] Preserve mobile behavior.

## Task 3 — Improve architecture size guardrails

Files:
- `scripts/architecture-rules.mjs`
- `scripts/architecture-rules.test.mjs`

- [ ] Add a regression test proving large `sqlite-store.ts`/`memory-store.ts` files receive DB store size warnings.
- [ ] Expand the existing DB size warning from exactly `store.ts` to `*store.ts` under `packages/db`.
- [ ] Keep warnings non-blocking.
- [ ] Do not add new parser/dependency infrastructure.

## Task 4 — Evaluate a Prettier quality gate

Files if viable:
- `package.json`
- `.github/workflows/quality.yml`

- [ ] Add `format:check` using the already-installed Prettier and run it in PR CI.
- [ ] If the existing repository baseline is not formatted, do not create a huge format-only diff in this phase. Revert/defer the gate and record the reason.
- [ ] Add no formatting dependency.

## Task 5 — Documentation and final verification

- [ ] Update `docs/AI_INDEX.md` CSS/quality sections with semantic-token/scoped-selector guidance.
- [ ] Update `HANDOFF.md` with Phase D state.
- [ ] Run final GitHub Quality on the final PR head.
- [ ] Confirm no runtime dependency, business, DB, API, DingTalk, or deployment changes.
- [ ] `git diff --check` only if a full checkout is available; do not claim it otherwise.
- [ ] Merge only after final Quality is green; do not deploy.
