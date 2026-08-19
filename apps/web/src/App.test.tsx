import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock, ensureSessionMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  ensureSessionMock: vi.fn(),
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: apiMock, ensureSession: ensureSessionMock };
});
import { App } from "./App";
import { SalaryManagement } from "./pages/SalaryManagement";
import { formatSalaryValue } from "./format";
import { SalarySlipPreview } from "./features/salary/SalarySlipPreview";

const batch = {
  id: "batch-1", payrollMonth: "2026-08", title: "2026年08月工资条",
  state: "draft", total: 1, sent: 0, viewed: 0, confirmed: 0,
  assignedAdminIds: [], createdById: "dev-admin", displaySettings: {
    netAmountField: "实发金额", hideEmptyFields: true,
    confirmationEnabled: false, notice: "", greeting: "", theme: "default", visibleFields: [], fieldGroups: []
  }
};

afterEach(() => vi.clearAllMocks());

const identity = { userId: "admin-1", name: "管理员", corpId: "corp-1" };
const report = {
  totals: {
    batches: 1,
    recipients: 2,
    sent: 1,
    viewed: 1,
    confirmed: 1,
    failedDeliveries: 0,
    evidenceEvents: 1,
    salaryTotals: { gross: 12000, net: 10000, tax: 1000, socialInsurance: 1000 },
  },
  batches: [{ ...batch, deliveryFailures: 0, evidenceEvents: 1 }],
};

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

  it("renders failed and withdrawn employee delivery states", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([{ ...batch, state: "partially_failed", total: 2 }]);
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({
        ...batch,
        state: "partially_failed",
        total: 2,
        items: [
          { id: "item-failed", employeeName: "员工失败", employeeUserId: "employee-failed", fields: { 实发金额: 10000 }, deliveryStatus: "failed" },
          { id: "item-withdrawn", employeeName: "员工撤回", employeeUserId: "employee-withdrawn", fields: { 实发金额: 9000 }, deliveryStatus: "withdrawn" },
        ],
      });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    expect(await screen.findByText("员工失败")).toBeInTheDocument();
    expect(document.querySelector(".status-failed")).toHaveTextContent("发送失败");
    expect(document.querySelector(".status-withdrawn")).toHaveTextContent("已撤回");
  });

  it("loads batch summaries and the active batch detail, then opens the import wizard", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({ ...batch, items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText("0/1");
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/v1/salary-batches/batch-1"));
    await user.click(screen.getByRole("button", { name: "上传工资表" }));
    expect(await screen.findByRole("heading", { name: "上传工资表" })).toBeInTheDocument();
  });
});

describe("admin module smoke tests", () => {
  it("loads evidence and renders its empty state", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/payment-evidence") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "发薪存证" }));
    expect(await screen.findByText("暂无存证事件")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/v1/payment-evidence");
  });

  it("loads the report and renders salary totals", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/reports/summary") return Promise.resolve(report);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "报表中心" }));
    expect(await screen.findByText("¥ 10,000.00")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/v1/reports/summary");
  });

  it("filters the report by payroll month", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/reports/summary") return Promise.resolve(report);
      if (path === "/v1/reports/summary?payrollMonth=2026-08") return Promise.resolve(report);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "报表中心" }));
    await user.selectOptions(await screen.findByRole("combobox", { name: "发薪月份" }), "2026-08");
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/v1/reports/summary?payrollMonth=2026-08"));
  });

  it("loads permission data and opens the directory picker", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({ ...batch, items: [] });
      if (path === "/v1/sub-admins") return Promise.resolve([]);
      if (path === "/v1/directory/users") return Promise.resolve([]);
      if (path === "/v1/directory/users?query=") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "权限管理" }));
    await user.click(await screen.findByRole("button", { name: "从企业通讯录选择人员" }));
    expect(await screen.findByRole("heading", { name: "请选择人员" })).toBeInTheDocument();
  });

  it("loads settings and renders the actual fixed configuration", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/settings") return Promise.resolve({ employeeVisibilityMonths: 12 });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "系统设置" }));
    expect(await screen.findByText("员工可查看范围")).toBeInTheDocument();
    expect(screen.getByText("12 个月")).toBeInTheDocument();
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
