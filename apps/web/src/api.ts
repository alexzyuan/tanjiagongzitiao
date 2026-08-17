export interface Identity {
  userId: string;
  name: string;
  corpId: string;
}

interface DingTalkAuthConfig {
  mode: "mock" | "http";
  corpId: string;
  clientId: string;
}

interface DingTalkAuthResponse {
  code?: string;
  authCode?: string;
}

interface DingTalkJsApi {
  getAuthCode?: (options: {
    corpId: string;
    success?: (response: DingTalkAuthResponse) => void;
    fail?: (reason: unknown) => void;
    complete?: () => void;
  }) => unknown;
}

declare global {
  interface Window { dd?: DingTalkJsApi; }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...init, headers, credentials: "include" });
  const contentType = response.headers.get("content-type") ?? "";
  const body: unknown = contentType.includes("json") ? await response.json() : await response.text();
  if (!response.ok) {
    const code = typeof body === "object" && body && "code" in body ? String((body as { code: unknown }).code) : `http_${response.status}`;
    throw new Error(code);
  }
  return body as T;
}

export async function ensureSession(employeeId?: string): Promise<Identity> {
  if (employeeId) {
    return api<Identity>("/v1/auth/dev", { method: "POST", body: JSON.stringify({ userId: employeeId, name: employeeId }) });
  }
  try {
    return await api<Identity>("/v1/auth/session");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.startsWith("session_")) throw error;
    const auth = await api<DingTalkAuthConfig>("/v1/auth/config");
    if (auth.mode === "mock") return api<Identity>("/v1/auth/dev", { method: "POST", body: JSON.stringify({}) });
    const authCode = await requestDingTalkAuthCode(auth.corpId);
    return api<Identity>("/v1/auth/dingtalk", { method: "POST", body: JSON.stringify({ authCode }) });
  }
}

async function requestDingTalkAuthCode(corpId: string): Promise<string> {
  const getAuthCode = window.dd?.getAuthCode;
  if (!getAuthCode) throw new Error("dingtalk_jsapi_get_auth_code_unavailable_open_this_page_inside_dingtalk");
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (callback: (value: string) => void, value: string) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const fail = (reason: unknown) => finish(reject, reason instanceof Error ? reason.message : "dingtalk_auth_code_request_failed");
    let result: unknown;
    try {
      result = getAuthCode({
        corpId,
        success: response => {
          const code = response.code ?? response.authCode;
          if (!code) return fail("dingtalk_auth_code_missing");
          finish(resolve, code);
        },
        fail,
        complete: () => undefined
      });
    } catch (reason) {
      fail(reason);
      return;
    }
    if (isPromiseLike(result)) result.then(response => {
      const code = response && typeof response === "object"
        ? String((response as { code?: unknown; authCode?: unknown }).code ?? (response as { authCode?: unknown }).authCode ?? "")
        : "";
      if (!code) return fail("dingtalk_auth_code_missing");
      finish(resolve, code);
    }, fail);
    window.setTimeout(() => fail("dingtalk_auth_code_timeout"), 15_000);
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof (value as { then?: unknown }).then === "function";
}

export interface Batch {
  id: string;
  payrollMonth: string;
  title: string;
  state: string;
  total: number;
  sent: number;
  viewed: number;
  confirmed: number;
  assignedAdminIds: string[];
  createdById: string;
  createdAt?: string;
  items?: SalaryItem[];
}

export interface SalaryItem {
  id: string;
  batchId: string;
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  fields: Record<string, string | number | null>;
  viewedAt?: string;
  confirmedAt?: string;
}

export interface ReportSummary {
  totals: { batches: number; recipients: number; sent: number; viewed: number; confirmed: number; failedDeliveries: number; evidenceEvents: number; salaryTotals: { gross: number; net: number; tax: number; socialInsurance: number } };
  batches: Array<Batch & { deliveryFailures: number; evidenceEvents: number }>;
}

export interface Settings {
  employeeVisibilityMonths: 12;
  passwordVerification: boolean;
  notificationMode: "work_notice" | "work_notice_with_todo";
  payrollReminder: boolean;
  employeeOnlyView: boolean;
}
