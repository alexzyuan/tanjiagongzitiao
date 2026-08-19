import { useCallback, useEffect, useState, type FormEvent } from "react";
import { api, type Batch, type DirectoryUser } from "../api";
import { Icon } from "../icons";
import { errorText } from "../utils/errors";
import { EmptyState } from "../components/EmptyState";
import { Modal } from "../components/Modal";

export function PermissionCenter({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [subAdmins, setSubAdmins] = useState<string[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [userId, setUserId] = useState("");
  const [subAdminPickerOpen, setSubAdminPickerOpen] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    Promise.all([
      api<Batch[]>("/v1/salary-batches"),
      api<string[]>("/v1/sub-admins"),
      api<DirectoryUser[]>("/v1/directory/users"),
    ])
      .then(([value, roles, users]) => {
        setBatches(value);
        setSelectedId(value[0]?.id ?? "");
        setSubAdmins(roles);
        setDirectory(users);
      })
      .catch((reason) => setError(errorText(reason)));
  }, [refreshKey]);
  const selected = batches.find((batch) => batch.id === selectedId);
  async function assign(event: FormEvent) {
    event.preventDefault();
    if (!selected || !userId.trim()) return;
    try {
      await api(`/v1/salary-batches/${selected.id}/admins`, {
        method: "POST",
        body: JSON.stringify({ userId: userId.trim() }),
      });
      setMessage(`已将 ${userId.trim()} 添加为工资表管理员`);
      setUserId("");
      const value = await api<Batch[]>("/v1/salary-batches");
      setBatches(value);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  async function removeBatchAdmin(id: string) {
    if (!selected) return;
    try {
      const updated = await api<Batch>(
        `/v1/salary-batches/${selected.id}/admins/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      setBatches((value) =>
        value.map((batch) => (batch.id === updated.id ? updated : batch)),
      );
      setMessage(`已移除工资表管理员 ${id}`);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  const directoryById = new Map(
    directory.map((entry) => [entry.userId, entry]),
  );
  async function assignSubAdmin(user: DirectoryUser) {
    try {
      const roles = await api<string[]>("/v1/sub-admins", {
        method: "POST",
        body: JSON.stringify({ userId: user.userId }),
      });
      setSubAdmins(roles);
      setMessage(`已将 ${user.name} 添加为子管理员`);
      setSubAdminPickerOpen(false);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  async function removeSubAdmin(id: string) {
    try {
      setSubAdmins(
        await api<string[]>(`/v1/sub-admins/${encodeURIComponent(id)}`, {
          method: "DELETE",
        }),
      );
      setMessage(`已移除子管理员 ${id}`);
      onChanged();
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>权限管理</h2>
          <p>主管理员默认由企业管理员担任，其他人员按工资表手动授权。</p>
        </div>
      </div>
      {message && (
        <div className="notice success">
          <Icon name="check" size={17} />
          {message}
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <div className="permission-grid">
        <div className="permission-card">
          <div className="card-kicker">主管理员</div>
          <div className="admin-profile">
            <span className="avatar blue">管</span>
            <div>
              <strong>企业管理员</strong>
              <small>全部工资表 · 全部历史 · 系统设置</small>
            </div>
            <span className="tag blue-tag">默认</span>
          </div>
          <div className="sub-admin-block">
            <div className="card-kicker">子管理员</div>
            <div className="assign-row">
              <button
                className="directory-picker-trigger"
                type="button"
                onClick={() => setSubAdminPickerOpen(true)}
              >
                <Icon name="users" size={18} />
                从企业通讯录选择人员
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => setSubAdminPickerOpen(true)}
              >
                <Icon name="plus" size={16} />
                添加
              </button>
            </div>
            {subAdmins.length ? (
              <div className="chips">
                {subAdmins.map((id) => (
                  <span className="person-chip" key={id}>
                    <span className="dot" />
                    {directoryById.get(id)?.name ?? id}
                    <button
                      type="button"
                      className="chip-remove"
                      onClick={() => removeSubAdmin(id)}
                      aria-label={`移除 ${id}`}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <EmptyState label="暂无子管理员" compact />
            )}
          </div>
        </div>
        <div className="permission-card">
          <div className="card-kicker">工资表管理员</div>
          <label className="field-label">
            选择工资表
            <select
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              <option value="">请选择</option>
              {batches.map((batch) => (
                <option value={batch.id} key={batch.id}>
                  {batch.title}
                </option>
              ))}
            </select>
          </label>
          <form className="assign-row" onSubmit={assign}>
            <input
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
              placeholder="输入钉钉用户 ID"
            />
            <button className="button primary" type="submit">
              <Icon name="plus" size={16} />
              添加
            </button>
          </form>
          {selected?.assignedAdminIds.length ? (
            <div className="chips">
              {selected.assignedAdminIds.map((id) => (
                <span className="person-chip" key={id}>
                  <span className="dot" />
                  {id}
                  <button
                    type="button"
                    className="chip-remove"
                    onClick={() => removeBatchAdmin(id)}
                    aria-label={`移除 ${id}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <EmptyState label="该工资表暂未添加管理员" compact />
          )}
        </div>
      </div>
      <div className="info-banner">
        <Icon name="lock" size={18} />
        <div>
          <strong>权限边界</strong>
          <span>
            子管理员仅可发放和管理被添加的工资表；加密归档仅企业管理员可访问。
          </span>
        </div>
      </div>
      {subAdminPickerOpen && (
        <DirectoryPicker
          excludedUserIds={subAdmins}
          onClose={() => setSubAdminPickerOpen(false)}
          onPick={(person) => void assignSubAdmin(person)}
        />
      )}
    </section>
  );
}

function DirectoryPicker({
  excludedUserIds,
  onClose,
  onPick,
}: {
  excludedUserIds: string[];
  onClose: () => void;
  onPick: (user: DirectoryUser) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<DirectoryUser>();
  const [error, setError] = useState<string>();
  const [loading, setLoading] = useState(false);
  const search = useCallback(async (value: string) => {
    setLoading(true);
    setError(undefined);
    try {
      setResults(
        await api<DirectoryUser[]>(
          `/v1/directory/users?query=${encodeURIComponent(value)}`,
        ),
      );
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void search("");
  }, [search]);
  const people = results.filter(
    (person) => !excludedUserIds.includes(person.userId),
  );
  return (
    <Modal title="请选择人员" onClose={onClose} wide>
      <div className="directory-picker">
        <div className="directory-picker-list">
          <label className="search">
            <Icon name="search" size={17} />
            <input
              autoFocus
              value={query}
              placeholder="搜索姓名、工号或职位"
              onChange={(event) => {
                const value = event.target.value;
                setQuery(value);
                void search(value);
              }}
            />
          </label>
          {loading && <p className="muted">正在查询企业通讯录…</p>}
          {error && <div className="notice error">{error}</div>}
          {!loading &&
            !error &&
            people.map((person) => (
              <button
                type="button"
                className={`directory-person ${selected?.userId === person.userId ? "selected" : ""}`}
                key={person.userId}
                onClick={() => setSelected(person)}
              >
                <span className="avatar blue">{person.name.slice(0, 1)}</span>
                <span>
                  <strong>{person.name}</strong>
                  <small>
                    {person.position ?? "企业成员"}
                    {person.employeeNo ? ` · ${person.employeeNo}` : ""}
                  </small>
                </span>
              </button>
            ))}
          {!loading && !error && !people.length && (
            <EmptyState label="未找到可添加的企业成员" compact />
          )}
        </div>
        <div className="directory-picker-selected">
          <strong>已选人员</strong>
          {selected ? (
            <div className="selected-person">
              <span className="avatar blue">{selected.name.slice(0, 1)}</span>
              <span>
                <b>{selected.name}</b>
                <small>
                  {selected.position ?? selected.employeeNo ?? "企业成员"}
                </small>
              </span>
            </div>
          ) : (
            <p className="muted">请选择一位企业成员</p>
          )}
        </div>
      </div>
      <div className="modal-actions">
        <button className="button secondary" type="button" onClick={onClose}>
          取消
        </button>
        <button
          className="button primary"
          type="button"
          disabled={!selected}
          onClick={() => selected && onPick(selected)}
        >
          确定添加
        </button>
      </div>
    </Modal>
  );
}
