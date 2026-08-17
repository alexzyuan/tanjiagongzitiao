import type { MemorySalaryStore } from "@salary/db";
import { archiveExpiredSalarySlips } from "./archive.js";

export function runArchiveJob(store: MemorySalaryStore, now = new Date()) {
  return archiveExpiredSalarySlips(store, now);
}

if (process.argv[1]?.endsWith("worker.ts") || process.argv[1]?.endsWith("worker.js")) {
  throw new Error("archive_worker_requires_persistent_store_adapter");
}
