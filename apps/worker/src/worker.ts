import { isAbsolute } from "node:path";
import { SqliteSalaryStore, type SalaryStore } from "@salary/db";
import { archiveExpiredSalarySlips } from "./archive.js";

export function runArchiveJob(store: SalaryStore, now = new Date()) {
  return archiveExpiredSalarySlips(store, now);
}

export function runConfiguredArchiveJob(
  env: {
    SALARY_DATABASE_PATH?: string;
    SALARY_ENCRYPTION_KEY?: string;
  } = process.env,
  now = new Date(),
) {
  const databasePath = env.SALARY_DATABASE_PATH;
  if (
    !databasePath ||
    databasePath === ":memory:" ||
    !isAbsolute(databasePath)
  )
    throw new Error("archive_worker_requires_absolute_database_path");
  const encryptionKey = env.SALARY_ENCRYPTION_KEY;
  if (!encryptionKey || !/^[0-9a-fA-F]{64}$/.test(encryptionKey))
    throw new Error("archive_worker_requires_encryption_key");
  const store = new SqliteSalaryStore(
    databasePath,
    Buffer.from(encryptionKey, "hex"),
  );
  try {
    return runArchiveJob(store, now);
  } finally {
    store.close();
  }
}

if (
  process.argv[1]?.endsWith("worker.ts") ||
  process.argv[1]?.endsWith("worker.js")
) {
  try {
    const result = runConfiguredArchiveJob();
    console.info("salary_archive_worker_completed", result);
  } catch (error) {
    console.error("salary_archive_worker_failed", error);
    process.exitCode = 1;
  }
}
