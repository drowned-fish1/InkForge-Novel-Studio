# InkForge v1.0 RC 实施状态（接力文档）

> 本文档是 v1.0 Release Candidate 推进的唯一进度事实来源。每完成一个阶段立即更新。
> 基线提交：`87ff6cf`（typecheck 通过，29 个测试文件 / 233 个测试全部通过）。

## 验证命令

```bash
npm run typecheck   # 先构建 4 个 workspace 包再对 desktop 双 tsconfig 检查
npm test            # vitest 全量
npm run lint
npm run build
npm run test:desktop-smoke
```

环境注意（详见 memory/nova-stdio-env-quirks.md）：

- `node_modules/@inkforge/*` junction 断裂时重跑 `npm install`；
- tsc 偶发 0xC0000005 崩溃，重试一次；
- 仓库基线非 prettier-clean，只格式化自己改的文件；
- 浏览器开发模式端口 5273（`.claude/launch.json` 的 `desktop-web`）；
- **每个新增 `InkforgeApi` 方法必须同步实现 `src/lib/browserBridge.ts` 镜像**，否则 bridge Proxy 直接拒绝。

## 架构速览（已核实）

- monorepo：`apps/desktop`（Electron+React+zustand）+ `packages/{schemas,prompt-engine,ai-provider,agent-engine}`。
- 渲染层功能在 `apps/desktop/src/features/*`，主进程服务在 `apps/desktop/electron/services/*`，IPC 由 `main.ts` 注册、`preload.ts` 暴露、`types.ts` 定义 `InkforgeApi`。
- 项目数据为文件夹格式（`project.novel.json` / `outline.json` / `chapters/**.md` / `.inkforge/*`），schema 版本 `0.1.0`（`z.literal`，无迁移机制——阶段七需处理）。
- 备份：`WorkspaceService`，10 分钟自动快照、上限 20 个、恢复前自动建保护点；快照为整目录复制存于 `.inkforge/backups/<id>/project`。
- 写作工作区：`.inkforge/writing-workspace.json`（批注/书签/写作会话，均已有 schema）。
- Agent：20 个工具名（get_* 只读 / propose_* 提案），`AgentChangeProposal`（append/replace/patch + baseContentHash + snapshotId 回滚）与 `AgentDataProposal`（8 类实体 upsert）双提案通道；`AgentRunTrace` 记录 usage 与事件。
- 导出：`ExportService` 已支持 markdown/txt/docx/epub（EPUB3 基础：nav+opf+spine，两种 css 主题；无封面/版权/分卷层级/导出前检查/配置持久化）。
- 导航：`ProjectNav` 四组模块；占位模块 = `locations/factions/conflicts/events`（AppShell `placeholderModules` 还含 `export`，但 export 实际渲染 `ExportPanel`）。

## 阶段总览

| 阶段 | 状态 | 提交 |
| --- | --- | --- |
| 0. 审计 + 本文档 | 完成（8 代理并行审计，差距摘要见下） | 与阶段一同提交 |
| 1. 人工写作工作台 | 完成（浏览器实测验证通过） | 见 git log |
| 2. 备份/恢复/草稿 | 完成（浏览器实测验证通过） | 见 git log |
| 3. 故事资料关系中心 | 未开始 | - |
| 4. 集中修订工作台 | 未开始 | - |
| 5. Agent 控制与扩展 | 未开始 | - |
| 6. EPUB 与交付 | 未开始 | - |
| 7. 发布级质量收口 | 未开始 | - |

## 阶段一：已完成内容（2026-07-27）

- 导航模块更名为“章节写作台”（ProjectNav + keybindings label）。
- Agent 面板可收起：TopBar 常驻 Bot 按钮切换，`localStorage inkforge:agent-collapsed:v1` 记忆；收起时不渲染面板与拖拽柄，`.studio-main.agent-collapsed` 切三列网格。
- 写作模式标题跳转：`listMarkdownHeadings`（chapterContent.ts，跳过代码围栏，含 offset/line）+ 工具栏“标题”下拉，点击定位光标并滚动到 1/3 视口处。
- Markdown 快捷键：正文内 Ctrl+B 加粗 / Ctrl+I 斜体（stopPropagation 压过全局 Ctrl+B 专注切换，编辑器外 Ctrl+B 仍为专注）；新增引用段落（行前缀）按钮。
- 打字机滚动独立开关（工具栏，`inkforge.typewriterScroll` 持久化），普通写作模式复用 caret-mirror 居中；段落聚焦保持专注模式内。
- 待修改标记：`WritingAnnotationSchema` 新增 `kind(comment|revision)` + `status(open|resolved|deferred)`（zod default，旧数据兼容，有 schema 测试）；工具栏“待修改”按钮（rose 色），批注书签页三列（批注/待修改/书签），支持解决/重开/删除，已解决划线置灰。
- 写作统计页签：今日字数/分钟、本章进度、累计人工字数与时长、最近 7 天条形列表（来自 writing-workspace sessions）。
- 工具栏动作改读 textarea 实时选区（`readLiveSelection`），修复 React 状态滞后于程序化选区/IME 的问题。
- 修复 useProjectStore.ts:488 GBK 乱码错误文案 → “历史版本恢复失败”。

