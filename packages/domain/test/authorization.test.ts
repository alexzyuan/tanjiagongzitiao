import { describe, expect, it } from "vitest";
import {
  canManageBatch,
  canManageSettings,
  canReadArchive,
  canReadEmployeeItem,
  isGlobalSalaryAdmin,
} from "../src/authorization.js";

describe("salary authorization", () => {
  it("gives sub-admins the same global salary permissions as the main admin", () => {
    const access = {
      kind: "sub_admin" as const,
      userId: "u-2",
      batchIds: ["batch-a"],
    };
    expect(isGlobalSalaryAdmin(access)).toBe(true);
    expect(canManageBatch(access, "batch-a")).toBe(true);
    expect(canManageBatch(access, "batch-b")).toBe(true);
    expect(canReadArchive(access)).toBe(true);
    expect(canManageSettings(access)).toBe(true);
    expect(canReadEmployeeItem(access, "employee-a")).toBe(true);
  });

  it("keeps batch-admin scopes and employee reads self-only", () => {
    const batchAdmin = {
      kind: "batch_admin" as const,
      userId: "u-3",
      batchIds: ["batch-a"],
    };
    expect(canManageBatch(batchAdmin, "batch-a")).toBe(true);
    expect(canManageBatch(batchAdmin, "batch-b")).toBe(false);
    expect(canReadArchive(batchAdmin)).toBe(false);

    const employee = { kind: "employee" as const, userId: "employee-a" };
    expect(canReadArchive(employee)).toBe(false);
    expect(canReadEmployeeItem(employee, "employee-a")).toBe(true);
    expect(canReadEmployeeItem(employee, "employee-b")).toBe(false);
  });
});
