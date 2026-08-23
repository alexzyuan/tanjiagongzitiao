import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SalarySlipPreview } from "./features/salary/SalarySlipPreview";

describe("employee salary semantics", () => {
  const settings = (confirmationEnabled: boolean, visibleFields: string[] = []) => ({
    netAmountField: "实发金额",
    hideEmptyFields: true,
    confirmationEnabled,
    notice: "",
    greeting: "{name}",
    theme: "default" as const,
    visibleFields,
    fieldGroups: [],
  });

  it("uses all fields for legacy empty visibility and filters non-empty visibility", () => {
    const sample = { 基本工资: 10000, 奖金: 1000, 实发金额: 9000 };
    const { rerender } = render(
      <SalarySlipPreview
        title="工资条"
        settings={settings(false)}
        fields={Object.keys(sample)}
        sample={sample}
      />,
    );
    expect(screen.getByText("基本工资")).toBeInTheDocument();
    expect(screen.getByText("奖金")).toBeInTheDocument();

    rerender(
      <SalarySlipPreview
        title="工资条"
        settings={settings(false, ["奖金", "实发金额"])}
        fields={Object.keys(sample)}
        sample={sample}
      />,
    );
    expect(screen.queryByText("基本工资")).not.toBeInTheDocument();
    expect(screen.getByText("奖金")).toBeInTheDocument();
  });
});
