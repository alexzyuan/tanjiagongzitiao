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

import { EmployeeHome, EmployeePage } from "./EmployeeSalary";

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
        batch: { id: "batch-1", payrollMonth: "2026-08", title: "历史自定义标题", displaySettings },
        item: { id: "item-1", batchId: "batch-1", employeeUserId: "employee-a", employeeName: "员工A", fields: { 基本工资: 10000, 实发金额: 9000 } },
      });
    if (path === "/v1/me/salary-slips/batch-1/view") return Promise.resolve({});
    return Promise.reject(new Error(`unexpected_request:${path}`));
  });
}

function mockEmployeeHome(displaySettings: ReturnType<typeof settings>) {
  window.history.pushState({}, "", "/employee/salary-slips");
  sessionMock.mockResolvedValue({ userId: "employee-a", name: "员工A", corpId: "corp" });
  apiMock.mockImplementation((path: string) => {
    if (path === "/v1/me/salary-slips")
      return Promise.resolve([
        {
          batch: {
            id: "batch-1",
            payrollMonth: "2026-08",
            title: "历史自定义标题",
            displaySettings,
          },
          item: {
            id: "item-1",
            batchId: "batch-1",
            employeeUserId: "employee-a",
            employeeName: "员工A",
            fields: { 基本工资: 10000, 实发金额: 9000 },
          },
        },
      ]);
    return Promise.reject(new Error(`unexpected_request:${path}`));
  });
}

function mockEmployeePreview(displaySettings: ReturnType<typeof settings>) {
  window.history.pushState({}, "", "/employee/preview/batch-1/item-1");
  sessionMock.mockResolvedValue({ userId: "dev-admin", name: "企业管理员", corpId: "corp" });
  apiMock.mockImplementation((path: string) => {
    if (path === "/v1/salary-batches/batch-1/items/item-1/employee-preview")
      return Promise.resolve({
        batch: { id: "batch-1", payrollMonth: "2026-08", title: "工资条", displaySettings },
        item: { id: "item-1", batchId: "batch-1", employeeUserId: "employee-a", employeeName: "员工A", fields: { 基本工资: 10000, 实发金额: 9000 } },
      });
    return Promise.reject(new Error(`unexpected_request:${path}`));
  });
}

afterEach(() => vi.clearAllMocks());

