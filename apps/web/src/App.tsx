import { useEffect, useState, type ReactNode } from "react";
import { ensureSession, type Identity } from "./api";
import { Icon } from "./icons";
import { EmployeeHome, EmployeePage } from "./pages/EmployeeSalary";
import { EvidenceCenter } from "./pages/EvidenceCenter";
import { PermissionCenter } from "./pages/PermissionCenter";
import { ReportCenter } from "./pages/ReportCenter";
import { SalaryManagement } from "./pages/SalaryManagement";
import { SettingsCenter } from "./pages/SettingsCenter";
import { Loading } from "./components/Loading";
import { errorText } from "./utils/errors";

type Module = "salary" | "evidence" | "reports" | "permissions" | "settings";

const nav: Array<{
  key: Module;
  label: string;
  icon: Parameters<typeof Icon>[0]["name"];
}> = [
  { key: "salary", label: "工资条管理", icon: "wallet" },
  { key: "evidence", label: "发薪存证", icon: "receipt" },
  { key: "reports", label: "报表中心", icon: "chart" },
  { key: "permissions", label: "权限管理", icon: "lock" },
  { key: "settings", label: "系统设置", icon: "settings" },
];

export function App() {
  const impersonatedId =
    new URLSearchParams(window.location.search).get("as") ?? undefined;
  if (window.location.pathname === "/employee/salary-slips")
    return (
      <EmployeeViewport>
        <EmployeeHome employeeId={impersonatedId} />
      </EmployeeViewport>
    );
  if (window.location.pathname.startsWith("/employee/"))
    return (
      <EmployeeViewport>
        <EmployeePage employeeId={impersonatedId} />
      </EmployeeViewport>
    );
  return <AdminApp impersonatedId={impersonatedId} />;
}

function EmployeeViewport({ children }: { children: ReactNode }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 700);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth <= 700);
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  if (!isMobile)
    return (
      <main className="employee-desktop-notice">请在手机钉钉中查看工资条</main>
    );
  return <>{children}</>;
}

function AdminApp({ impersonatedId }: { impersonatedId: string | undefined }) {
  const [identity, setIdentity] = useState<Identity>();
  const [module, setModule] = useState<Module>("salary");
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    ensureSession(impersonatedId)
      .then(setIdentity)
      .catch((reason) => setError(errorText(reason)));
  }, [impersonatedId]);
  useEffect(() => {
    const openPermissions = () => setModule("permissions");
    const openSettings = () => setModule("settings");
    window.addEventListener("salary-open-permissions", openPermissions);
    window.addEventListener("salary-open-settings", openSettings);
    return () => {
      window.removeEventListener("salary-open-permissions", openPermissions);
      window.removeEventListener("salary-open-settings", openSettings);
    };
  }, []);

  if (error) return <FullError message={error} />;
  if (!identity) return <Loading />;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            <Icon name="wallet" size={19} />
          </span>
          <span>薪资中心</span>
        </div>
        <div className="sidebar-caption">企业内部应用</div>
        <nav className="nav-list" aria-label="功能导航">
          {nav.map((item) => (
            <button
              className={`nav-item ${module === item.key ? "active" : ""}`}
              key={item.key}
              onClick={() => setModule(item.key)}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="security-dot">
            <Icon name="shield" size={15} />
          </span>
          <span>敏感数据加密存储</span>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div>
            <div className="eyebrow">企业薪资服务</div>
            <h1>{nav.find((item) => item.key === module)?.label}</h1>
          </div>
          <div className="identity">
            <span className="avatar">{identity.name.slice(0, 1)}</span>
            <span>{identity.name}</span>
            <span className="role">主管理员</span>
          </div>
        </header>
        <div className="page-wrap">
          {module === "salary" && (
            <SalaryManagement
              onChanged={() => setRefreshKey((value) => value + 1)}
              refreshKey={refreshKey}
            />
          )}
          {module === "evidence" && <EvidenceCenter refreshKey={refreshKey} />}
          {module === "reports" && <ReportCenter refreshKey={refreshKey} />}
          {module === "permissions" && (
            <PermissionCenter
              refreshKey={refreshKey}
              onChanged={() => setRefreshKey((value) => value + 1)}
            />
          )}
          {module === "settings" && <SettingsCenter />}
        </div>
      </main>
    </div>
  );
}





function FullError({ message }: { message: string }) {
  return (
    <div className="full-error">
      <Icon name="shield" size={24} />
      <strong>页面加载失败</strong>
      <span>{message}</span>
    </div>
  );
}
