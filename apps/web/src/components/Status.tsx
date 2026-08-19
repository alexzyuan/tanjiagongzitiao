import { Icon } from "../icons";

const stateLabel: Record<string, string> = {
  draft: "未发送",
  scheduled: "已排期",
  sending: "发送中",
  sent: "已发送",
  partially_failed: "部分失败",
  failed: "发送失败",
  withdrawn: "已撤回",
  archived: "已归档",
  viewed: "已查看",
  unread: "未查看",
  confirmed: "已确认",
  unconfirmed: "未确认",
  在职: "在职",
};;

export function Status({ state }: { state: string }) {
  const label = stateLabel[state] ?? state;
  return (
    <span className={`status status-${state}`}>
      {state === "confirmed" && <Icon name="check" size={13} />}
      {label}
    </span>
  );
}
