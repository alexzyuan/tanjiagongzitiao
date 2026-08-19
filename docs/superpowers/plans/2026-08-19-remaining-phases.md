# Salary Slip Remaining Phases Implementation Plan

> **For agentic workers:** Execute the tasks in order and keep each phase testable.

**Goal:** Complete the remaining salary-slip hardening and scoped maintainability phases (3–12) without changing the product’s supported notification channel or introducing infrastructure.

**Architecture:** Preserve the existing service/store boundaries. First make delivery, session, settings, evidence, archive, and backup behavior explicit with regression tests; then perform only mechanical frontend cleanup and decomposition while preserving behavior.

**Tech Stack:** TypeScript, Fastify, Vitest, React, Vite, SQLite, pnpm workspaces.

---

### Phase 3: Idempotent delivery retry

- [ ] Add failing API and SQLite tests for retrying only failed recipients, repeated resend idempotency, withdrawn exclusion, and `sent <= total`.
- [ ] Update delivery selection and store success accounting in both memory and SQLite implementations.
- [ ] Run delivery, DB, full test, typecheck, and build gates.

### Phase 4: Session and production constraints

- [ ] Add clock-controlled tests for issued-at validation, eight-hour expiry, cookie max-age, HTTPS production URL, and absolute SQLite path.
- [ ] Implement validation and stable `session_expired` handling without weakening existing cookie flags.
- [ ] Run auth/runtime and full gates.

### Phase 5: Remove false settings

- [ ] Search all references and trace actual behavior for password verification, payroll reminder, employee-only view, and notification mode.
- [ ] Remove only settings with no server-side effect from UI/schema/storage types and update documentation.
- [ ] Run full gates.

### Phase 6: Evidence fingerprints and preview lifecycle

- [ ] Add deterministic salary-slip version fingerprint tests and ensure sent/viewed/confirmed/withdrawn evidence uses it without plaintext salary metadata.
- [ ] Make preview cleanup semantics explicit on preview/read/commit and update docs.
- [ ] Run focused and full gates.

### Phase 7: Archive and backup runtime chain

- [ ] Make worker initialize the configured SQLite store, execute archive once, and close cleanly.
- [ ] Keep scheduling external and document safe SQLite backup/restore verification with key separation.
- [ ] Add worker/runtime tests and run full gates.

### Phase 8: Dead code and unused dependencies

- [ ] Confirm and remove only unused `ImportPanel` code and its exclusive CSS/helpers.
- [ ] Remove unused TanStack packages and update lockfile only if source search confirms no use.
- [ ] Run frontend and full gates.

### Phase 9: App decomposition

- [ ] Move major pages/features into focused files without changing behavior or introducing routing/state libraries.
- [ ] Run web tests/typecheck after each move and full gates at the end.

### Phase 10: CSS decomposition

- [ ] Move CSS by responsibility, preserve cascade/print/responsive rules, and remove duplicate declarations only after checking final selectors.
- [ ] Run frontend and full gates.

### Phase 11: Optional backend decomposition

- [ ] Inspect post-Phase-10 `service.ts`; execute only if a small split has clear benefit and no semantic risk.
- [ ] Otherwise document that not executing is safer.

### Phase 12: Final acceptance

- [ ] Run all gates, the security regression matrix, and credential/database scans without printing secrets.
- [ ] Review status/diff and report completed, skipped, and remaining risks.