describe("employee salary semantics", () => {
  it("matches the compact employee home layout with an explicit month picker", async () => {
    mockEmployeeHome(settings(false));
    render(<EmployeeHome employeeId="employee-a" />);
    expect(await screen.findByText("实发金额总和")).toBeInTheDocument();
    expect(screen.getByText("2026年08月工资条")).toBeInTheDocument();
    expect(screen.getByText("明细")).toBeInTheDocument();
    expect(document.querySelector(".employee-month-chevron")).toBeInTheDocument();
    expect(document.querySelector(".employee-mobile-nav")).not.toBeInTheDocument();
    expect(screen.queryByText("我的工资条", { exact: true })).not.toBeInTheDocument();
    expect(document.querySelector(".employee-hero")).toBeInTheDocument();
    expect(document.querySelectorAll(".employee-watermark")).toHaveLength(2);
    const card = screen.getByRole("button", { name: /2026年08月工资条/ });
    expect(card.querySelector(".employee-slip-card-amount")).toBeInTheDocument();
    expect(card.querySelector(".employee-slip-card-amount em")).toHaveTextContent("实发工资");
  });

  it("shows an update notice when the salary item has been withdrawn", async () => {
    window.history.pushState({}, "", "/employee/salary-slips/batch-1");
    sessionMock.mockResolvedValue({ userId: "employee-a", name: "员工A", corpId: "corp" });
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/me/salary-slips/batch-1")
        return Promise.reject(new Error("salary_item_withdrawn"));
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<EmployeePage employeeId="employee-a" />);
    const notice = await screen.findByText(/工资条信息稍后更新。/);
    expect(notice.textContent).toBe(
      "工资条信息稍后更新。\n如有疑问，请联系财务同事。",
    );
    expect(screen.queryByText("页面加载失败")).not.toBeInTheDocument();
    expect(screen.queryByText("salary_item_withdrawn")).not.toBeInTheDocument();
  });

  it("hides confirmation control and wording when confirmation is disabled", async () => {
    mockEmployeePage(settings(false));
    render(<EmployeePage employeeId="employee-a" />);
    await screen.findByRole("heading", { name: "2026年08月工资条" });
    expect(screen.queryByRole("button", { name: /确认已查看/ })).not.toBeInTheDocument();
    expect(screen.getByText(/查看时间将生成存证记录/)).toBeInTheDocument();
    expect(screen.queryByText(/查看和确认时间将生成存证记录/)).not.toBeInTheDocument();
  });

  it("shows confirmation control and wording when confirmation is enabled", async () => {
    mockEmployeePage(settings(true));
    render(<EmployeePage employeeId="employee-a" />);
    await screen.findByRole("heading", { name: "2026年08月工资条" });
    const confirmationButton = screen.getByRole("button", { name: "确认已查看" });
    expect(confirmationButton).toBeInTheDocument();
    expect(confirmationButton).not.toBeDisabled();
    expect(screen.queryByRole("button", { name: "已确认查看" })).not.toBeInTheDocument();
    expect(screen.getByText(/查看和确认时间将生成存证记录/)).toBeInTheDocument();
  });

  it("renders the configured employee care greeting on the salary detail", async () => {
    mockEmployeePage({ ...settings(true), greeting: "{name}，本月辛苦啦" });
    render(<EmployeePage employeeId="employee-a" />);
    await screen.findByRole("heading", { name: "2026年08月工资条" });
    expect(screen.getByText("员工A，本月辛苦啦")).toBeInTheDocument();
  });

  it("renders the compact branded detail without the redundant app header or employee identifier", async () => {
    mockEmployeePage({ ...settings(true), greeting: "{name}，工作辛苦啦" });
    render(<EmployeePage employeeId="employee-a" />);
    expect(
      await screen.findByRole("heading", { name: "2026年08月工资条" }),
    ).toBeInTheDocument();
    expect(screen.getByText("员工A，工作辛苦啦")).toBeInTheDocument();
    expect(screen.queryByText("employee-a")).not.toBeInTheDocument();
    expect(document.querySelector(".employee-top")).not.toBeInTheDocument();
    expect(
      document.querySelector(".employee-sheet > .employee-watermark"),
    ).toBeInTheDocument();
    expect(
      document.querySelector(".employee-detail-hero > .employee-watermark"),
    ).not.toBeInTheDocument();
  });

  it("renders the configured salary notice on the employee detail", async () => {
    mockEmployeePage({
      ...settings(true),
      notice: "工资条属于敏感信息，请注意保密",
    });
    render(<EmployeePage employeeId="employee-a" />);
    await screen.findByRole("heading", { name: "2026年08月工资条" });
    expect(screen.getByText("温馨提示")).toBeInTheDocument();
    expect(
      screen.getByText("工资条属于敏感信息，请注意保密"),
    ).toBeInTheDocument();
    expect(document.querySelector(".employee-notice")).toBeInTheDocument();
  });

  it("renders admin employee preview as read-only and does not create view activity", async () => {
    mockEmployeePreview(settings(true));
    render(<EmployeePage employeeId={undefined} preview />);
    await screen.findByRole("heading", { name: "2026年08月工资条" });
    expect(screen.getByText(/管理员预览不会记录员工查看或确认状态/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /确认已查看/ })).not.toBeInTheDocument();
    expect(apiMock).not.toHaveBeenCalledWith("/v1/me/salary-slips/batch-1/view", { method: "POST" });
    expect(apiMock).not.toHaveBeenCalledWith("/v1/me/salary-slips/batch-1/confirm", { method: "POST" });
  });

  it("shows an empty mobile list when the signed-in administrator has no own salary slip", async () => {
    window.history.pushState({}, "", "/employee/salary-slips");
    sessionMock.mockResolvedValue({ userId: "dev-admin", name: "企业管理员", corpId: "corp" });
    apiMock.mockResolvedValue([]);
    render(<EmployeeHome employeeId={undefined} />);
    expect(await screen.findByText("暂无可查看的工资条")).toBeInTheDocument();
    expect(screen.queryByText("加载中")).not.toBeInTheDocument();
  });
});
