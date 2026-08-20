import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, api: apiMock };
});

import { EvidenceCenter } from "./EvidenceCenter";

const employee = {
  employeeUserId: "employee-a",
  employeeName: "员工A",
  employeeNo: "A001",
  department: "财务",
  position: "会计",
  employmentStatus: "active" as const,
  evidenceCount: 2,
  latestEvidenceAt: "2026-08-10T10:00:00.000Z",
};

const detail = {
  employee,
  availableFields: ["基本工资", "实发金额"],
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
      department: "财务",
      position: "会计",
      fields: { 基本工资: 10000, 实发金额: 9000 },
      sendStatus: "sent",
      sentAt: "2026-08-01T08:00:00.000Z",
      viewStatus: "viewed",
      viewedAt: "2026-08-08T09:00:00.000Z",
      confirmStatus: "confirmed",
      confirmedAt: "2026-08-10T10:00:00.000Z",
      confirmedBy: "employee-a",
    },
  ],
};

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("EvidenceCenter", () => {
  it("renders employment tabs, search results, and employee detail statuses", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/v1/payment-evidence/employees/employee-a"))
        return Promise.resolve(detail);
      if (path.startsWith("/v1/payment-evidence/employees"))
        return Promise.resolve([employee]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<EvidenceCenter refreshKey={0} />);

    expect(await screen.findByText("员工A")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "在职" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "查看发薪存证" }));

    expect(await screen.findByText("已确认")).toBeInTheDocument();
    expect(screen.getByText("2026-08-10 10:00")).toBeInTheDocument();
    expect(screen.getByText("employee-a")).toBeInTheDocument();
    expect(screen.getByText("实发金额")).toBeInTheDocument();
  });

  it("filters the employee detail and downloads selected Excel fields", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      blob: () => Promise.resolve(new Blob(["xlsx"])),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:payment-evidence"),
      revokeObjectURL: vi.fn(),
    });
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith("/v1/payment-evidence/employees/employee-a"))
        return Promise.resolve(detail);
      if (path.startsWith("/v1/payment-evidence/employees"))
        return Promise.resolve([employee]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<EvidenceCenter refreshKey={0} />);
    await user.click(await screen.findByRole("button", { name: "查看发薪存证" }));
    await user.click(screen.getByRole("button", { name: "筛选" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "发送状态" }), "sent");
    await user.click(screen.getByRole("button", { name: "应用筛选" }));
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/v1/payment-evidence/employees/employee-a?sendStatus=sent",
      ),
    );

    await user.click(screen.getByRole("button", { name: "导出 Excel" }));
    expect(screen.getByRole("checkbox", { name: "实发金额" })).toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "基本工资" }));
    await user.click(screen.getByRole("button", { name: "下载 Excel" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/v1/payment-evidence/export.xlsx");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toMatchObject({
      employeeUserId: "employee-a",
      sendStatus: "sent",
      fields: ["实发金额"],
    });
  });

  it("renders an empty employee state", async () => {
    apiMock.mockResolvedValue([]);
    render(<EvidenceCenter refreshKey={0} />);
    expect(await screen.findByText("暂无发薪存证")).toBeInTheDocument();
  });
});
