import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SalaryImportPreview, SalarySlipDisplaySettings } from "../../../api";
import { ImportConfirmStep } from "./ImportConfirmStep";
import { ImportUploadStep } from "./ImportUploadStep";

const settings: SalarySlipDisplaySettings = {
  netAmountField: "实发金额",
  hideEmptyFields: true,
  confirmationEnabled: true,
  notice: "",
  greeting: "{name}",
  theme: "default",
  visibleFields: ["实发金额"],
  fieldGroups: [],
};

const preview: SalaryImportPreview = {
  previewId: "preview-1",
  expiresAt: "2026-08-01T00:00:00.000Z",
  strategy: "name",
  sourceRows: [
    { row: 2, kind: "employee", source: { 姓名: "员工A", 实发金额: 9000 } },
  ],
  rows: [
    {
      row: 2,
      status: "matched",
      source: { 姓名: "员工A", 实发金额: 9000 },
      candidates: [],
    },
  ],
  ignoredSummaryRows: 0,
  matched: 1,
  unmatched: 0,
  ambiguous: 0,
};

describe("salary import wizard steps", () => {
  it("keeps upload step to one workbook entry", () => {
    const { container } = render(
      <ImportUploadStep
        busy={false}
        error={undefined}
        onFileChange={vi.fn()}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(1);
    expect(screen.queryByText("发薪月份")).not.toBeInTheDocument();
    expect(screen.queryByText("工资条标题")).not.toBeInTheDocument();
    expect(screen.queryByText("匹配企业人员")).not.toBeInTheDocument();
  });

  it("selects the month in settings and keeps the generated title read-only", () => {
    const onMonthChange = vi.fn();
    render(
      <ImportConfirmStep
        month="2026-08"
        title="2026年08月工资条"
        preview={preview}
        settings={settings}
        salaryFields={["实发金额"]}
        templates={[]}
        busy={false}
        error={undefined}
        settingsMessage={undefined}
        setSettings={vi.fn()}
        onMonthChange={onMonthChange}
        onSaveTemplate={vi.fn()}
        onBack={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    const monthInput = screen.getByDisplayValue("2026-08");
    expect(monthInput).toHaveAttribute("type", "month");
    expect(screen.getByDisplayValue("2026年08月工资条")).toHaveAttribute(
      "readonly",
    );
    fireEvent.change(monthInput, { target: { value: "2026-09" } });
    expect(onMonthChange).toHaveBeenCalledWith("2026-09");
  });
});
