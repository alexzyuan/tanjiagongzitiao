import type { FormEvent } from "react";

export function ImportUploadStep({
  busy,
  error,
  fileName,
  onFileChange,
  onSubmit,
  onClose,
}: {
  busy: boolean;
  error: string | undefined;
  fileName?: string | undefined;
  onFileChange: (file: File | undefined) => void;
  onSubmit: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <form className="wizard-panel wizard-upload" onSubmit={onSubmit}>
      <h3>导入 Excel 工资表</h3>
      <p>上传后只创建限时预览，不会生成工资条或发送通知。</p>
      <label className="upload-dropzone">
        <span className="upload-dropzone-icon" aria-hidden="true">
          ↗
        </span>
        <strong>{fileName ?? "直接上传现有的 Excel 工资表"}</strong>
        <span>支持 .xlsx、.xls、.csv 文件</span>
        <input
          aria-label="工资表文件"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(event) => onFileChange(event.target.files?.[0])}
          required
        />
      </label>
      {error && <div className="notice error">{error}</div>}
      <div className="wizard-actions">
        <button type="button" className="button secondary" onClick={onClose}>
          取消
        </button>
        <button className="button primary" disabled={busy}>
          {busy ? "正在读取" : "下一步"}
        </button>
      </div>
    </form>
  );
}