验证：typecheck ✅ / 239 tests ✅ / lint ✅ / 浏览器预览逐项功能实测 ✅（标题跳转光标精确定位、Ctrl+B 不再误触专注、折叠状态刷新后保持、统计页渲染、待修改标记全生命周期）。

## 阶段二：已完成内容（2026-07-27）

- **备份设置**：`BackupSettingsSchema`（间隔/保留数/磁盘上限 MB/自定义目录），存 `.inkforge/backup-settings.json`；自定义目录必须是项目外绝对路径，按 `<项目名>-<路径hash8>` 建子目录；恢复时保留备份根目录与设置文件（`preservedRestorePaths`）。
- **快照元数据**：manifest 增加 `chapterHashes`（chapters/**.md 的 sha256）与 `changedChapterFiles`（对比上一快照，含增/改/删）；旧快照靠 zod default 兼容。
- **完整性检查**：`backup:verify` 重算章节哈希+文件数/大小对账；损坏快照目录由 `backup:inspect` 单独列出（不再静默隐藏）。
- **恢复前差异**：`backup:diff` 汇总（回退/删除/找回章节 + 元文件变化），`backup:read-file`（防穿越）+ 渲染层 `diffTextLines`（LCS，>4M 单元格退化为前后缀裁剪 diff）逐章行级预览；确认后才恢复。
- **磁盘上限**：createBackup 后按时间序淘汰最旧自动快照直到达标（手动/恢复保护点与刚建快照不淘汰）。
- **损坏项目恢复**：新 IPC `project:inspect` / `project:choose-folder`；ProjectStart 打开失败或结构检查不过时展示恢复面板（列出该目录快照，恢复后重开；仍损坏则提示换更早快照）。
- **草稿箱**：三页签（章节草稿/历史版本/灵感片段）。章节多选批量归档/恢复/改状态/移动分卷（`batchUpdateChapterPlans`/`batchMoveChapters`，单次 updateOutline 提交）；新增"已归档"筛选。
- **聚合历史**：`chapter:history:overview` 单次 IPC 聚合全部章节历史（消除 N+1）；按时间排序跨章列出，行级差异预览（历史→当前），可恢复。
- **灵感片段**：`InspirationFragmentSchema` 入 writing-workspace；CRUD/标签/归档/一键转为章节（建章+写入内容+改标题）。
- **Agent 读取门控**：`executeTool` 接收 `excludedSourceKeys`，get_story_bible/search_project/semantic_search/get_chapter_memory 全部过滤被排除资料（此前仅提示词上下文过滤，工具可绕过）。
- 共享 `mutateWritingWorkspace`（writingWorkspaceStore.ts）供编辑器与草稿箱串行化写工作区文件。
- 新增测试：WorkspaceService（设置校验/哈希与变更章节/防篡改校验/差异/恢复保留设置/磁盘淘汰）、ChapterService（历史写入/跳过未变/恢复/聚合/非法 id）、textDiffLines。

验证：typecheck ✅ / 254 tests ✅ / lint ✅ / 浏览器实测（备份创建与设置卡、草稿批量栏、聚合历史差异 +1/-1 精确、灵感片段创建并转为章节全流程）✅。

已知限制：浏览器预览的备份为内存模拟（恢复/差异仅桌面版真实）；备份自定义目录选择依赖桌面对话框。

## 审计差距摘要（阶段二至七实施依据）

完整差距清单见审计输出（scratchpad/audit-gaps.txt，270 行）。关键结论：

### 阶段二（备份/草稿）
- 备份频率(10min)/保留(20)为硬编码常量，无设置 schema/IPC/UI，无磁盘上限；快照为全量复制（含 exports/.inkforge 缓存），体积复利。
- 无变更章节元数据、无恢复前差异、无完整性校验（manifest 无 checksum）；损坏项目无法走 `project:open`（inspectProject 硬失败）恢复备份。
- DraftCenter 仅单条操作；无批量多选；moveChapter 不移动 .md 文件。
- 灵感片段无数据模型。听 diffLines(LCS) 已存在于 BranchService 可复用。
- 陷阱：restoreDirectory 只保留 backups 根，新增 `.inkforge` 设置文件会被恢复回滚，需加入保留集；listBackups 对 manifest parse 失败静默丢弃 → 新字段必须带 zod default。

### 阶段三（故事资料）
- locations/factions 数据已存在于 WorldEntry(type: location/faction/organization)；conflicts 无实体（仅散落文本字段）；events=TimelineEvent。
- 全部实体无删除能力（无 IPC/service/UI），引用全部是名字字符串（改名即断链）；RelationshipCenter 靠名字匹配。
- Agent 提案 action 仅 upsert（z.literal），加 delete/unlink 需向后兼容。
- ChatAgentService ~3800 行单体，加工具要同步 5 处（agentTools、AgentToolNameSchema、entityTypeByTool、toolLabel、UI toolLabels）。

### 阶段四（修订工作台）
- 无聚合入口；四类来源分散（批注/质量/连续性/提案）；QualityFinding 无 status 且 id 每次 randomUUID（需按 fingerprint+dimension+title 关联）；ConsistencyIssue 不持久化。
- 提案必须走 ChatAgentService.resolveChange/resolveDataChange（章节锁+hash 冲突检测+快照回滚），工作台不可直接写章节。
- 跨章节提案不可见（按章节文件存储）。BranchService.diffLines 可复用做差异。

### 阶段五（Agent 控制）
- 无发送前 token/费用估算（3 处估算逻辑不一致：chars/3 两处、CJK 加权一处，需统一 CJK-aware）；估算与真实 usage 混存不可区分（AgentRunUsage 需加 estimated 标记，带 default）。
- 无逐工具 per-call 授权（需在 runChat 循环加 pending-authorization map + 渲染层回复通道）；无权限决策日志。
- 工具清单四处重复硬编码；PipelineSchema 是死代码（无持久化/CRUD/导入导出）；无第三方工具机制。
- AgentService pipeline 单例内存态，cancel 不中止 AI 调用（runTask 未传 requestId）；UI 限额与服务端 clamp 不一致（32vs24, 30vs8）。

### 阶段六（EPUB/导出）
- EPUB3 基础已有（fflate 手工打包，nav/opf/spine，两主题 CSS）；缺封面（需二进制读取+媒体类型）、版权字段、分卷嵌套 TOC、NCX、页面分隔/字体/段距配置、导出前检查、配置持久化（建议 .inkforge/export.json 侧车避开 schemaVersion literal）、导出预览、输出验证。
- 桌面/浏览器双 EPUB 生成器分叉，建议抽共享纯函数模块。
- TopBar 快捷导出缺 EPUB；导出取消被误报为“未打开项目”。escapeXml 不转义单引号（当前安全，模板改动需注意）。

### 阶段七（收口）
- schemaVersion z.literal("0.1.0") 无任何迁移机制——bump 即炸所有旧项目；需迁移框架或冻结 0.1.0 并文档化。
- IPC 弱点：theme:set 未验证、project:reveal 任意路径 shell.openPath、sandbox:false、复杂输入无 zod 边界校验；无 session.setPermissionRequestHandler。
- 缺测试：ChapterService（数据丢失路径）、ExportService、SecureConfigService、FileRepository.assertInsideProject、React 组件层全空。
- 文档全面过期：dev-log 停在 2026-05-13、roadmap-next 仍列已实现功能、project-format.md 缺 .inkforge/* 全部文件。
- 死代码：AiCockpit（唯一 inkforge:close-settings 监听者，未挂载）、PlanningPanel 未挂载、ModulePlaceholder 的 outline/drafts/backup 条目不可达。
- 无签名证书/更新源（外部阻塞项）；无 CI；desktop-smoke 用已废弃 node --loader。
- 版本错位：app 0.2.1 vs packages 0.1.0 vs schema 0.1.0，v1 需统一 bump 策略。

## 技术决策记录

1. **批注扩展而非新实体**：待修改标记复用 WritingAnnotation（kind/status 带 default），旧 writing-workspace.json 无损解析；为阶段四修订工作台预留 deferred 状态。
2. **Ctrl+B 语义分层**：textarea 内=加粗（stopPropagation），textarea 外=专注模式；符合写作软件惯例且不破坏既有习惯。
3. **工具栏动作读实时选区**：editorRef.selectionStart/End 优先于 React 状态，消除程序化选择/IME 滞后。
4. **浏览器镜像强制**：browserBridge 显式标注 `InkforgeApi` 类型，typecheck 即镜像完整性门禁（沿用）。

## 下一步

1. 阶段二：备份设置（.inkforge/backup-settings.json，注意恢复保留集）、快照变更章节+差异、完整性校验、损坏项目恢复入口、草稿箱批量操作、灵感片段、聚合历史。
2. 之后按阶段三 → 七顺序推进，每阶段单独提交。
