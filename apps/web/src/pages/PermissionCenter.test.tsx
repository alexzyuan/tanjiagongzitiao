import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));

vi.mock("../api", async () => {
  const actual = await vi.importActual<typeof import("../api")>("../api");
  return { ...actual, api: apiMock };
});

import { PermissionCenter } from "./PermissionCenter";

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("PermissionCenter directory picker", () => {
  it("debounces directory searches instead of requesting every keystroke", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/sub-admins") return Promise.resolve([]);
      if (path.startsWith("/v1/directory/users")) return Promise.resolve([]);
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<PermissionCenter refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText("暂无子管理员");
    await user.click(
      screen.getByRole("button", { name: "从企业通讯录选择人员" }),
    );
    const input = screen.getByPlaceholderText("搜索姓名、工号或职位");
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(
        "/v1/directory/users?query=",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    vi.clearAllMocks();

    vi.useFakeTimers();
    await act(async () => {
      fireEvent.change(input, { target: { value: "徐" } });
      fireEvent.change(input, { target: { value: "徐小" } });
      fireEvent.change(input, { target: { value: "徐小明" } });
      vi.advanceTimersByTime(299);
    });
    expect(apiMock).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(
      "/v1/directory/users?query=%E5%BE%90%E5%B0%8F%E6%98%8E",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("shows a friendly message when DingTalk throttles a directory search", async () => {
    const user = userEvent.setup();
    apiMock.mockImplementation((path: string) => {
      if (path === "/v1/salary-batches") return Promise.resolve([]);
      if (path === "/v1/sub-admins") return Promise.resolve([]);
      if (path === "/v1/directory/users") return Promise.resolve([]);
      if (path.startsWith("/v1/directory/users?query="))
        return Promise.reject(new Error("dingtalk_rate_limited"));
      return Promise.reject(new Error(`unexpected_request:${path}`));
    });

    render(<PermissionCenter refreshKey={0} onChanged={vi.fn()} />);
    await screen.findByText("暂无子管理员");
    await user.click(
      screen.getByRole("button", { name: "从企业通讯录选择人员" }),
    );

    expect(
      await screen.findByText("通讯录查询频繁，请稍后重试。"),
    ).toBeInTheDocument();
  });
});
