import { render, screen } from "@testing-library/react";
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

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
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
