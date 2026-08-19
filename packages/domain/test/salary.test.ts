import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, defaultSalarySlipDisplaySettings } from "../src/salary.js";

describe("salary batch state machine", () => {
  it("allows a draft to be scheduled or sent", () => {
    expect(canTransition("draft", "scheduled")).toBe(true);
    expect(canTransition("draft", "sending")).toBe(true);
    expect(canTransition("draft", "sent")).toBe(false);
  });

  it("fails loudly for invalid transitions", () => {
    expect(() => assertTransition("archived", "sent")).toThrow("invalid_salary_batch_transition");
  });
});

describe("salary slip display settings", () => {
  it("defines a reusable visible-field template shape", () => {
    expect(defaultSalarySlipDisplaySettings.visibleFields).toEqual([]);
    expect(defaultSalarySlipDisplaySettings.fieldGroups).toEqual([]);
  });
});
