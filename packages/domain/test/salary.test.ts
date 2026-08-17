import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "../src/salary.js";

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
