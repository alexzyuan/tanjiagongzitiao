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
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({ ...batch, items: [{ id: "item-1", employeeName: "员工A", employeeUserId: "employee-a", fields: { 实发金额: 10000 } }] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "前往发送" }));
    await screen.findByRole("button", { name: "单独发送" });
    expect(screen.queryByText(/DING/)).not.toBeInTheDocument();
  });

  it("renders failed and withdrawn employee delivery states", async () => {
    const user = userEvent.setup();
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
    await user.click(await screen.findByRole("button", { name: "前往发送" }));
    expect(await screen.findByText("员工失败")).toBeInTheDocument();
    expect(document.querySelector(".status-failed")).toHaveTextContent("发送失败");
    expect(document.querySelector(".status-withdrawn")).toHaveTextContent("已撤回");
  });

  it("loads only summaries until a batch is opened, then opens the import wizard", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({ ...batch, items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText("0/1");
    expect(apiMock).not.toHaveBeenCalledWith("/v1/salary-batches/batch-1");
    await user.click(screen.getByRole("button", { name: "前往发送" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith("/v1/salary-batches/batch-1"));
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.click(screen.getByRole("button", { name: "上传工资表" }));
    expect(await screen.findByRole("heading", { name: "上传工资表" })).toBeInTheDocument();
  });

  it("shows monthly actions from delivery progress and never exposes batch settings", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          { ...batch, id: "draft-batch", title: "未发送工资条", total: 2 },
          { ...batch, id: "partial-batch", title: "部分发送工资条", total: 2, sent: 1, state: "partially_failed" },
          { ...batch, id: "sent-batch", title: "已发送工资条", sent: 1, total: 1, state: "sent" },
        ]);
      if (path === "/v1/salary-batches/sent-batch")
        return Promise.resolve({ ...batch, id: "sent-batch", title: "已发送工资条", sent: 1, total: 1, state: "sent", items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    expect(await screen.findByText("未发送工资条")).toBeInTheDocument();
    const sendButtons = screen.getAllByRole("button", { name: "前往发送" });
    expect(sendButtons[0]).toBeEnabled();
    expect(sendButtons).toHaveLength(2);
    expect(screen.getByRole("button", { name: "查看发送" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "设置" })).not.toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "删除" });
    expect(deleteButtons[0]).toBeEnabled();
    expect(deleteButtons[0]).not.toHaveClass("muted");
    expect(deleteButtons[1]).toBeDisabled();
    expect(deleteButtons[1]).toHaveClass("muted");
    expect(deleteButtons[2]).toBeDisabled();
    expect(deleteButtons[1]).toHaveAttribute(
      "title",
      "需撤回所有工资条后，才能删除",
    );
    const viewButtons = screen.getAllByRole("button", { name: "查看发送" });
    await user.click(viewButtons[0]!);
    expect(await screen.findByRole("columnheader", { name: "姓名" })).toBeInTheDocument();
  });

  it("deletes an untouched draft from the monthly card", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/v1/salary-batches" && !options?.method)
        return Promise.resolve([{ ...batch, total: 2 }]);
      if (path === "/v1/salary-batches/batch-1" && options?.method === "DELETE")
        return Promise.resolve({ deleted: true, batchId: batch.id });
      if (path === "/v1/salary-batches/batch-1" && !options?.method)
        return Promise.resolve({ ...batch, total: 2, items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "删除" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/v1/salary-batches/batch-1",
      expect.objectContaining({ method: "DELETE" }),
    ));
    expect(confirm).toHaveBeenCalled();
  });

  it("enables deleting a monthly card after every salary item is withdrawn", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          {
            ...batch,
            state: "withdrawn",
            sent: 2,
            total: 2,
            title: "全部撤回工资条",
          },
        ]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    const deleteButton = await screen.findByRole("button", { name: "删除" });
    expect(deleteButton).toBeEnabled();
    expect(deleteButton).not.toHaveAttribute(
      "title",
      "需撤回所有工资条后，才能删除",
    );
  });

  it("enables editing only after withdrawal and saves revised salary fields", async () => {
    const user = userEvent.setup();
    const delivered = { id: "item-1", employeeName: "员工A", employeeUserId: "employee-a", fields: { 实发金额: 10000 }, deliveryStatus: "delivered" };
    const withdrawn = { ...delivered, fields: { 实发金额: 10100 }, deliveryStatus: "withdrawn" as const };
    let withdrawnState = false;
    apiMock.mockImplementation((path: string, options?: { method?: string; body?: string }) => {
      if (path === "/v1/salary-batches") return Promise.resolve([{ ...batch, sent: 1, total: 1, state: "sent" }]);
      if (path === "/v1/salary-batches/batch-1/items/item-1" && options?.method === "PATCH") return Promise.resolve({ ...batch, sent: 1, total: 1, state: "sent", items: [withdrawn] });
      if (path === "/v1/salary-batches/batch-1/items/item-1/withdraw") {
        withdrawnState = true;
        return Promise.resolve({ ...batch, sent: 1, total: 1, state: "sent", items: [withdrawn] });
      }
      if (path === "/v1/salary-batches/batch-1") return Promise.resolve({ ...batch, sent: 1, total: 1, state: "sent", items: [withdrawnState ? withdrawn : delivered] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "查看发送" }));
    expect(await screen.findByRole("button", { name: "编辑" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "撤回" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled());
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const amount = await screen.findByLabelText("实发金额");
    await user.clear(amount);
    await user.type(amount, "10100");
    await user.click(screen.getByRole("button", { name: "保存并关闭" }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
      "/v1/salary-batches/batch-1/items/item-1",
      expect.objectContaining({ method: "PATCH" }),
    ));
  });
});

describe("admin module smoke tests", () => {
  it("loads evidence and renders its empty state", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/payment-evidence/employees?employmentStatus=active") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "发薪存证" }));
    expect(await screen.findByText("暂无发薪存证")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/v1/payment-evidence/employees?employmentStatus=active");
  });

  it("renders a non-empty evidence record", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/payment-evidence/employees?employmentStatus=active") return Promise.resolve([{
        employeeUserId: "employee-a",
        employeeName: "员工A",
        employeeNo: "A001",
        position: "会计",
        employmentStatus: "active",
        evidenceCount: 1,
        latestEvidenceAt: "2026-08-01T08:00:00.000Z",
      }]);
      if (path === "/v1/payment-evidence/employees/employee-a") return Promise.resolve({
        employee: {
          employeeUserId: "employee-a",
          employeeName: "员工A",
          employeeNo: "A001",
          position: "会计",
          employmentStatus: "active",
          evidenceCount: 1,
          latestEvidenceAt: "2026-08-01T08:00:00.000Z",
        },
        availableFields: ["实发金额"],
        rows: [{
          batchId: "batch-2026-08",
          itemId: "item-1",
          payrollMonth: "2026-08",
          title: "2026年08月工资条",
          state: "sent",
          employeeUserId: "employee-a",
          employeeName: "员工A",
          employeeNo: "A001",
          position: "会计",
          fields: { 实发金额: 9000 },
          sendStatus: "sent",
          viewStatus: "viewed",
          confirmStatus: "confirmed",
          confirmedAt: "2026-08-01T08:00:00.000Z",
          confirmedBy: "employee-a",
        }],
      });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "发薪存证" }));
    expect(await screen.findByText("员工A")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看发薪存证" }));
    expect(await screen.findByText("2026年08月工资条")).toBeInTheDocument();
    expect(screen.getByText("已确认")).toBeInTheDocument();
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

  it("renders sub-admin names resolved from the directory", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/sub-admins") return Promise.resolve(["finance-1"]);
      if (path === "/v1/directory/users") return Promise.resolve([{
        userId: "finance-1",
        name: "财务小李",
        departmentIds: [],
      }]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "权限管理" }));
    expect(await screen.findByText("财务小李")).toBeInTheDocument();
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
