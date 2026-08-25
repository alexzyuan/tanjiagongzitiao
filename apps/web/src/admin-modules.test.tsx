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

const identity = { userId: "admin-1", name: "管理员", corpId: "corp-1" };
const batch = {
  id: "batch-1",
  payrollMonth: "2026-08",
  title: "2026年08月工资条",
  state: "draft",
  total: 1,
  sent: 0,
  viewed: 0,
  confirmed: 0,
  canDelete: true,
  assignedAdminIds: [],
  createdById: "dev-admin",
  displaySettings: {
    netAmountField: "实发金额",
    hideEmptyFields: true,
    confirmationEnabled: false,
    notice: "",
    greeting: "",
    theme: "default",
    visibleFields: [],
    fieldGroups: [],
  },
};
const report = {
  filter: { payrollMonth: null, fromMonth: null, toMonth: null },
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
  monthly: [
    {
      payrollMonth: "2026-08",
      gross: 12000,
      net: 10000,
      recipients: 2,
      sent: 1,
      viewed: 1,
      confirmed: 1,
    },
  ],
  employees: [
    {
      employeeUserId: "employee-a",
      employeeName: "员工A",
      employeeNo: "A001",
      department: "财务",
      position: "会计",
      slips: 1,
      gross: 12000,
      net: 10000,
      sent: 1,
      viewed: 1,
      confirmed: 1,
    },
  ],
  batches: [{ ...batch, deliveryFailures: 0, evidenceEvents: 1 }],
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  window.history.replaceState({}, "", "/");
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: 1024,
  });
});

describe("root route viewport split", () => {
  it("shows the current user's employee home at the root on a mobile viewport", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 500,
    });
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/me/salary-slips") return Promise.resolve([]);
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<App />);

    expect(await screen.findByText("暂无可查看的工资条")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/v1/me/salary-slips");
    expect(screen.queryByRole("button", { name: "工资条管理" })).not.toBeInTheDocument();
  });

  it("keeps the administrator shell at the root on a desktop viewport", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 1024,
    });
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: "工资条管理" })).toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/v1/me/salary-slips");
  });
});

describe("admin module navigation", () => {
  it("opens permissions from the salary manager control through explicit app navigation", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/sub-admins") return Promise.resolve([]);
      if (path === "/v1/directory/users") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<App />);
    await user.click(
      await screen.findByRole("button", { name: "打开权限管理" }),
    );
    expect(
      await screen.findByRole("button", { name: "从企业通讯录选择人员" }),
    ).toBeInTheDocument();
  });
});

describe("admin module smoke tests", () => {
  it("loads evidence and renders its empty state", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/payment-evidence/employees?employmentStatus=active")
        return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "发薪存证" }));
    expect(await screen.findByText("暂无发薪存证")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith(
      "/v1/payment-evidence/employees?employmentStatus=active",
    );
  });

  it("renders a non-empty evidence record", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/payment-evidence/employees?employmentStatus=active")
        return Promise.resolve([
          {
            employeeUserId: "employee-a",
            employeeName: "员工A",
            employeeNo: "A001",
            position: "会计",
            employmentStatus: "active",
            evidenceCount: 1,
            latestEvidenceAt: "2026-08-01T08:00:00.000Z",
          },
        ]);
      if (path === "/v1/payment-evidence/employees/employee-a")
        return Promise.resolve({
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
          rows: [
            {
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
            },
          ],
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
    expect(screen.getAllByText("¥ 10,000.00")).not.toHaveLength(0);
    expect(screen.getByText("人力成本汇总")).toBeInTheDocument();
    expect(screen.getByText("员工薪资汇总")).toBeInTheDocument();
    expect(screen.getByText("员工A")).toBeInTheDocument();
    expect(apiMock).toHaveBeenCalledWith("/v1/reports/summary");
  });

  it("filters the report by a month range", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/reports/summary") return Promise.resolve(report);
      if (path === "/v1/reports/summary?fromMonth=2026-02&toMonth=2026-08")
        return Promise.resolve(report);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "报表中心" }));
    await user.click(await screen.findByRole("button", { name: "统计范围设置" }));
    await user.type(await screen.findByLabelText("统计起始月份"), "2026-02");
    await user.type(await screen.findByLabelText("统计结束月份"), "2026-08");
    await user.click(screen.getByRole("button", { name: "应用统计范围" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/v1/reports/summary?fromMonth=2026-02&toMonth=2026-08",
      ),
    );
  });

  it("loads permission data and opens the directory picker", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({ ...batch, items: [] });
      if (path === "/v1/sub-admins") return Promise.resolve([]);
      if (path === "/v1/directory/users") return Promise.resolve([]);
      if (path === "/v1/directory/users?query=") return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "权限管理" }));
    await user.click(
      await screen.findByRole("button", { name: "从企业通讯录选择人员" }),
    );
    expect(
      await screen.findByRole("heading", { name: "请选择人员" }),
    ).toBeInTheDocument();
  });

  it("renders sub-admin names resolved from the directory", async () => {
    const user = userEvent.setup();
    ensureSessionMock.mockResolvedValue(identity);
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/sub-admins") return Promise.resolve(["finance-1"]);
      if (path === "/v1/directory/users")
        return Promise.resolve([
          {
            userId: "finance-1",
            name: "财务小李",
            departmentIds: [],
          },
        ]);
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
      if (path === "/v1/settings")
        return Promise.resolve({ employeeVisibilityMonths: 12 });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<App />);
    await user.click(await screen.findByRole("button", { name: "系统设置" }));
    expect(await screen.findByText("员工可查看范围")).toBeInTheDocument();
    expect(screen.getByText("12 个月")).toBeInTheDocument();
  });
});
