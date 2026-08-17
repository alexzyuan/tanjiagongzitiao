export interface Identity {
  userId: string;
  name: string;
  corpId: string;
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
    return api<Identity>("/v1/auth/dev", { method: "POST", body: JSON.stringify({}) });
  }
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
  totals: { batches: number; recipients: number; sent: number; viewed: number; confirmed: number; failedDeliveries: number; evidenceEvents: number };
  batches: Array<Batch & { deliveryFailures: number; evidenceEvents: number }>;
}

export interface Settings {
  employeeVisibilityMonths: 12;
  passwordVerification: boolean;
  notificationMode: "work_notice" | "work_notice_with_todo";
  payrollReminder: boolean;
  employeeOnlyView: boolean;
}
