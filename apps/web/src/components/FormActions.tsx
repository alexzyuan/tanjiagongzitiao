import { Icon } from "../icons";

export function FormActions({
  onClose,
  submitLabel = "创建工资表",
}: {
  onClose: () => void;
  submitLabel?: string;
}) {
  return (
    <div className="form-actions span-2">
      <button type="button" className="button secondary" onClick={onClose}>
        取消
      </button>
      <button type="submit" className="button primary">
        <Icon name="check" size={16} />
        {submitLabel}
      </button>
    </div>
  );
}
