# 工资条应用开发约定

本文件是项目根级执行规则，也是 Codex / AI Agent 的长期执行契约。

默认读取顺序：

1. `AGENTS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/AI_INDEX.md`
4. 涉及工资生命周期/权限/员工行为时再读 `docs/BUSINESS_RULES.md`
5. 只打开当前任务直接相关的代码和测试

`CODEX_TASKS.md`、`docs/superpowers/` 与 `docs/history/` 属于历史设计/任务资料，不是默认首轮上下文；只有任务明确依赖历史原因时再读取。

## Codex-First / Agent-Friendly Engineering

本仓库主要由 Codex/AI Agent 辅助维护。优化目标是在不牺牲正确性、安全性、运行轻量和人类可读性的前提下，让 Agent 更快、更准确地定位、理解、修改和验证代码。

1. **One rule, one source**：一个业务规则只有一个权威实现。前端不得独立重写服务端/domain 的权限或生命周期规则。
2. **One concept, one obvious entry point**：一个主要业务概念应能从一个清晰命名的主文件/模块快速定位。
3. **Small enough, not fragmented**：按真实职责拆大文件，不为消除行数 warning 制造大量 tiny wrapper/hook/component。
4. **Explicit over magical**：优先直接 import、函数调用、props、typed interface；避免全局事件、隐藏 registry、反射和隐式魔法。
5. **Tests describe behavior**：测试名称必须描述被保护的业务行为；行为 bug 尽量补回归测试。
6. **Stable vocabulary**：沿用既有术语 `salary batch`、`salary item`、`delivery`、`evidence`、`withdraw`、`resend`、`confirmation`、`archive`，无必要不重命名或引入同义词。
7. **Current truth over historical noise**：当前架构/业务/运维事实和历史任务记录分离。
8. **Locality of change**：普通功能原则上应集中在少量直接相关文件；若简单改动长期需要阅读/修改大量无关文件，应先检查职责是否分散。
9. **No abstraction without repeated pressure**：不为假设中的未来需求新增层、框架或 runtime dependency。
10. **Verification is part of completion**：没有真实跑过并通过验证命令，不得报告“已完成/已通过”。

## 导入工作流

- Excel 导入是三步工作流：上传只生成限时预览，预览仅在用户确认后才会创建工资表，设置在最终提交时与批次一起持久化。
- 预览必须保留源表中的汇总行以供人工核对，但汇总行绝不能成为工资条接收人。
- 个人身份字段不能作为“实发金额字段”候选项。
- 批次级工资条展示设置是员工端展示的唯一数据来源；默认值定义在 `@salary/domain`，并由数据库读写层持久化。
- 工资条模板存储在 SQLite，应用模板只用于创建新批次；批次提交后必须保留独立的配置快照，后续修改模板不得改变既有工资条。
- 单独发送与批量发送必须共享同一审计、存证和投递记录链路；员工行的发送状态以最新投递记录为准。
- 工资条的正式触达渠道是钉钉工作通知；本项目不使用 DING。
- “未查看/未确认待办”必须在发送当日的状态检查后创建，并持久化提醒幂等键、创建时间和钉钉任务 ID。待钉钉 OAuth 用户授权模型与定时调度配置完成前，禁止在界面或投递结果中声称该能力已启用。
- 子管理员只能从企业通讯录中选择；服务端必须再次验证所选用户存在于通讯录，不能信任前端传入的用户 ID。
- 员工工资条入口仅在移动端钉钉内展示；服务端仍以钉钉免登身份做数据访问控制，不能把客户端显示限制作为授权边界。
- 钉钉工资通知使用旧工作通知接口已验证可投递的 `link` 消息，包含工资条图片缩略图和明细跳转。该接口拒绝当前尝试过的 `action_card` 载荷；如需更大的原生卡片，必须先切换并验证另一套受支持的钉钉卡片 API，不能在此接口上继续猜测字段。
- 单条撤回只记录本地最新投递状态、审计和存证；当前工作通知 API 不提供可依赖的远程撤回能力。

## 可观测性与安全

- 导入预览和最终提交都要记录可审计的计数型事件，不记录工资金额、银行卡号或其他敏感字段。
- 导入、通讯录匹配、通知发送发生异常时必须将错误返回给调用方并记录结构化上下文；禁止静默降级或伪造成功。
- 生产数据库为 SQLite 时，新增字段必须提供兼容旧库的迁移路径。

### 强制安全边界

- 员工 DTO 必须由服务端按当前钉钉身份隔离，只能返回本人数据。
- `visibleFields` 必须在服务端过滤，隐藏工资字段不得离开员工接口。
- Session 有效期为 8 小时；Cookie 必须使用 HttpOnly、SameSite，并在生产 HTTPS 下启用 Secure。
- 工资字段落盘使用 AES-256-GCM；日志、错误、审计 metadata 不得记录工资金额、工资字段、银行卡号、身份证号、密钥或 AppSecret。
- 撤回只表示本应用内撤销访问并记录本地状态/存证，不得声称已远程删除钉钉通知。
- delivered 不得意外重复发送；重发/重试必须遵守当前 delivery/service 规则；批次统计必须满足 `sent <= total`。
- 生产必须使用 HTTPS 和部署目录外的 SQLite 绝对路径。
- 员工只可访问最近 12 个月工资条；更早批次进入加密归档，只有有权管理员可访问。
- 归档工资不得通过正常工资编辑流程修改。

