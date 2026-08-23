# Codex-First Maintainability Design

> Status: approved for Phase A execution on 2026-08-23.

## Goal

Keep the salary application lightweight and production-safe while making the repository faster and more reliable for Codex/AI agents to understand, modify, test, and hand off over time.

## Principles

1. **One rule, one source.** Important business rules have one authoritative implementation. The web UI does not independently reconstruct server/domain lifecycle or authorization rules.
2. **One concept, one obvious entry point.** Major business concepts have clearly named primary files/modules.
3. **Small enough, not fragmented.** Split oversized files only by real responsibility; do not create many tiny wrappers/hooks/components just to reduce line counts.
4. **Explicit over magical.** Prefer direct imports, functions, props, and typed interfaces over global events, hidden registries, reflection, or implicit conventions.
5. **Tests describe behavior.** Test names are executable business documentation, and bug fixes add regression tests when practical.
6. **Stable vocabulary.** Preserve established terms such as salary batch, salary item, delivery, evidence, withdraw, resend, confirmation, and archive.
7. **Current truth over historical noise.** Current architecture/business/operations facts are kept separate from historical task logs.
8. **Locality of change.** Ordinary features should normally require reading/editing only a small set of directly related files.
9. **No abstraction without repeated pressure.** No new layer/framework/runtime dependency for hypothetical needs.
10. **Verification is part of completion.** Architecture checks, tests, typecheck, build, formatting/diff checks are part of done.

## Documentation architecture

- `AGENTS.md`: permanent agent execution rules and hard project constraints.
- `docs/ARCHITECTURE.md`: current system structure, ownership, data paths, invariants.
- `docs/BUSINESS_RULES.md`: concise human-readable salary lifecycle and action semantics; code/tests remain executable truth.
- `docs/AI_INDEX.md`: change map telling agents which files to read first for common tasks.
- `HANDOFF.md`: current branch/main/production/work status only; rewrite rather than append historical narrative.
- `docs/history/`: historical phases, experiments, and superseded implementation notes.
- `CODEX_TASKS.md`: legacy task log/backlog, not a mandatory default context file.

## Scope of Phase A

Phase A changes documentation only. It must not change application behavior, database schema, CSS, runtime dependencies, deployment automation, or production configuration.

Phase A will:

1. Add this design document.
2. Add a concise implementation plan.
3. Update `AGENTS.md` with the Codex-First rules and point default agent reading to the new current-truth docs.
4. Add `docs/ARCHITECTURE.md`.
5. Add `docs/BUSINESS_RULES.md`.
6. Add `docs/AI_INDEX.md`.
7. Rewrite `HANDOFF.md` as a current-state handoff instead of a historical narrative.
8. Add `docs/history/README.md` to define the history boundary.

`CODEX_TASKS.md` is intentionally not destructively rewritten in Phase A because it contains a large historical task record. Instead, the new permanent docs will mark it as legacy/non-default context. A later documentation-only task may archive/split it if desired.

## Non-goals

- No salary policy refactor.
- No frontend component split.
- No DB store split.
- No CSS token changes.
- No API type changes.
- No CI changes.
- No dependency changes.
- No merge or deploy.

## Success criteria

A fresh Codex thread should be able to read `AGENTS.md`, `docs/ARCHITECTURE.md`, and `docs/AI_INDEX.md` and quickly answer:

- what runs where;
- what each package/app owns;
- where salary send/import/employee-access logic lives;
- which constraints are hard invariants;
- which files to inspect before a common change;
- which historical documents are optional rather than default context.
