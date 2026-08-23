import { describe, expect, it } from "vitest";
import {
  assertTransition,
  canDeleteSalaryBatch,
  canEditSalaryItem,
  canTransition,
  defaultSalarySlipDisplaySettings,
} from "../src/salary.js";

describe("salary batch state machine", () => {
  it("allows a draft to be scheduled or sent", () => {
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("draft", "sending")).toBe(true);
    expect(canTransition("draft", "sent")).toBe(false);
  });

  it("fails loudly for invalid transitions", () => {
    expect(() => assertTransition("archived", "sent")).toThrow(
      "invalid_salary_batch_transition",
    );
  });
});

describe("salary action policy", () => {
  const delivery = (
    employeeUserId: string,
    status: "delivered" | "failed" | "withdrawn",
  ) => ({ employeeUserId, status });

  it("allows deleting an untouched draft", () => {
    expect(
      canDeleteSalaryBatch({ state: "draft", sent: 0, deliveries: [] }),
    ).toBe(true);
  });

  it("allows deleting a batch after only initial delivery failures", () => {
    expect(
      canDeleteSalaryBatch({
        state: "partially_failed",
        sent: 0,
        deliveries: [delivery("employee-a", "failed")],
      }),
    ).toBe(true);
  });

  it("allows deleting after every previously delivered salary is withdrawn", () => {
    expect(
      canDeleteSalaryBatch({
        state: "withdrawn",
        sent: 2,
        deliveries: [
          delivery("employee-a", "delivered"),
          delivery("employee-a", "withdrawn"),
          delivery("employee-b", "delivered"),
          delivery("employee-b", "withdrawn"),
        ],
      }),
    ).toBe(true);
  });

  it("rejects deleting while any previously delivered salary remains current", () => {
    expect(
      canDeleteSalaryBatch({
        state: "partially_failed",
        sent: 2,
        deliveries: [
          delivery("employee-a", "delivered"),
          delivery("employee-a", "withdrawn"),
          delivery("employee-b", "delivered"),
        ],
      }),
    ).toBe(false);
  });

  it("never allows deleting an archived batch", () => {
    expect(
      canDeleteSalaryBatch({
        state: "archived",
        sent: 1,
        deliveries: [
          delivery("employee-a", "delivered"),
          delivery("employee-a", "withdrawn"),
        ],
      }),
    ).toBe(false);
  });

  it("allows editing only a withdrawn item outside an archived batch", () => {
    expect(
      canEditSalaryItem({
        batchState: "withdrawn",
        latestDeliveryStatus: "withdrawn",
      }),
    ).toBe(true);
    expect(
      canEditSalaryItem({
        batchState: "archived",
        latestDeliveryStatus: "withdrawn",
      }),
    ).toBe(false);
    expect(
      canEditSalaryItem({
        batchState: "draft",
        latestDeliveryStatus: undefined,
      }),
    ).toBe(false);
  });
});

describe("salary slip display settings", () => {
  it("defines a reusable visible-field template shape", () => {
    expect(defaultSalarySlipDisplaySettings.visibleFields).toEqual([]);
    expect(defaultSalarySlipDisplaySettings.fieldGroups).toEqual([]);
  });
});
