import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock, sessionMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  sessionMock: vi.fn(),
}));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, api: apiMock, ensureSession: sessionMock };
});

import { EmployeePage } from "./EmployeeSalary";

const settings = (confirmationEnabled: boolean) => ({
  netAmountField: "实发金额",
  hideEmptyFields: true,
  confirmationEnabled,
  notice: "",
  greeting: "{name}",
  theme: "default" as const,
  visibleFields: [],
  fieldGroups: [],
});

function mockEmployeePage(displaySettings: ReturnType<typeof settings>) {
  window.history.pushState({}, "", "/employee/salary-slips/batch-1");
  sessionMock.mockResolvedValue({ userId: "employee-a", name: "员工A", corpId: "corp" });
  apiMock.mockImplementation((path: string) => {
    if (path === "/v1/me/salary-slips/batch-1")
      return Promise.resolve({
        batch: { id: "batch-1", payrollMonth: "2026-08", title: "工资条", displaySettings },
        item: { id: "item-1", batchId: "batch-1", employeeUserId: "employee-a", employeeName: "员工A", fields: { 基本工资: 10000, 实发金额: 9000 } },
      });
    if (path === "/v1/me/salary-slips/batch-1/view") return Promise.resolve({});
    return Promise.reject(new Error(`unexpected_request:${path}`));
  });
}

afterEach(() => vi.clearAllMocks());

describe("employee salary semantics", () => {
  it("shows an update notice when the salary item has been withdrawn", async () => {
    window.history.pushState({}, "", "/employee/salary-slips/batch-1");
    sessionMock.mockResolvedValue({ userId: "employee-a", name: "员工A", corpId: "corp" });
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/me/salary-slips/batch-1")
        return Promise.reject(new Error("salary_item_withdrawn"));
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<EmployeePage employeeId="employee-a" />);
    expect(
      await screen.findByText(
        "工资条信息正在更新，后续将通过钉钉通知发送更新信息。如有疑问，请联系财务同事。",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("页面加载失败")).not.toBeInTheDocument();
    expect(screen.queryByText("salary_item_withdrawn")).not.toBeInTheDocument();
  });

  it("hides confirmation control and wording when confirmation is disabled", async () => {
    mockEmployeePage(settings(false));
    render(<EmployeePage employeeId="employee-a" />);
    await screen.findByText("员工A · employee-a");
    expect(screen.queryByRole("button", { name: /确认已查看/ })).not.toBeInTheDocument();
    expect(screen.getByText(/查看时间将生成存证记录/)).toBeInTheDocument();
    expect(screen.queryByText(/查看和确认时间将生成存证记录/)).not.toBeInTheDocument();
  });

  it("shows confirmation control and wording when confirmation is enabled", async () => {
    mockEmployeePage(settings(true));
    render(<EmployeePage employeeId="employee-a" />);
    await screen.findByText("员工A · employee-a");
    const confirmationButton = screen.getByRole("button", { name: "确认已查看" });
    expect(confirmationButton).toBeInTheDocument();
    expect(confirmationButton).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "已确认查看" })).not.toBeInTheDocument();
    expect(screen.getByText(/查看和确认时间将生成存证记录/)).toBeInTheDocument();
  });
});
