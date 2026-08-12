# Development Log

## 2026-05-13

Implemented the initial v0.1 foundation from the Word development document.

### Scope

- Created monorepo-style workspace with `apps/desktop` and `packages/*`.
- Added Electron main/preload security boundary.
- Added React desktop writing cockpit UI.
- Added Zod schemas for project, outline, character, clue, timeline, term and prompt template data.
- Added local project creation/opening, chapter creation, chapter read/write and Markdown/TXT export IPC.
- Added browser demo bridge for renderer development without direct filesystem access.
- Added initial docs for scope, architecture, project format and prompt system.

### Known Gaps

- AI Provider configuration and streaming calls are scaffolded only.
- Character/world/timeline/clue/term CRUD views are represented in navigation but not implemented yet.
- DOCX export is planned for P0-7 and not included in this first pass.
- The editor uses a styled Markdown textarea; CodeMirror integration can be added in the chapter-editing phase.

### Next

- Implement P0-3 refinements: chapter rename/delete, volume operations, stronger autosave recovery.
- Implement P0-4 character cards and worldbuilding CRUD.
- Implement P0-5 secure provider settings in the main process.

## 2026-05-13 Continued

Extended the MVP toward P0-4.

### Scope

- Added `WorldEntrySchema` for structured worldbuilding records.
- Added `LibraryService` in Electron main process for character/world list and save operations.
- Exposed library IPC through preload without renderer filesystem access.
- Added character card editor with profile, state and voice-note fields.
- Added worldbuilding editor with type, tags, summary, content and locked-setting flag.
- Made the center workspace switch by module instead of always showing the chapter editor.
- Connected the AI cockpit quick references to real character/world library state.
- Added separate Markdown and TXT export controls in the top bar.

### Known Gaps

- Delete/rename flows are not implemented yet.
- Timeline, clues and terms still have placeholder screens.
- Character/world relation pickers are text-light for now; richer cross-linking belongs in the long-form management phase.

## 2026-05-13 Provider Settings

Implemented the P0-5 provider configuration foundation for user-supplied API keys.

### Scope

- Added provider config types for `bearer`, `x-api-key`, raw `Authorization`, and no-key modes.
- Added Electron `safeStorage` encrypted API key persistence under app user data.
- Kept renderer status redacted: it only receives provider name, base URL, model, auth mode, masked key and updated time.
- Added main-process OpenAI-compatible `/chat/completions` request execution with readable 401/403/404/429/5xx error messages.
- Added right-panel Provider Settings UI.
- Connected AI cockpit actions to the main-process AI task bridge, with browser demo fallback for UI testing.

### Security Notes

- API keys are not saved to `localStorage`.
- API keys are not written to novel project folders.
- The renderer sends a key only when the user submits the Provider Settings form; persistent storage is handled by the main process.

## 2026-05-13 AI Writing Workflow

Implemented the first P0-6 draft-confirmation loop.

### Scope

- Added `ChapterSummarySchema` for `summaries/*.summary.json`.
- Added `SummaryService` in the Electron main process.
- Extended AI task results with task metadata.
- Added `summary:save` IPC through preload.
- Added draft actions in the AI cockpit:
  - append AI draft to the end of the current chapter
  - save AI draft as a chapter summary
  - clear draft
- Kept AI output in the draft area until the author explicitly confirms a write action.

### Verification

- Typecheck and production build pass.
- Browser QA covered Provider setup, summary generation, summary save, continuation generation, append-to-chapter, and autosave.
- `localStorage` remains empty.

## 2026-05-13 DOCX Export

Implemented the P0-7 DOCX export foundation.

### Scope

- Added `docx` package to the desktop workspace.
- Extended export format types to support `docx`.
- Reworked `ExportService` to produce Markdown, TXT, or DOCX from the same ordered volume/chapter block list.
- Added DOCX output with document title, volume headings, chapter headings, Chinese-friendly paragraph indentation and page margins.
- Added a `DOCX` export action in the top bar.

### Notes

- DOCX export is generated in the Electron main process.
- Markdown/TXT behavior remains unchanged.

## 2026-05-13 P1-1 Local Check System

Started the long-form management and consistency-check phase.

### Scope

- Added `StoryStateService` in the Electron main process.
- Added IPC for:
  - `timeline.json`
  - `clues.json`
  - `terms.json`
  - local story inspection
