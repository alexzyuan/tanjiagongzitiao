import { useEffect, useState, type ReactNode } from "react";
import { api, type Settings } from "../api";
import { Icon } from "../icons";
import { errorText } from "../utils/errors";
import { Loading } from "../components/Loading";

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return <div className="setting-row"><div><strong>{title}</strong><span>{description}</span></div>{children}</div>;
}

export function SettingsCenter() {
  const [settings, setSettings] = useState<Settings>();
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    api<Settings>("/v1/settings")
      .then(setSettings)
      .catch((reason) => setError(errorText(reason)));
  }, []);
  async function save() {
    if (!settings) return;
    setError(undefined);
    try {
      setSettings(
        await api<Settings>("/v1/settings", {
          method: "PATCH",
          body: JSON.stringify(settings),
        }),
      );
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2200);
    } catch (reason) {
      setError(errorText(reason));
    }
  }
  if (!settings)
    return (
      <section className="content-section">
        <Loading />
      </section>
    );
  return (
    <section className="content-section">
      <div className="section-header">
        <div>
          <h2>系统设置</h2>
          <p>配置员工工资条的查看范围。</p>
        </div>
        <button className="button primary" onClick={save}>
          <Icon name="check" size={17} />
          保存设置
        </button>
      </div>
      {saved && (
        <div className="notice success">
          <Icon name="check" size={17} />
          设置已保存
        </div>
      )}
      {error && <div className="notice error">{error}</div>}
      <div className="settings-stack">
        <SettingRow
          title="员工可查看范围"
          description="员工仅可查看最近 12 个月的工资条，超期批次进入加密归档。"
        >
          <span className="fixed-value">12 个月</span>
        </SettingRow>
        <SettingRow
          title="通知方式"
          description="工资条将通过钉钉工作通知发送给员工。"
        >
          <span className="fixed-value">钉钉工作通知</span>
        </SettingRow>
        <SettingRow
          title="查看与确认待办"
          description="待办需要员工 OAuth 授权和定时调度后才能创建；当前未启用，避免出现未实际发送的提醒。"
        >
          <span className="fixed-value">待授权</span>
        </SettingRow>
      </div>
      <div className="log-link">
        <Icon name="receipt" size={18} />
        <div>
          <strong>操作日志</strong>
          <span>上传、发送、撤回、导出和设置变更均会记录</span>
        </div>
        <span className="muted">在发薪存证中查看</span>
      </div>
    </section>
  );
}
