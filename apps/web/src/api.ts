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
  code?: string | number;
  authCode?: string;
}

interface DingTalkJsApi {
  requestAuthCode?: (options: {
    corpId: string;
    clientId: string;
    success?: (response: DingTalkAuthResponse) => void;
    fail?: (reason: unknown) => void;
    onSuccess?: (response: DingTalkAuthResponse) => void;
    onFail?: (reason: unknown) => void;
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
    const authCode = await requestDingTalkAuthCode(auth.corpId, auth.clientId);
    return api<Identity>("/v1/auth/dingtalk", { method: "POST", body: JSON.stringify({ authCode }) });
  }
}

async function requestDingTalkAuthCode(corpId: string, clientId: string): Promise<string> {
  const requestAuthCode = window.dd?.requestAuthCode;
  if (!requestAuthCode) throw new Error("dingtalk_jsapi_request_auth_code_unavailable_open_this_page_inside_dingtalk");
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = <T>(callback: (value: T) => void, value: T) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    const fail = (reason: unknown) => finish(reject, toError(reason, "dingtalk_auth_code_request_failed"));
    let result: unknown;
    try {
      result = requestAuthCode({
        corpId,
        clientId,
        onSuccess: response => {
          const code = extractDingTalkAuthCode(response);
          if (!code) return fail("dingtalk_auth_code_missing");
          finish(resolve, code);
        },
        onFail: fail,
        complete: () => undefined
      });
    } catch (reason) {
      fail(reason);
      return;
    }
    if (isPromiseLike(result)) result.then(response => {
      const code = response && typeof response === "object" ? extractDingTalkAuthCode(response as DingTalkAuthResponse) : "";
      if (!code) return fail("dingtalk_auth_code_missing");
      finish(resolve, code);
    }, fail);
    window.setTimeout(() => fail("dingtalk_auth_code_timeout"), 15_000);
  });
}

export function extractDingTalkAuthCode(response: DingTalkAuthResponse): string {
  if (typeof response.authCode === "string" && response.authCode.trim()) return response.authCode.trim();
  if (typeof response.code === "string" && response.code.trim() && response.code.trim() !== "0") return response.code.trim();
  if (typeof response.code === "number" && Number.isFinite(response.code) && response.code !== 0) return String(response.code);
  return "";
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return typeof value === "object" && value !== null && "then" in value && typeof (value as { then?: unknown }).then === "function";
}

function toError(reason: unknown, fallback: string): Error {
  if (reason instanceof Error) return reason;
  if (typeof reason === "string" && reason.trim()) return new Error(reason);
  if (typeof reason === "object" && reason !== null) {
    const value = reason as { code?: unknown; errorCode?: unknown; message?: unknown };
    const message = value.code ?? value.errorCode ?? value.message;
    if (typeof message === "string" && message.trim()) return new Error(message);
  }
  return new Error(fallback);
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
  displaySettings: SalarySlipDisplaySettings;
  createdAt?: string;
  items?: SalaryItem[];
}

export type SalarySlipTheme = "default" | "technology" | "night" | "gold" | "lotus";

export interface SalarySlipDisplaySettings {
  netAmountField: string;
  hideEmptyFields: boolean;
  feedbackEnabled: boolean;
  confirmationEnabled: boolean;
  notice: string;
  greeting: string;
  theme: SalarySlipTheme;
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

export type EmployeeMatchStrategy = "userId" | "employeeNo" | "name";

export interface DirectoryUser {
  userId: string;
  name: string;
  employeeNo?: string;
  position?: string;
  departmentIds: number[];
}

export interface SalaryImportPreviewRow {
  row: number;
  status: "matched" | "unmatched" | "ambiguous";
  source: Record<string, unknown>;
  value?: string;
  user?: DirectoryUser;
  candidates: DirectoryUser[];
}

export interface SalaryImportSourceRow {
  row: number;
  source: Record<string, unknown>;
  kind: "employee" | "summary";
}

export interface SalaryImportPreview {
  previewId: string;
  expiresAt: string;
  strategy: EmployeeMatchStrategy;
  sourceRows: SalaryImportSourceRow[];
  rows: SalaryImportPreviewRow[];
  ignoredSummaryRows: number;
  matched: number;
  unmatched: number;
  ambiguous: number;
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