- Added editable UI modules for Timeline, Clues and Terms.
- Replaced the Overview placeholder with project counts and local consistency findings.
- Added rule checks for missing timeline chapter links, bad chapter IDs, unresolved clues without payoff, duplicate terms and empty term definitions.

### Verification

- Typecheck and production build pass.
- Browser QA covered Overview, Timeline create/save, Clues view and Terms view.
- Console has no errors and `localStorage` remains empty.

## 2026-07-27

v1.0 Release Candidate：七个阶段将内部可用版本推进到发布候选（详见 docs/v1-implementation-status.md）。

### Scope

- 阶段一 章节写作台：标题跳转、编辑器内 Markdown 快捷键、独立打字机滚动、待修改标记生命周期、写作统计、Agent 面板收起记忆。
- 阶段二 备份与草稿：备份设置（间隔/保留/磁盘上限/外部目录）、快照哈希与变更章节、完整性校验、恢复前差异、损坏项目恢复、草稿箱批量操作、聚合历史差异、灵感片段、Agent 读取门控。
- 阶段三 故事资料：地点/势力/冲突/事件完整页面、共享引用引擎、全实体删除保护（取消/解除/替换）、关系中心双向引用、get_story_entities 与 propose_conflict_update 工具。
- 阶段四 修订工作台：跨来源聚合（批注/待修改/质量/连续性/提案）、接受-忽略-延期-恢复与批量、提案前后差异、应用后本地质量重评。
- 阶段五 Agent 控制：工具注册表唯一事实来源、CJK 统一估算器、发送前 Token/费用估算（明确标记）、逐工具每次询问授权与决策日志、流水线取消真正中止、会话压缩、任务/工作流模板导入导出。
- 阶段六 EPUB 交付：持久化导出配置、封面/版权页/嵌套目录/NCX、导出前检查与导出后结构+XHTML 校验、DOCX 分页、导出预览、取消不再误报。
- 阶段七 收口：死代码清理（AiCockpit/PlanningPanel）、theme:set 与 project:reveal 加固、权限请求默认拒绝、FileRepository 安全测试、smoke 扩展到 15 项真实主进程端到端检查、文档全量刷新、版本升至 1.0.0-rc.1。

### Quality Gates

- typecheck / lint / vitest（277+ 通过）/ build / desktop-smoke 全绿；浏览器预览逐阶段人工实测。

### Known External Blockers

- Windows 代码签名证书与更新源（见 docs/release-windows.md）。

## 2026-08-12 v1.0.0-rc.4 EPUB 导入

- 启动页新增 EPUB 2/3 导入，支持 OPF、spine、NAV/NCX、书名/作者/语言元数据和章节预览。
- XHTML 正文安全转为 Markdown，封面、目录、脚本、空页面与失效本地链接会过滤或降级；单正文文件支持按 H1/H2 拆章。
- 解析器同时运行于 Electron renderer 与浏览器模式，并增加压缩包规模保护及纯函数回归测试。

## 2026-08-12 v1.0.0-rc.3 内部技术收口

- 完成 renderer sandbox/CJS preload、页面级拆包、正文图片嵌入、稳定 ID 引用迁移、浏览器 EPUB 保真、可选更新状态机和 macOS/Linux 构建接入口。
- 保留旧名称引用作为回滚路径；浏览器与桌面均执行幂等迁移，重名不自动绑定。
- 版本提升为 `1.0.0-rc.3`；签名、实际更新源和目标平台人工运行仍需外部环境。
- 验证：格式/lint/typecheck/audit 全绿，53 文件/349 测试、16 项 desktop smoke、宣传片 bundle 通过；Windows unpacked sandbox 应用真实启动存活 10 秒且 stderr 为空。

## 2026-08-12 v1.0.0-rc.2 发布收口

### Scope

- 将长篇小说续写工作流与 2026-08-02 之前的发布修复正式纳入 RC2 基线。
- 修复 `nanoid` 新披露漏洞造成的生产依赖审计失败。
- 将 `promo-video` 作为独立工程接入 CI，隔离根工具链并补格式、lint/typecheck、审计与 bundle 门禁。
- 同步根应用与桌面应用版本、路线图、实施状态、Windows 发布指南、CHANGELOG 与发布说明。

### Verification

- 52 个测试文件 / 340 个用例通过。
- 桌面主进程 smoke 15 项通过。
- 生产依赖审计 0 漏洞；宣传片独立质量门禁全绿。
