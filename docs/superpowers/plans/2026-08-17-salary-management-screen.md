# 工资条管理界面改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans (required for inline execution). Steps use checkbox (`- [ ]`) syntax.

**Goal:** 将工资条管理页实现为截图中的按月份工资表工作台，并保留现有真实 API 与权限边界。

**Architecture:** 在现有 `SalaryManagement` 中增加月份、搜索、状态筛选、批量选择和菜单状态；通过已存在的批次详情接口加载员工明细，所有发送/撤回/导出动作继续走 API。样式集中在现有 CSS，移动端采用纵向员工行而不是横向页面溢出。

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS, Fastify API。

---

### Task 1: 建立工资条管理交互状态

**Files:**
- Modify: `apps/web/src/App.tsx` (`SalaryManagement`)
- Test: `apps/web/src/api.test.ts` only for any new API helper, otherwise use browser interaction verification

- [ ] 添加 `month`, `query`, `statusFilter`, `selectedIds`, `moreOpen` 状态；月份默认当前月份，查询和筛选只作用于已加载的可访问批次。
- [ ] 添加派生列表：按 `payrollMonth`、标题/月份匹配文本、批次状态过滤；批量选择只保留当前派生列表中的 ID。
- [ ] 添加月份选择器、上一月/下一月按钮和月份面板，月份切换不修改服务器数据。
- [ ] 添加更多菜单，菜单项分别打开设置、全部撤回确认、CSV 导出和 PDF 存证导出；导出链接使用当前批次 ID 或现有报表接口，不在前端解密工资字段。
- [ ] 添加批量发送/撤回二次确认，复用 `send` 函数并逐项保留错误。

### Task 2: 重做工资条管理标记结构

**Files:**
- Modify: `apps/web/src/App.tsx` (`SalaryManagement`, `BatchDetail`)

- [ ] 用截图结构替换当前页面标题区：返回按钮、月份标题、管理员入口、异常/未查看/未确认摘要。
- [ ] 添加工资表概览条，展示当前月份批次标题、发送/查看/确认计数和设置、删除、查看发送动作。
- [ ] 将批次列表改为员工明细表；选中批次后加载详情，显示姓名、员工状态、实发工资、发送状态、查看状态、确认状态和撤回操作。
- [ ] 保留导入 Excel、手工录入和详情抽屉入口，并为加载、空数据、错误和批量操作提供可见状态。

### Task 3: 实现截图风格与响应式布局

**Files:**
- Modify: `apps/web/src/styles.css`

- [ ] 增加工资工作台专用样式：浅灰背景、白色工具区、紧凑表格、固定操作列、蓝色主按钮和状态标签。
- [ ] 添加月份面板、更多菜单、摘要栏、管理员卡片和员工行样式，控制层级和 z-index，避免菜单被表格遮挡。
- [ ] 在 `max-width: 760px` 下压缩顶部区域、摘要改为两列、表格改为员工纵向行，确保按钮和文字不溢出。

### Task 4: 验证与部署

**Files:**
- Modify: none unless verification finds a defect

- [ ] 运行 `pnpm test`、`pnpm typecheck`、`pnpm build`。
- [ ] 启动本地 web/API，验证工资条管理首屏、月份切换、搜索、状态筛选、更多菜单、批量操作和详情抽屉。
- [ ] 使用桌面和移动视口截图检查无重叠、裁切、横向溢出或控制项失效。
- [ ] 若验证通过，将前端生产构建发布到 `/opt/salary-slip/releases/<commit>`，重启 systemd 服务并通过 `https://salary.tanjiabi.cc/healthz` 验证。
