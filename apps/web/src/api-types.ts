export interface Batch {
  id: string;
  payrollMonth: string;
  title: string;
  state: string;
  total: number;
  sent: number;
  withdrawn?: number;
  viewed: number;
  confirmed: number;
  canDelete?: boolean;
  assignedAdminIds: string[];
  createdById: string;
  displaySettings: SalarySlipDisplaySettings;
  createdAt?: string;
  items?: SalaryItem[];
}

export type SalarySlipTheme =
  | "default"
  | "technology"
  | "night"
  | "gold"
  | "lotus";

export interface SalarySlipFieldGroup {
  id: string;
  name: string;
  fieldKeys: string[];
}

export interface SalarySlipTemplate {
  id: string;
  name: string;
  settings: SalarySlipDisplaySettings;
  createdAt: string;
}

export interface SalarySlipDisplaySettings {
  netAmountField: string;
  hideEmptyFields: boolean;
  confirmationEnabled: boolean;
  notice: string;
  greeting: string;
  theme: SalarySlipTheme;
  visibleFields: string[];
  fieldGroups: SalarySlipFieldGroup[];
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
  deliveryStatus?: "delivered" | "failed" | "withdrawn";
  canEdit?: boolean;
  canSend?: boolean;
  canWithdraw?: boolean;
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
  totals: {
    batches: number;
    recipients: number;
    sent: number;
    viewed: number;
    confirmed: number;
    failedDeliveries: number;
    evidenceEvents: number;
    salaryTotals: {
      gross: number;
      net: number;
      tax: number;
      socialInsurance: number;
    };
  };
  batches: Array<Batch & { deliveryFailures: number; evidenceEvents: number }>;
}

export type PaymentEvidenceEmploymentStatus = "active" | "departed";
export type PaymentEvidenceSendStatus =
  | "not_sent"
  | "sent"
  | "failed"
  | "withdrawn";
export type PaymentEvidenceViewStatus = "not_viewed" | "viewed";
export type PaymentEvidenceConfirmStatus = "not_confirmed" | "confirmed";

export interface PaymentEvidenceEmployee {
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  employmentStatus: PaymentEvidenceEmploymentStatus;
  evidenceCount: number;
  latestEvidenceAt?: string;
}

export interface PaymentEvidenceFilters {
  fromMonth?: string;
  toMonth?: string;
  sendStatus?: PaymentEvidenceSendStatus;
  viewStatus?: PaymentEvidenceViewStatus;
  confirmStatus?: PaymentEvidenceConfirmStatus;
}

export interface PaymentEvidenceRow {
  batchId: string;
  itemId: string;
  payrollMonth: string;
  title: string;
  state: string;
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  fields: Record<string, string | number | null>;
  sendStatus: PaymentEvidenceSendStatus;
  sentAt?: string;
  withdrawnAt?: string;
  viewStatus: PaymentEvidenceViewStatus;
  viewedAt?: string;
  confirmStatus: PaymentEvidenceConfirmStatus;
  confirmedAt?: string;
  confirmedBy?: string;
}

export interface PaymentEvidenceDetail {
  employee: PaymentEvidenceEmployee;
  rows: PaymentEvidenceRow[];
  availableFields: string[];
}

export interface Settings {
  employeeVisibilityMonths: 12;
}
