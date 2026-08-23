import type { DirectoryUser, SalaryImportPreview } from "../../../api";
import { formatSalaryValue } from "../../../format";
import { directoryLabel } from "../../../utils/ui";

type PreviewRow = SalaryImportPreview["rows"][number];

export function ImportMatchStep({
  preview,
  employeeFields,
  unresolved,
  activeRow,
  directoryQuery,
  directoryResults,
  busy,
  error,
  onBack,
  onNext,
  onOpenDirectory,
  onDirectoryQueryChange,
  onSearchDirectory,
  onSelectUser,
}: {
  preview: SalaryImportPreview;
  employeeFields: string[];
  unresolved: PreviewRow[];
  activeRow?: number;
  directoryQuery: string;
  directoryResults: DirectoryUser[];
  busy: boolean;
  error?: string;
  onBack: () => void;
  onNext: () => void;
  onOpenDirectory: (row: number) => void;
  onDirectoryQueryChange: (query: string) => void;
  onSearchDirectory: () => void;
  onSelectUser: (row: number, user: DirectoryUser) => void;
}) {
  return (
    <div className="wizard-panel">
      <div className="wizard-panel-title">
        <div>
          <h3>预览表格数据</h3>
          <p>汇总行不会导入；异常人员需匹配到企业通讯录后才能进入设置。</p>
        </div>
        <span className="preview-count">
          已匹配 {preview.matched} · 待处理 {unresolved.length}
        </span>
      </div>
      <div className="source-preview-scroll">
        <table className="source-preview-table">
          <thead>
            <tr>
              <th>行</th>
              <th>状态</th>
              {employeeFields.map((field) => (
                <th key={field}>{field}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.sourceRows.map((row) => (
              <tr
                className={row.kind === "summary" ? "ignored-summary" : ""}
                key={row.row}
              >
                <td>{row.row}</td>
                <td>
                  {row.kind === "summary"
                    ? "汇总行，不导入"
                    : preview.rows.find((item) => item.row === row.row)?.status ===
                        "matched"
                      ? "已匹配"
                      : "待处理"}
                </td>
                {employeeFields.map((field) => (
                  <td key={field}>
                    {formatSalaryValue(
                      row.source[field] as string | number | null | undefined,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {unresolved.length > 0 && (
        <div className="import-match-list">
          {unresolved.map((row) => (
            <div className="import-match-row" key={row.row}>
              <div>
                <strong>第 {row.row} 行</strong>
                <span>{row.value ?? "未提供匹配字段"}</span>
              </div>
              {row.candidates.length ? (
                <div className="match-actions">
                  {row.candidates.map((user) => (
                    <button
                      className="text-button"
                      type="button"
                      key={user.userId}
                      onClick={() => onSelectUser(row.row, user)}
                    >
                      {directoryLabel(user)}
                    </button>
                  ))}
                </div>
              ) : (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => onOpenDirectory(row.row)}
                >
                  选择人员
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {activeRow && (
        <div className="directory-search">
          <strong>为第 {activeRow} 行选择企业人员</strong>
          <div>
            <input
              autoFocus
              value={directoryQuery}
              onChange={(event) => onDirectoryQueryChange(event.target.value)}
              placeholder="姓名、工号或钉钉用户 ID"
            />
            <button
              type="button"
              className="button secondary"
              disabled={busy || !directoryQuery.trim()}
              onClick={onSearchDirectory}
            >
              搜索
            </button>
          </div>
          {directoryResults.map((user) => (
            <button
              className="directory-result"
              type="button"
              key={user.userId}
              onClick={() => onSelectUser(activeRow, user)}
            >
              {directoryLabel(user)}
            </button>
          ))}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <div className="wizard-actions">
        <button className="button secondary" type="button" onClick={onBack}>
          重新上传
        </button>
        <button
          className="button primary"
          type="button"
          disabled={unresolved.length > 0}
          onClick={onNext}
        >
          下一步
        </button>
      </div>
    </div>
  );
}
