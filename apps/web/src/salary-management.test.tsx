import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: apiMock };
});

import { SalaryManagement } from "./pages/SalaryManagement";
import { formatSalaryValue } from "./format";

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

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("salary management", () => {
  it("does not show a back button on the monthly batch overview", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);

    await screen.findByText("0/1");
    expect(
      screen.queryByRole("button", { name: "返回" }),
    ).not.toBeInTheDocument();
  });

  it("does not open the salary detail drawer when the management page first loads", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({ ...batch, items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText("0/1");
    await waitFor(() =>
      expect(document.querySelector(".drawer-backdrop")).not.toBeInTheDocument(),
    );
  });

  it("rounds displayed salary numbers to two decimal places", () => {
    expect(formatSalaryValue(23.9333333333333)).toBe("23.93");
    expect(formatSalaryValue(1.005)).toBe("1.01");
  });

  it("labels the per-employee action as a work notification send without DING", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({
          ...batch,
          items: [
            {
              id: "item-1",
              employeeName: "员工A",
              employeeUserId: "employee-a",
              fields: { 实发金额: 10000 },
              canSend: true,
            },
          ],
        });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "前往发送" }));
    await screen.findByRole("button", { name: "单独发送" });
    expect(screen.queryByText(/DING/)).not.toBeInTheDocument();
  });

  it("does not show employee preview or edit for a non-withdrawn row", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({
          ...batch,
          items: [
            {
              id: "item-1",
              employeeName: "员工A",
              employeeUserId: "employee-a",
              fields: { 实发金额: 10000 },
              canSend: true,
            },
          ],
        });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "前往发送" }));
    expect(screen.queryByRole("link", { name: "员工端预览" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
  });

  it("renders failed and withdrawn employee delivery states", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          { ...batch, state: "partially_failed", total: 2, canDelete: false },
        ]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({
          ...batch,
          state: "partially_failed",
          total: 2,
          items: [
            {
              id: "item-failed",
              employeeName: "员工失败",
              employeeUserId: "employee-failed",
              fields: { 实发金额: 10000 },
              deliveryStatus: "failed",
              canSend: true,
            },
            {
              id: "item-withdrawn",
              employeeName: "员工撤回",
              employeeUserId: "employee-withdrawn",
              fields: { 实发金额: 9000 },
              deliveryStatus: "withdrawn",
              canEdit: true,
              canSend: true,
            },
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

  it("filters a partially failed batch by each employee's latest delivery status", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          { ...batch, state: "partially_failed", total: 2, canDelete: false },
        ]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({
          ...batch,
          state: "partially_failed",
          total: 2,
          items: [
            {
              id: "item-failed",
              employeeName: "员工失败",
              employeeUserId: "employee-failed",
              fields: { 实发金额: 10000 },
              deliveryStatus: "failed",
              canSend: true,
            },
            {
              id: "item-withdrawn",
              employeeName: "员工撤回",
              employeeUserId: "employee-withdrawn",
              fields: { 实发金额: 9000 },
              deliveryStatus: "withdrawn",
              canEdit: true,
              canSend: true,
            },
          ],
        });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "前往发送" }));
    expect(await screen.findByText("员工失败")).toBeInTheDocument();
    expect(screen.getByText("员工撤回")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /前往处理/ }));
    expect(screen.getByText("员工失败")).toBeInTheDocument();
    expect(screen.queryByText("员工撤回")).not.toBeInTheDocument();
    expect(screen.getByText(/发送异常/)).toBeInTheDocument();
  });

  it("loads only summaries until a batch is opened, then opens the import wizard", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([batch]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({ ...batch, items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText("0/1");
    expect(apiMock).not.toHaveBeenCalledWith("/v1/salary-batches/batch-1");
    await user.click(screen.getByRole("button", { name: "前往发送" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith("/v1/salary-batches/batch-1"),
    );
    await user.click(screen.getByRole("button", { name: "返回" }));
    await user.click(screen.getByRole("button", { name: "上传工资表" }));
    expect(
      await screen.findByRole("heading", { name: "上传工资表" }),
    ).toBeInTheDocument();
  });

  it("shows monthly actions from delivery progress and never exposes batch settings", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          { ...batch, id: "draft-batch", title: "未发送工资条", total: 2, canDelete: true },
          { ...batch, id: "partial-batch", title: "部分发送工资条", total: 2, sent: 1, state: "partially_failed", canDelete: false },
          { ...batch, id: "sent-batch", title: "已发送工资条", sent: 1, total: 1, state: "sent", canDelete: false },
        ]);
      if (path === "/v1/salary-batches/sent-batch")
        return Promise.resolve({
          ...batch,
          id: "sent-batch",
          title: "已发送工资条",
          sent: 1,
          total: 1,
          state: "sent",
          items: [],
        });
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
    expect(
      await screen.findByRole("columnheader", { name: "姓名" }),
    ).toBeInTheDocument();
  });

  it("uses the server canDelete capability instead of inferring it from batch state", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          { ...batch, id: "blocked-draft", title: "服务端禁止删除", canDelete: false },
          { ...batch, id: "allowed-partial", title: "服务端允许删除", state: "partially_failed", sent: 1, total: 2, canDelete: true },
        ]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    expect(await screen.findByText("服务端禁止删除")).toBeInTheDocument();
    const deleteButtons = screen.getAllByRole("button", { name: "删除" });
    expect(deleteButtons[0]).toBeDisabled();
    expect(deleteButtons[1]).toBeEnabled();
  });

  it("deletes an untouched draft through an in-app confirmation dialog", async () => {
    const user = userEvent.setup();
    const nativeConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    let deleted = false;
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/v1/salary-batches" && !options?.method)
        return Promise.resolve(
          deleted ? [] : [{ ...batch, total: 2, canDelete: true }],
        );
      if (path === "/v1/salary-batches/batch-1" && options?.method === "DELETE") {
        deleted = true;
        return Promise.resolve({ deleted: true, batchId: batch.id });
      }
      if (path === "/v1/salary-batches/batch-1" && !options?.method)
        return Promise.resolve({ ...batch, total: 2, items: [] });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "删除" }));
    expect(
      await screen.findByRole("heading", { name: "确认删除工资条" }),
    ).toBeInTheDocument();
    expect(screen.getByText("确定删除 2026年08月工资条 吗？")).toBeInTheDocument();
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalledWith(
      "/v1/salary-batches/batch-1",
      expect.objectContaining({ method: "DELETE" }),
    );
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/v1/salary-batches/batch-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "删除" })).not.toBeInTheDocument(),
    );
    expect(screen.getByText("当前月份暂无工资表")).toBeInTheDocument();
  });

  it("enables deleting a partially failed batch when no salary was delivered", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/v1/salary-batches" && !options?.method)
        return Promise.resolve([
          { ...batch, state: "partially_failed", sent: 0, total: 1, canDelete: true },
        ]);
      if (path === "/v1/salary-batches/batch-1" && options?.method === "DELETE")
        return Promise.resolve({ deleted: true, batchId: batch.id });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    const deleteButton = await screen.findByRole("button", { name: "删除" });
    expect(deleteButton).toBeEnabled();
    expect(deleteButton).not.toHaveClass("muted");
    await user.click(deleteButton);
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/v1/salary-batches/batch-1",
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });

  it("shows a delete API failure inside the confirmation dialog", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === "/v1/salary-batches" && !options?.method)
        return Promise.resolve([{ ...batch, total: 2, canDelete: true }]);
      if (path === "/v1/salary-batches/batch-1" && options?.method === "DELETE")
        return Promise.reject(new Error("salary_batch_not_deletable"));
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "删除" }));
    await user.click(screen.getByRole("button", { name: "确认删除" }));
    expect(await screen.findByText("salary_batch_not_deletable")).toBeInTheDocument();
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
            canDelete: true,
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

  it("shows the server-calculated withdrawn count on a deletable partial batch", async () => {
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          {
            ...batch,
            title: "部分发送后撤回工资条",
            total: 6,
            sent: 1,
            withdrawn: 1,
            canDelete: true,
          },
        ]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    const withdrawn = await screen.findByText("已撤回");
    expect(withdrawn.parentElement).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: "删除" })).toBeEnabled();
  });

  it("enables editing only after withdrawal and saves revised salary fields", async () => {
    const user = userEvent.setup();
    const delivered = {
      id: "item-1",
      employeeName: "员工A",
      employeeUserId: "employee-a",
      fields: { 实发金额: 10000 },
      deliveryStatus: "delivered",
      canEdit: false,
      canSend: false,
      canWithdraw: true,
    };
    const withdrawn = {
      ...delivered,
      fields: { 实发金额: 10100 },
      deliveryStatus: "withdrawn" as const,
      canEdit: true,
      canSend: true,
      canWithdraw: false,
    };
    let withdrawnState = false;
    apiMock.mockImplementation(
      (path: string, options?: { method?: string; body?: string }) => {
        if (path === "/v1/salary-batches")
          return Promise.resolve([
            { ...batch, sent: 1, total: 1, state: "sent", canDelete: false },
          ]);
        if (
          path === "/v1/salary-batches/batch-1/items/item-1" &&
          options?.method === "PATCH"
        )
          return Promise.resolve({
            ...batch,
            sent: 1,
            total: 1,
            state: "sent",
            items: [withdrawn],
          });
        if (path === "/v1/salary-batches/batch-1/items/item-1/withdraw") {
          withdrawnState = true;
          return Promise.resolve({
            ...batch,
            sent: 1,
            total: 1,
            state: "sent",
            items: [withdrawn],
          });
        }
        if (path === "/v1/salary-batches/batch-1")
          return Promise.resolve({
            ...batch,
            sent: 1,
            total: 1,
            state: "sent",
            items: [withdrawnState ? withdrawn : delivered],
          });
        return Promise.reject(new Error(`unexpected_request:${path}`));
      },
    );
    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "查看发送" }));
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "撤回" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "编辑" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "编辑" }));
    const amount = await screen.findByLabelText("实发金额");
    await user.clear(amount);
    await user.type(amount, "10100");
    await user.click(screen.getByRole("button", { name: "保存并关闭" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/v1/salary-batches/batch-1/items/item-1",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
  });

  it("uses server capabilities to disable archived withdrawn item actions", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches")
        return Promise.resolve([
          {
            ...batch,
            state: "archived",
            sent: 1,
            total: 1,
            canDelete: false,
          },
        ]);
      if (path === "/v1/salary-batches/batch-1")
        return Promise.resolve({
          ...batch,
          state: "archived",
          sent: 1,
          total: 1,
          items: [
            {
              id: "item-1",
              employeeName: "员工A",
              employeeUserId: "employee-a",
              fields: { 实发金额: 10000 },
              deliveryStatus: "withdrawn",
              canEdit: false,
              canSend: false,
              canWithdraw: false,
            },
          ],
        });
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<SalaryManagement refreshKey={0} onChanged={vi.fn()} />);
    await user.click(await screen.findByRole("button", { name: "查看发送" }));
    expect(screen.queryByRole("button", { name: "编辑" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新发送" })).toBeDisabled();
  });
});
