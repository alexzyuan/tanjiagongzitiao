# Current Architecture

> Current-truth architecture reference for humans and Codex/AI agents. Historical phase notes do not override this file or the code.

## 1. System shape

```text
Browser / DingTalk WebView
        │
        ▼
   apps/web (React)
        │ HTTP
        ▼
   apps/api (Fastify)
     │      │
     │      └──────── packages/dingtalk ─────── DingTalk APIs
     │
     ├─────────────── packages/domain
     │
     └─────────────── packages/db ───────────── SQLite/WAL
                                             ▲
                                             │
                                      apps/worker
                                  one-shot archive job
                                  externally scheduled
```

The project is intentionally a small monorepo/internal application. Do not add extra runtime tiers without a verified need.

## 2. Ownership and dependency direction

### `packages/domain`

Owns:

- stable salary domain types;
- salary batch state machine;
- authorization/domain policy that does not require IO;
- pure helpers.

Must not depend on apps, Fastify, React, SQLite, or DingTalk clients.

### `packages/db`

Owns:

- `SalaryStore` contract;
- SQLite persistence;
- in-memory store used by tests/local flows;
- AES-256-GCM salary-field encryption/decryption;
- schema compatibility/migrations;
- persistence mapping.

May depend on `@salary/domain` and necessary Node/SQLite libraries. Must not own HTTP/UI/DingTalk behavior.

### `packages/dingtalk`

Owns:

- DingTalk authentication transport;
- directory lookup;
- work notification delivery;
- DingTalk mock/client protocol.

Must not depend on application UI, Fastify routes, or database implementation.

### `apps/api`

Owns:

- HTTP boundary and validation;
- session/authentication integration;
- authorization orchestration;
- salary use-case orchestration;
- audit/evidence/report/settings endpoints;
- composition of domain, DB, and DingTalk dependencies.

Important salary files:

- `apps/api/src/modules/salary/service.ts` — admin salary batch orchestration and lifecycle actions.
- `apps/api/src/modules/salary/delivery.ts` — DingTalk send/withdraw/resend and in-flight send protection.
- `apps/api/src/modules/salary/employee.ts` — employee-facing salary reads, view tracking, and confirmation.
- `apps/api/src/modules/salary/import.ts` — XLSX parsing, validation, and directory matching.
- `apps/api/src/modules/salary/routes.ts` — HTTP validation/routing only.

### `apps/web`

Owns presentation and interaction only.

It must not import DB or DingTalk client packages, and should not independently recreate server/domain authorization or lifecycle policy.

### `apps/worker`

Runs archive work as a one-shot process and closes its store before exit. Scheduling remains external (for example cron/systemd timer). It must not become an always-on scheduler service.

## 3. Core data paths

### Salary import

```text
Web ImportWizard
→ API salary import route
→ XLSX parsing / validation
→ DingTalk directory matching
→ temporary preview
→ user confirmation
→ SalaryService
→ SalaryStore
→ encrypted SQLite salary fields
```

Preview data is temporary. Summary rows may be retained for human review but must never become salary recipients.

### Admin salary write/action path

```text
HTTP route
→ authenticated identity
→ authorization access
→ SalaryService
→ SalaryDeliveryService when delivery is involved
→ SalaryStore
→ SQLite + audit/evidence/delivery records
```

### Employee salary read path

```text
DingTalk/session identity
→ employee salary route/service
→ server-side employee isolation
→ SalaryStore
→ decrypt only the requested salary data
→ visibleFields server filtering
→ employee DTO
```

Client-side display restrictions are not an authorization boundary.

### Delivery path

```text
SalaryDeliveryService
→ DingTalk work notification (`asyncsend_v2` link message)
→ delivery record
→ evidence record/fingerprint
→ audit record
```

The currently verified production notification channel is the DingTalk work-notification `link` message. The application does not use DING. Local withdrawal must not be described as remote deletion of an already-delivered DingTalk notification.

### Archive path

```text
external scheduler
→ apps/worker one-shot process
→ SalaryStore archive operation
→ encrypted archived data
→ process exits
```

## 4. Security and correctness invariants

These are hard constraints:

1. Salary fields are encrypted at rest with AES-256-GCM.
2. Logs, errors, and audit metadata must not contain salary amounts, salary field payloads, bank-card/identity data, encryption keys, session signing keys, or DingTalk AppSecret values.
3. Employee salary DTOs are isolated server-side to the current employee identity.
4. `visibleFields` filtering happens on the server before employee salary data leaves the API.
5. Session lifetime is 8 hours; cookies use HttpOnly/SameSite and production HTTPS uses Secure.
6. Archived historical salary data is immutable to normal salary edit flows.
7. Employee access is limited to the configured recent-history window (currently 12 months); older batches are archived.
8. API startup must not decrypt all salary data or build a full in-memory salary cache.
9. Production SQLite uses an absolute path outside release/deployment directories.
10. SQLite remains WAL-based and is the single production application database unless architecture is explicitly re-approved.
11. Worker remains one-shot and externally scheduled.
12. Runtime dependencies stay minimal; Redis, PostgreSQL/MySQL, ORM, MQ, Redux, React Query, new Router, Tailwind, CSS Modules, styled-components, and complex DDD/CQRS/Event-Sourcing layers are not added by default.

## 5. Architecture enforcement

`pnpm architecture:check` is the repository guardrail. It currently checks:

- banned dependencies/infrastructure;
- import direction violations;
- selected file-size warnings;
- cross-file duplicate CSS selectors.

Hard architecture violations fail CI. File-size and duplicate-selector findings are warnings and must not trigger unrelated refactors.

GitHub Quality CI runs on pull requests and pushes to `main` and verifies architecture, tests, typecheck, and build.

## 6. Design rule for future changes

Prefer the smallest change that keeps responsibility obvious.

- Pure lifecycle/domain rule → `packages/domain`.
- Runtime orchestration or DB-dependent rule → API service.
- Persistence/query/encryption → `packages/db`.
- DingTalk protocol/transport → `packages/dingtalk`.
- Rendering/interaction → `apps/web`.

Do not create new layers for hypothetical future needs. If an ordinary feature requires reading or editing many unrelated files, first check whether responsibility has become scattered.
