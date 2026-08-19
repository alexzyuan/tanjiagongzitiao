import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MemorySalaryStore, SqliteSalaryStore } from "@salary/db";
import { archiveExpiredSalarySlips } from "../src/archive.js";
import { runConfiguredArchiveJob } from "../src/worker.js";

describe("salary archive job", () => {
  it("archives batches older than the employee visibility window", () => {
    const store = new MemorySalaryStore(Buffer.alloc(32, 7));
    const old = store.createBatch({ payrollMonth: "2025-07", title: "old", createdById: "admin", items: [{ employeeUserId: "employee-a", employeeName: "员工A", fields: { net: 1 } }] });
    store.setState(old.id, "sending");
    store.setState(old.id, "sent");
    const current = store.createBatch({ payrollMonth: "2026-08", title: "current", createdById: "admin", items: [{ employeeUserId: "employee-a", employeeName: "员工A", fields: { net: 2 } }] });
    store.setState(current.id, "sending");
    store.setState(current.id, "sent");
    const result = archiveExpiredSalarySlips(store, new Date("2026-08-17T00:00:00Z"));
    expect(result.archivedBatchIds).toEqual([old.id]);
    expect(store.getBatch(old.id).state).toBe("archived");
    expect(store.getBatch(current.id).state).toBe("sent");
  });

  it("archives the configured SQLite store and closes it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "salary-worker-"));
    const databasePath = join(directory, "salary-slip.sqlite");
    const encryptionKey = "0707070707070707070707070707070707070707070707070707070707070707";
    try {
      const seed = new SqliteSalaryStore(databasePath, Buffer.from(encryptionKey, "hex"));
      const batch = seed.createBatch({
        payrollMonth: "2025-07",
        title: "old",
        createdById: "admin",
        items: [{ employeeUserId: "employee-a", employeeName: "员工A", fields: { net: 1 } }],
      });
      seed.setState(batch.id, "sending");
      seed.setState(batch.id, "sent");
      seed.close();

      const result = runConfiguredArchiveJob(
        {
          SALARY_DATABASE_PATH: databasePath,
          SALARY_ENCRYPTION_KEY: encryptionKey,
        },
        new Date("2026-08-17T00:00:00Z"),
      );
      expect(result.archivedBatchIds).toEqual([batch.id]);

      const reopened = new SqliteSalaryStore(databasePath, Buffer.from(encryptionKey, "hex"));
      expect(reopened.getBatch(batch.id).state).toBe("archived");
      reopened.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
