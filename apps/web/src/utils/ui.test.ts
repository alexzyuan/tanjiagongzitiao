import { describe, expect, it } from "vitest";
import { formatSalarySlipTitle, parseMonthFromFilename } from "./ui";

describe("salary import month helpers", () => {
  it.each([
    ["工资表-2026-08.xlsx", "2026-08"],
    ["2026_8工资表.xlsx", "2026-08"],
    ["2026年08月工资表.xlsx", "2026-08"],
    ["工资表202608.xlsx", "2026-08"],
  ])("infers %s as %s", (filename, expected) => {
    expect(parseMonthFromFilename(filename, "2025-01")).toBe(expected);
  });

  it("uses the fallback month when a filename has no unambiguous month", () => {
    expect(parseMonthFromFilename("工资表-最终版.xlsx", "2025-01")).toBe(
      "2025-01",
    );
  });

  it("formats the title from a selected month", () => {
    expect(formatSalarySlipTitle("2026-08")).toBe("2026年08月工资条");
  });
});