### 技术栈和钉钉边界

继续使用 Fastify、React、TypeScript、SQLite/WAL、Vitest、Vite、pnpm workspace 和普通 CSS。未经用户另行授权，不引入 Redis、PostgreSQL/MySQL、ORM、消息队列、Redux、React Query、新 Router、Tailwind、CSS Modules、styled-components 或复杂 DDD/CQRS/Event Sourcing 分层。

新增 runtime dependency 必须说明必要性；能用现有依赖或标准库解决时，不新增依赖。

当前已验证的工资触达方式是工作通知 `asyncsend_v2` 的 `link` 消息；本项目不使用 DING。互动卡片是独立的未来功能，不得在旧接口上猜测 `action_card` 载荷。未完成 OAuth/token/调度链路前，不得启用或声称“未查看/未确认待办”已启用。

### 架构依赖方向

- `packages/domain` 只依赖领域类型和纯逻辑；`packages/db` 只依赖 domain 与 SQLite/Node；`packages/dingtalk` 不依赖应用层或数据库；`apps/web` 不依赖服务端、数据库或钉钉客户端包；`apps/worker` 不依赖 API、Web 或钉钉客户端；任何 `packages/**` 不得依赖 `apps/**`。
- 未经明确授权，不新增 ORM、缓存、消息队列、状态管理或路由基础设施依赖。授权新增依赖时必须同步更新本文件、架构检查规则和架构决策记录。
- `pnpm architecture:check` 是依赖方向和禁止基础设施的 hard-fail 检查；文件规模与跨 CSS 重复仅输出 warning，不得为消除 warning 做无关重构。

## 文件与抽象纪律

- 大文件只有在存在真实职责边界时才拆；文件规模 warning 是检查信号，不是机械拆分命令。
- 不要把一个完整概念切成大量 50–80 行文件来追求“漂亮目录”。
- 能直接复用 `@salary/domain` 的稳定类型时，不在 Web/API 再复制一份等价类型。
- UI capability（例如是否可删/可改/可撤回）若属于业务规则，应以服务端/domain 为权威；前端只展示，不自行猜规则。
- 共享组件只在语义真正相同的场景复用；不要为了 DRY 把不同业务语义强行合并。

## CSS 纪律

- 继续使用普通 CSS，不引入 Tailwind/CSS Modules/CSS-in-JS。
- 优先使用可搜索的语义 class 和少量语义 token；避免靠 DOM 第几个元素、复杂 nth-child 或 cascade 猜测表达业务含义。
- 公共样式放 `base.css` / `components.css`，业务页样式放对应 feature stylesheet。
- 全局元素 selector（例如 `table`, `th`, `td`）应谨慎，避免意外影响无关页面。
- 跨文件重复 selector 由架构检查提示；同文件重复定义也应主动清理。

## 变更纪律

1. Fail fast：不隐藏或吞掉错误。
2. Fix the cause：定位根因，避免针对表象打补丁。
3. 关键路径必须可追踪、可调试。
4. 技术栈、产品方向或长期业务规则变更时同步更新当前真相文档。
5. 大规模重构或实验性修改前先切出 `codex/` 前缀分支，避免影响主线。
6. 不顺手重构与当前任务无关的区域。
7. 不为未来假设需求提前加框架、层或依赖。

## Agent 执行协议

开始普通任务时：

1. 读 `AGENTS.md`。
2. 读 `docs/ARCHITECTURE.md`。
3. 用 `docs/AI_INDEX.md` 找到该任务应先看的文件。
4. 涉及工资业务语义时读 `docs/BUSINESS_RULES.md`。
5. 读取相关实现和测试后再修改。

只有在需要追溯历史设计/旧 Phase 时才读：

- `CODEX_TASKS.md`
- `docs/superpowers/specs/`
- `docs/superpowers/plans/`
- `docs/history/`

## Git 和验证纪律

- 开始重要任务前确认当前 branch/main 基线和工作区状态。
- 保护用户已有未提交修改；禁止 `git reset --hard`、`git clean -fd`、覆盖或回滚用户代码。
- 未经用户明确授权，不 push、merge 或 deploy；需要大规模改动时先创建 `codex/` 前缀分支。
- 行为 bug 必须测试先行：先增加失败回归测试，确认修复前失败，再做最小修改。
- 完成前运行目标测试、相关测试、`pnpm architecture:check`、`pnpm test`、`pnpm typecheck`、`pnpm build` 和 `git diff --check`；如果仓库启用了 `format:check`，同时运行它。
- 命令未实际成功不得报告为通过。
