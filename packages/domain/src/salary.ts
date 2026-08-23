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
  archived: [],
};

export function canTransition(
  from: SalaryBatchState,
  to: SalaryBatchState,
): boolean {
  return transitions[from].includes(to);
}

export function assertTransition(
  from: SalaryBatchState,
  to: SalaryBatchState,
): void {
  if (!canTransition(from, to)) {
    throw new Error(`invalid_salary_batch_transition:${from}->${to}`);
  }
}

export type SalaryDeliveryStatus = "delivered" | "failed" | "withdrawn";

export function canDeleteSalaryBatch(input: {
  state: SalaryBatchState;
  sent: number;
  deliveries: readonly {
    employeeUserId: string;
    status: SalaryDeliveryStatus;
  }[];
}): boolean {
  if (input.state === "archived") return false;
  const deliveriesByEmployee = new Map<
    string,
    typeof input.deliveries
  >();
  for (const delivery of input.deliveries) {
    const deliveries = deliveriesByEmployee.get(delivery.employeeUserId) ?? [];
    deliveriesByEmployee.set(delivery.employeeUserId, [
      ...deliveries,
      delivery,
    ]);
  }
  const deliveryHistories = [...deliveriesByEmployee.values()];
  const hasDeliveredItems = deliveryHistories.some((deliveries) =>
    deliveries.some((delivery) => delivery.status === "delivered"),
  );
  const allDeliveredItemsWithdrawn = deliveryHistories.every(
    (deliveries) =>
      !deliveries.some((delivery) => delivery.status === "delivered") ||
      deliveries.at(-1)?.status === "withdrawn",
  );
  const onlyInitialDeliveryFailures =
    input.sent === 0 &&
    input.deliveries.length > 0 &&
    input.deliveries.every((delivery) => delivery.status === "failed");
  const untouchedDraft =
    input.state === "draft" && input.deliveries.length === 0;
  return (
    untouchedDraft ||
    onlyInitialDeliveryFailures ||
    (hasDeliveredItems && allDeliveredItemsWithdrawn)
  );
}

export function canEditSalaryItem(input: {
  batchState: SalaryBatchState;
  latestDeliveryStatus?: SalaryDeliveryStatus;
}): boolean {
  return (
    input.batchState !== "archived" &&
    input.latestDeliveryStatus === "withdrawn"
  );
}

export type SalaryFieldValue = string | number | null;

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

export interface SalarySlipTemplate {
  id: string;
  name: string;
  settings: SalarySlipDisplaySettings;
  createdAt: string;
}

export const defaultSalarySlipDisplaySettings: SalarySlipDisplaySettings = {
  netAmountField: "实发金额",
  hideEmptyFields: true,
  confirmationEnabled: false,
  notice: "工资条属于敏感信息，请注意保密",
  greeting: "{name}，工作辛苦啦",
  theme: "default",
  visibleFields: [],
  fieldGroups: [],
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
