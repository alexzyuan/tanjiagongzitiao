import { describe, expect, it } from "vitest";
import { MemorySalaryStore } from "@salary/db";
import { archiveExpiredSalarySlips } from "../src/archive.js";

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
});
