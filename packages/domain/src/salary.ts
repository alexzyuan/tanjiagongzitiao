export type SalaryBatchState =
  | "draft"
  | "scheduled"
  | "sending"
  | "sent"
  | "partially_failed"
  | "withdrawn"
  | "archived";

const transitions: Record<SalaryBatchState, readonly SalaryBatchState[]> = {
  draft: ["scheduled", "sending", "withdrawn"],
  scheduled: ["sending", "withdrawn"],
  sending: ["sent", "partially_failed"],
  sent: ["sending", "withdrawn", "archived"],
  partially_failed: ["sending", "withdrawn", "archived"],
  withdrawn: ["sending", "archived"],
  archived: []
};

export function canTransition(from: SalaryBatchState, to: SalaryBatchState): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(from: SalaryBatchState, to: SalaryBatchState): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid_salary_batch_transition:${from}->${to}`);
  }
}

export type SalaryFieldValue = string | number | null;

export type SalarySlipTheme = "default" | "technology" | "night" | "gold" | "lotus";

export interface SalarySlipFieldGroup {
  id: string;
  name: string;
  fieldKeys: string[];
}

export interface SalarySlipDisplaySettings {
  netAmountField: string;
  hideEmptyFields: boolean;
  feedbackEnabled: boolean;
  confirmationEnabled: boolean;
  notice: string;
  greeting: string;
  theme: SalarySlipTheme;
  visibleFields: string[];
  fieldGroups: SalarySlipFieldGroup[];
}

export interface SalarySlipTemplate {
  id: string;
  name: string;
  settings: SalarySlipDisplaySettings;
  createdAt: string;
}

export const defaultSalarySlipDisplaySettings: SalarySlipDisplaySettings = {
  netAmountField: "实发金额",
  hideEmptyFields: true,
  feedbackEnabled: false,
  confirmationEnabled: false,
  notice: "工资条属于敏感信息，请注意保密",
  greeting: "{name}，工作辛苦啦",
  theme: "default",
  visibleFields: [],
  fieldGroups: []
};

export interface SalaryItemInput {
  employeeUserId: string;
  employeeName: string;
  employeeNo?: string;
  department?: string;
  position?: string;
  fields: Record<string, SalaryFieldValue>;
}

export interface SalaryBatchSummary {
  id: string;
  payrollMonth: string;
  title: string;
  state: SalaryBatchState;
  total: number;
  sent: number;
  viewed: number;
  confirmed: number;
  assignedAdminIds: string[];
  createdById: string;
  displaySettings: SalarySlipDisplaySettings;
}
