# Salary worker

The archive job is exposed as `runArchiveJob` and is covered by a deterministic test. The API demo uses an in-memory store, so starting this package directly fails fast until a persistent store adapter is configured. Production deployment should wire the same job to the Prisma store and a scheduled queue; it must not run against a process-local memory store.
