# Salary Business Rules

> Current intent guide for humans and Codex/AI agents. The executable source of truth remains the domain/service code and tests; this file explains the intended semantics so agents do not have to infer them from scattered `if` statements.

## 1. Core vocabulary

Use these terms consistently:

- **salary batch** — one month's uploaded salary set.
- **salary item** — one employee's salary inside a batch.
- **delivery** — a DingTalk work-notification delivery attempt/result.
- **evidence** — append-only proof/event records for notification/view/confirmation/withdrawal behavior.
- **withdraw** — revoke access/state inside this application and record audit/evidence. It does not guarantee remote deletion of a DingTalk notification already received by the employee.
- **resend** — send again after the current business state allows it.
- **confirmation** — employee confirmation recorded by the application.
- **archive** — historical read-only state beyond normal active salary operations.

Do not introduce synonyms such as wage/payroll/compensation for the same code concepts unless required by an external API.

## 2. Salary batch lifecycle

Current domain states:

```text
draft
scheduled
sending
sent
partially_failed
withdrawn
archived
```

Current state-machine transitions are defined in `packages/domain/src/salary.ts` and are authoritative.

Conceptually:

```text
draft
 ├─→ scheduled ─→ sending
 ├──────────────→ sending
 └──────────────→ withdrawn

sending
 ├─→ sent
 └─→ partially_failed

sent / partially_failed / withdrawn
 ├─→ sending      (where resend/retry semantics allow)
 └─→ archived

archived
 └─→ no normal active transition
```

Do not add a new transition only in the UI or service; update the domain state machine and its tests when the lifecycle itself changes.

## 3. Import

The salary import flow is three-stage:

```text
upload
→ preview/match
→ explicit confirmation/persist
```

Rules:

- Upload/preview must not create a persistent salary batch before user confirmation.
- Preview data is time-limited and temporary.
- Summary rows such as 合计/汇总/总计 may be shown for human checking but must never become recipients.
- DingTalk directory identity replaces spreadsheet identity when a user is resolved.
- Personal identity fields are metadata, not salary amount fields.
- Salary display settings are persisted with the created batch as a snapshot; later template changes must not retroactively change an existing salary batch.
- Imported salary fields are encrypted before durable storage.

## 4. Send and delivery

The default and verified salary notification channel is DingTalk work notification using the supported `asyncsend_v2` `link` message. An explicitly configured `interactive_card` channel uses a published DingTalk card template and the supported card-instance create-and-deliver API; it carries only the existing salary-period title and detail URL, disables forwarding, does not configure a Stream callback, and its button opens the same employee detail route.

Rules:

- Single-item send and batch send share the same delivery/audit/evidence semantics.
- Current item delivery status is interpreted from the latest relevant delivery record.
- Concurrent duplicate send of the same item within the API instance is blocked by in-flight protection.
- A delivered item must not be sent again as an accidental duplicate.
- Failed delivery may be retried according to the active service rules.
- A withdrawn item may be edited and then sent again when the service allows it.
- Batch counters must never allow `sent > total`.
- A send operation must not report success if DingTalk delivery failed.

## 5. Withdraw

Withdrawal is an application-level operation.

It means:

- the application's salary access/current delivery state is revoked/changed;
- audit and evidence are recorded;
- view/confirmation interaction state is cleared where the current flow requires a fresh employee interaction after resend.

It does **not** mean:

- the previously delivered DingTalk message was remotely deleted;
- the employee's DingTalk client notification history was erased.

UI copy, logs, docs, and API responses must not claim remote notification deletion unless a supported DingTalk API is later implemented and verified.

## 6. Edit

Salary editing is intentionally constrained.

Current intended normal flow:

```text
sent/delivered
→ withdraw
→ edit
→ resend
```

Rules:

- A salary item is not a general-purpose CRUD record.
- Normal draft salary data is changed through the import/create flow, not arbitrary item edit actions.
- Edit is allowed only when the current delivery/lifecycle policy explicitly allows it.
- An item must not be edited while its send/resend is in flight.
- Archived salary data is immutable to the normal edit flow.
- Edited salary fields must still be persisted through the encrypted store path.
- Edit audit metadata must not contain salary field values or amounts.

## 7. Delete

Deletion is a destructive administrative action and must be server-authoritative.

The UI must use server-provided delete capability when available rather than reconstructing the policy independently.

General intent:

- untouched/eligible draft-like data may be deletable;
- a batch with active/in-flight delivery must not be deleted;
- a batch whose delivery history means deletion would create inconsistent employee notification/history must not be deleted unless the explicit current policy permits it;
- archived historical salary is not treated as ordinary deletable working data;
- destructive deletion must remain auditable according to current service behavior.

Exact conditions are enforced by `SalaryService` and tests. When those conditions change, update tests and this intent guide together.

## 8. Employee read isolation

Employee salary access is a server security boundary.

Rules:

- The server derives the employee identity from the authenticated DingTalk/session identity.
- Employee A must never be able to retrieve employee B's salary by changing client parameters.
- Client/mobile-only display restrictions are UX, not authorization.
- Only salary data inside the employee's allowed visibility window is exposed.
- Hidden fields are removed server-side using `visibleFields` before returning the employee DTO.
- Employee endpoints must not leak admin-only batch data unnecessarily.

## 9. View and confirmation

Rules:

- View state is recorded when the employee actually enters the salary flow that counts as viewed according to current endpoint behavior.
- Confirmation is recorded only when confirmation is enabled and the authenticated employee performs the action.
- Duplicate view/confirm operations should be idempotent from the user's perspective.
- Withdrawal may clear prior view/confirmation state so a later resend represents a new interaction cycle.
- A new resend must not silently preserve stale interaction state when the intended business flow requires reconfirmation.

## 10. Archive

Archive exists to keep historical salary encrypted and available under stricter access while removing it from normal active employee operations.

Rules:

- Employee visibility is currently limited to the recent 12-month window.
- Older batches are archived by the one-shot archive worker under external scheduling.
- Archived salary remains encrypted at rest.
- Archived salary is read-only for normal salary management actions.
- Archive behavior must not require a resident scheduler in the API process.

## 11. Evidence vs delivery vs audit

These concepts are distinct:

### Delivery

Operational result of sending/withdrawing notification-related state for a recipient.

### Evidence

Business proof/events such as notification sent, viewed, confirmed, withdrawn, plus non-sensitive fingerprints/metadata.

### Audit

Who performed an administrative/system action, against what target, with what outcome.

Do not merge these into a single generic event object merely to reduce code files. They serve different questions.

## 12. Sensitive-data rule

Never place salary values or sensitive personal data in:

- logs;
- error messages;
- audit metadata;
- evidence metadata unless explicitly designed as a non-reversible fingerprint;
- Git history;
- test fixtures that represent real employees;
- documentation examples.

## 13. Changing a business rule

Before changing salary behavior:

1. Read this file.
2. Read the relevant entry in `docs/AI_INDEX.md`.
3. Read the current domain/service implementation.
4. Read the existing behavior tests.
5. Add or update a regression/behavior test.
6. Change the single authoritative rule source.
7. Update this file only if the business intent changed, not for internal refactors.
