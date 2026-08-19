import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: apiMock };
});
import { formatSalaryValue, SalaryManagement } from "./App";
import { SalarySlipPreview } from "./pages/EmployeeSalary";

const batch = {
  id: "batch-1", payrollMonth: "2026-08", title: "2026年08月工资条",
  state: "draft", total: 1, sent: 0, viewed: 0, confirmed: 0,
  assignedAdminIds: [], createdById: "dev-admin", displaySettings: {
    netAmountField: "实发金额", hideEmptyFields: true,
    confirmationEnabled: false, notice: "", greeting: "", theme: "default", visibleFields: [], fieldGroups: []
  }
};

afterEach(() => vi.clearAllMocks());

describe("salary management", () => {
  it("does not open the salary detail drawer when the management page first loads", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({ ...batch, items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText("0/1");
    await waitFor(() => expect(document.querySelector(".drawer-backdrop")).not.toBeInTheDocument());
  });

  it("rounds displayed salary numbers to two decimal places", () => {
    expect(formatSalaryValue(23.9333333333333)).toBe("23.93");
    expect(formatSalaryValue(1.005)).toBe("1.01");
  });

  it("labels the per-employee action as a work notification send without DING", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({ ...batch, items: [{ id: "item-1", employeeName: "员工A", employeeUserId: "employee-a", fields: { 实发金额: 10000 } }] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByRole("button", { name: "单独发送" });
    expect(screen.queryByText(/DING/)).not.toBeInTheDocument();
  });
});

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
      <SalarySlipPreview title="工资条" settings={settings(false)} fields={Object.keys(sample)} sample={sample} />,
    );
    expect(screen.getByText("基本工资")).toBeInTheDocument();
    expect(screen.getByText("奖金")).toBeInTheDocument();

    rerender(
      <SalarySlipPreview title="工资条" settings={settings(false, ["奖金", "实发金额"])} fields={Object.keys(sample)} sample={sample} />,
    );
    expect(screen.queryByText("基本工资")).not.toBeInTheDocument();
    expect(screen.getByText("奖金")).toBeInTheDocument();
  });
});
