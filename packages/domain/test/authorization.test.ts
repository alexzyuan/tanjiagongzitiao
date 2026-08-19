import { describe, expect, it } from "vitest";
import { canManageBatch, canReadArchive, canReadEmployeeItem } from "../src/authorization.js";

describe("salary authorization", () => {
  it("limits a sub-admin to explicitly assigned batches", () => {
    const access = { kind: "sub_admin" as const, userId: "u-2", batchIds: ["batch-a"] };
    expect(canManageBatch(access, "batch-a")).toBe(true);
    expect(canManageBatch(access, "batch-b")).toBe(false);
  });

  it("keeps archives main-admin only and employee reads self-only", () => {
    const employee = { kind: "employee" as const, userId: "employee-a" };
    expect(canReadArchive(employee)).toBe(false);
    expect(canReadEmployeeItem(employee, "employee-a")).toBe(true);
    expect(canReadEmployeeItem(employee, "employee-b")).toBe(false);
  });
});
