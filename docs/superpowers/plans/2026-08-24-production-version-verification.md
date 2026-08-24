# Production version verification plan

Goal: make the deployed release identity externally verifiable without coupling the API to systemd working-directory details.

Scope:
- add a tested release-version JSON formatter;
- write `apps/web/dist/version.json` into each release package using the exact Git commit;
- require the deployed public `/version.json` to match that commit before deployment succeeds;
- update `HANDOFF.md` to the current main baseline and document the verification endpoint;
- no salary business-rule, DB schema, encryption, DingTalk, or runtime dependency changes;
- no production deployment in this change.

Verification:
- RED: release-version contract test fails while formatter is missing;
- GREEN: contract test passes after minimal formatter implementation;
- PR Quality must pass architecture, test, typecheck, build;
- `git diff --check` only if actually run in a full checkout.
