import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return { ...actual, api: apiMock };
});

import { formatSalaryValue, SalaryManagement } from "./App";

const batch = {
  id: "batch-1", payrollMonth: "2026-08", title: "2026年08月工资条",
  state: "draft", total: 1, sent: 0, viewed: 0, confirmed: 0,
  assignedAdminIds: [], createdById: "dev-admin", displaySettings: {
    netAmountField: "实发金额", hideEmptyFields: true, feedbackEnabled: false,
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
});
