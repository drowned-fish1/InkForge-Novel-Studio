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
- Agent：20 个工具名（get*\* 只读 / propose*\* 提案），`AgentChangeProposal`（append/replace/patch + baseContentHash + snapshotId 回滚）与 `AgentDataProposal`（8 类实体 upsert）双提案通道；`AgentRunTrace` 记录 usage 与事件。
- 导出：`ExportService` 已支持 markdown/txt/docx/epub（EPUB3 基础：nav+opf+spine，两种 css 主题；无封面/版权/分卷层级/导出前检查/配置持久化）。
- 导航：`ProjectNav` 四组模块；占位模块 = `locations/factions/conflicts/events`（AppShell `placeholderModules` 还含 `export`，但 export 实际渲染 `ExportPanel`）。

## 阶段总览

| 阶段                | 状态                                 | 提交           |
| ------------------- | ------------------------------------ | -------------- |
| 0. 审计 + 本文档    | 完成（8 代理并行审计，差距摘要见下） | 与阶段一同提交 |
| 1. 人工写作工作台   | 完成（浏览器实测验证通过）           | 见 git log     |
| 2. 备份/恢复/草稿   | 完成（浏览器实测验证通过）           | 见 git log     |
| 3. 故事资料关系中心 | 完成（浏览器实测验证通过）           | 见 git log     |
| 4. 集中修订工作台   | 完成（浏览器实测验证通过）           | 见 git log     |
| 5. Agent 控制与扩展 | 完成（浏览器实测验证通过）           | 见 git log     |
| 6. EPUB 与交付      | 完成（浏览器实测验证通过）           | 见 git log     |
| 7. 发布级质量收口   | 完成                                 | 见 git log     |

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
- **快照元数据**：manifest 增加 `chapterHashes`（chapters/\*\*.md 的 sha256）与 `changedChapterFiles`（对比上一快照，含增/改/删）；旧快照靠 zod default 兼容。
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

## 阶段三：已完成内容（2026-07-27）

- **统一事实来源**：地点=WorldEntry(location)，势力=WorldEntry(faction/organization)，事件=TimelineEvent，冲突=新 `ConflictSchema`（conflicts.json，kind/status/parties/stakes/relatedCharacters/relatedFactions/chapterIds）。四个"规划中"页面全部替换为完整功能页，导航"规划中"徽章清零。
- **四个新页面**：地点/势力（参数化 WorldSubsetLibrary：CRUD+搜索+类型/标签过滤+被引用面板+锁定）；冲突板（类型/状态筛选、各方、赌注、章节多选关联）；事件板（章节下拉、参与人物/地点 datalist、顺序、章节过滤）。
- **引用引擎**：纯函数 `findStoryReferences`/`detachStoryReferences` 抽到 packages/schemas/references.ts，主进程 StoryReferenceService 与浏览器镜像共用同一逻辑（含别名匹配、关系句内替换、world 标量位置字段、章节 characters/worldRefs）。
- **删除保护**：全部六类实体（人物/世界观/事件/伏笔/术语/冲突）新增删除；EntityDeleteDialog 引用检查 → 取消 / 解除引用后删除 / 替换为新名并删除；接入人物库、世界观库与四个新页面。
- **RelationshipCenter 重写**：节点覆盖人物/地点/势力/世界观/事件/伏笔/冲突/章节；边含冲突方、展开于章节、位于、出场等；选中节点显示出向引用+被引用双列表；类别筛选；章节节点可直接打开。
- **Agent 工具**：新增只读 `get_story_entities`（location/faction/conflict/event + 关键词，遵守 excludedSourceKeys）与提案 `propose_conflict_update`（走确认流，apply 合并更新 conflicts.json）；AgentDataProposal entityType + AgentSourceReference kind 增加 conflict（枚举扩展向后兼容）；默认成员导演/资料员获得新工具。
- WorldLibrary 类型下拉补齐 organization/skill/race；ModulePlaceholder 缩减为 export 转发 + unknown 诊断页（清除死条目）。
- 新增测试：references 纯函数（跨实体查找/unlink/replace/world 标量）、ConflictSchema 默认值、StoryStateService 冲突 CRUD 与删除（263 total）。

验证：typecheck ✅ / 263 tests ✅ / lint ✅ / 浏览器实测（导航无占位徽章、冲突创建保存、删除对话框正确列出引用并"替换并删除"后冲突各方自动改名、关系中心双向引用、四页全部渲染无控制台错误）✅。

已知限制：跨实体引用仍为名字字符串匹配（沿用现有数据格式，改名不自动同步——列入阶段七已知限制文档）；scene plans 的 clueRefs 未纳入引用检查。

## 阶段四：已完成内容（2026-07-27）

- **RevisionService**（electron）：单次 IPC `revision:overview` 聚合批注/待修改标记（含章节标题）、每章最新质量报告（分数+基线差+findings）、连续性检查结果、跨章节全部 pending Agent 提案（正文提案+数据提案，经 ChatAgentService.load 消毒加载）；处置状态存 `.inkforge/revision-state.json`（`RevisionStateSchema`，key 规则：annotation:<id> / quality:<chapterId>:<dimension>:<title>（规避 randomUUID 不稳定 id）/ continuity:<issueId> / proposal:<id>）。
- **修订工作台页面**（写作分组新模块 `revision`）：来源/状态/章节筛选、按严重度/时间/章节排序、搜索；行内接受/忽略/延期/恢复；多选批量处理；章节质量分速览条（分数+基线差，点击过滤该章）；章节跳转按钮。
- **动作语义**：批注/待修改 → 写回 writing-workspace 状态（接受=resolved，无忽略防误删）；质量/连续性 → 处置记录；提案接受/拒绝 → 走既有 `resolveAgentChange`/`resolveAgentDataChange`（保留章节锁、hash 冲突检测与快照回滚），正文提案应用后自动本地重评质量并展示分数与基线差。
- **前后差异**：提案差异按钮 → 加载完整提案 + 当前正文，append/replace/patch 三种模式合成前后文本，渲染层 diffTextLines 行级预览。
- 全流程无 AI 可用（质量评估为本地规则引擎；提案来源可为空）。
- 浏览器镜像：revisionOverview/setRevisionDisposition（内存态，聚合浏览器各 mock 源）。
- 新增测试：RevisionService 聚合（注入 mock AI 断言绝不调用）与处置 upsert（265 total）。

验证：typecheck ✅ / 265 tests ✅ / lint ✅ / 浏览器实测（待修改标记创建→工作台聚合显示章节链接→接受→"已接受"状态过滤可见）✅。

## 阶段五：已完成内容（2026-07-27）

- **工具注册表（唯一事实来源）**：`agentToolRegistry`（schemas）以 `Record<AgentToolName,{label,kind:read|proposal}>` 定义全部 22 个工具；服务端 agentToolNames/proposalToolNames/toolLabel 与 UI toolLabels/readOnlyTools 全部派生；TS 完备性+测试双保险（注册表 === 枚举、propose*\* 必为 proposal）。第三方/自定义工具只能引用注册表内工具名（zod 枚举强制），写操作只能经 propose*\* 提案通道。
- **统一 CJK 估算器**：`estimateTokensCjkAware`（0.65/CJK 字符 + 0.25/其他）替换 chars/3；fitTextToTokens 迭代裁剪保证不超预算。
- **发送前估算**：`agent:chat:estimate` IPC 复用真实上下文构建（上下文+历史+消息+固定开销），返回输入估算/输出上限/分项，全部标记 estimated；Provider 配置新增可选输入/输出价格（每 1M tok，SecureConfig 持久化），填了价格则显示"费用 ≤ X（估算值）"；写作面板输入 700ms 防抖展示。
- **估算标记**：`AgentRunUsage.estimated` 字段（默认 false）；provider 未返回 usage 的回退估算全部打标；运行追踪 Token 指标显示"（含估算）"。
- **逐工具"每次询问"**：权限面板每个工具双列（允许 / 每次询问）；运行时在调用前发 `tool_approval_requested` 事件（callId+参数预览），等待 `agent:chat:approve-tool`（3 分钟超时=拒绝，取消运行即拒绝）；拒绝写入 tool 消息并让模型换路继续；批准/拒绝以 `tool_approval_resolved` 事件持久化在运行追踪（权限决策日志）。修复了"注册等待前先发事件"的秒批竞态。
- **失败恢复/取消/并发**：AgentService 流水线 runTask 全部经 `runPipelineTask` 注入 requestId，cancelPipeline 现在真正中止在途 AI 调用；聊天 turn/toolCall clamp 与 UI 上限对齐（12/32）。
- **长会话治理**：会话保存时压缩到最近 240 条消息（提案/分支/协作记录永不丢弃，分支锚点缺失时按既有回退逻辑降级）。
- **模板导入导出**：AgentExtensionConfig 新增 `taskTemplates`（含模式，作曲器"存为模板"一键保存、模板下拉可用）与 `workflowTemplates`（Pipeline schema，随扩展 JSON 导入导出；工作流面板列出并可执行——已知步骤类型映射真实链路，未知类型直通跳过并在 UI 说明）。提示词包沿用既有 promptPresets 导入导出。
- 压力/回归测试：注册表覆盖、估算器、会话压缩、逐工具拒绝端到端（mock AI）、estimateRun 预算约束与费用（271 total）。

验证：typecheck ✅ / 271 tests ✅ / lint ✅ / 浏览器实测（估算行显示并标记估算值、22 工具双列授权与"1 个逐次询问"摘要、存为模板按钮）✅。

已知限制：费用估算依赖用户填写单价（无内置价目表）；输出费用按模型上限计为上界；自定义工作流的未知步骤类型不执行真实动作。

## 阶段六：已完成内容（2026-07-27）

- **导出配置持久化**：`ExportConfigSchema`（schemas）存 `.inkforge/export.json`（避开 schemaVersion literal）：书名/作者/语言/简介/出版方/版权声明/封面路径/主题/行距/段首缩进/分卷成页 + 分卷/章节标题开关；ExportPanel 加载编辑保存，TopBar 快捷导出（含新增 EPUB 项）走同一份配置。
- **EPUB 3 完整生成**（`buildEpubArchive`，可测纯函数）：封面页+封面图（JPG/PNG 二进制嵌入，`properties="cover-image"` + 旧阅读器 `<meta name="cover">`）、版权页（dc:rights/dc:publisher 同步写入 OPF）、分卷标题页（分页规则）、分卷嵌套 nav TOC + landmarks + 兼容旧阅读器的 NCX（spine toc）、按卷/章的回退编号、URN 标识符、escapeXml 补齐单引号转义、配置化 CSS（主题/行距/缩进）。
- **导出前检查**：`runExportPreflight` 纯函数（schemas，浏览器镜像共用）：空章节（error）、重复章节/分卷标题、会被移除的相对链接、正文图片引用、封面缺失（error）、元数据提示；EPUB 导出前自动运行并在有 error 时阻断。
- **导出后验证**：`validateEpubArchive` 解包校验必需文件/mimetype/manifest↔spine↔实体一致性 + 自研 XML 良构检查器（标签配对/自闭合/裸 &）；校验不过导出即报错（修复了检查器把 XML `<meta>` 误当 HTML 空元素的缺陷）。
- **统一体验**：导出预览（卷章树+字数+封面/版权摘要）、取消不再误报为错误、DOCX 分卷/章节自动分页（pageBreakBefore）、TopBar 增加 EPUB。
- 浏览器镜像：配置存取/preflight（共享纯函数）/封面选择提示走桌面版。
- 测试：EPUB 构建（封面/版权/嵌套 TOC/NCX/回退编号/转义）、结构校验（manifest 缺失检出）、XML 良构检查器、markdown→XHTML 渲染安全性、preflight 全类别（277 total）。

验证：typecheck ✅ / 277 tests ✅ / lint ✅ / 浏览器实测（导出预览结构树、导出前检查 2 项提示、配置面板齐全）✅。

已知限制：浏览器预览的 EPUB 生成仍为降级实现（无封面/NCX，用于界面演示；桌面版为完整实现）；正文图片不嵌入（预检查会提示）。

## 阶段七：已完成内容（2026-07-27）

- **死代码与过时文案**：删除未挂载的 AiCockpit.tsx 与 PlanningPanel.tsx（Esc 关闭设置事件改由 AgentChatPanel 监听，恢复了此前失效的快捷键路径）；roadmap-next 重写为"已完成 + v1 后候选方向"；dev-log 补 v1 条目；project-format.md 更新为真实 v1 布局（含全部 .inkforge/\* 文件与版本策略）；README 全面刷新（移除 placeholder 文案）；新增 docs/user-guide.md 与 docs/release-windows.md；dev-guide 补质量门禁与镜像/注册表规则。
- **安全加固**：`theme:set` 输入校验；`project:reveal` 仅允许最近项目列表内路径（阻断任意路径 shell.openPath）；`session.setPermissionRequestHandler` 默认拒绝全部权限请求；FileRepository.assertInsideProject 新增穿越/绝对路径/同前缀兄弟目录攻击测试与原子写测试。sandbox 保持关闭（ESM preload 限制，见已知限制）。
- **测试补齐（本轮累计新增）**：ChapterService、ExportService（EPUB 构建/校验/渲染）、StoryStateService、references 引擎、RevisionService、AgentControl（注册表/估算/压缩/逐工具拒绝）、WorkspaceService 扩展、FileRepository、textDiffLines、schemas（workspace/conflict/export）。
- **desktop-smoke 扩展**：mock loader 补 session/openExternal；smoke 现覆盖 15 项真实构建主进程端到端检查（建项目→写作+历史→四格式导出（EPUB 结构断言）→备份创建/校验/差异/快照读取/保护性恢复→备份设置→冲突 CRUD+引用保护替换删除→修订聚合与处置→无 Provider 发送前估算→导出配置+preflight→项目完整性检查→密钥不落项目目录）。
- **真实桌面启动**：以构建产物直接启动 Electron，12 秒存活无任何错误输出后正常退出。
- **版本策略**：root 与 apps/desktop 升至 `1.0.0-rc.1`；packages/\* 保持内部 0.1.0；项目数据 schemaVersion 冻结 0.1.0（新增字段一律带 zod 默认值，旧项目直接可开——由全部 schema 测试与 smoke 的 reopen 流程验证）。
- **Windows 发布**：`docs/release-windows.md` 记录构建命令、安装包验证清单、签名接入（certificateFile / signtoolOptions / azure）与 electron-updater 更新源接入步骤；证书与更新源为外部阻塞，不影响本地打包（`npm run dist:windows` 可用）。

---

# Post-1.0 拓展记录

## 拓展一：发布闭环与规模验证（2026-07-27）

- **CI**：`.github/workflows/ci.yml` — push/PR 触发，windows+ubuntu 矩阵跑 lint/typecheck/test/desktop-smoke；主分支追加未签名 Windows 安装包构建并上传工件（签名接入仍待外部证书，见 release-windows.md）。仓库当前无远端，推送到 GitHub 即生效。
- **规模压测**：`npm run perf:probe`（scripts/perf-probe.mjs，复用 smoke 的真实主进程）生成 4 卷 × 100 章 × 7000 字（约 280 万字）项目并计时热路径。
- **压测结论与修复**：唯一热点为 `revision:overview`（逐章 `chatAgent.load` 各自重新解析整个项目，1446ms）；新增 `ChatAgentService.listExistingSessions`（单次会话目录扫描，跳过损坏文件，不触碰 project/outline 解析），RevisionService 改用后 **1446ms → 36ms**。其余路径在 400 章规模全部健康：重开 9ms、单次大纲编辑 ~140ms、全量备份 1.5s/7.6MB、校验 194ms、导出检查 106ms、聚合历史 85ms。
- 验证：typecheck ✅ / 281 tests ✅ / lint ✅ / desktop-smoke ✅ / 探针前后对比 ✅。

# 最终交付摘要（v1.0-rc.1）

## 提交列表（基线 87ff6cf 之后）

| 提交       | 阶段   | 内容                                                                       |
| ---------- | ------ | -------------------------------------------------------------------------- |
| b945891    | 阶段一 | 章节写作台（标题跳转/快捷键/打字机/待修改标记/统计/Agent 面板收起）        |
| 5c93998    | 阶段二 | 备份设置/校验/差异/损坏恢复 + 草稿批量/聚合历史/灵感片段 + Agent 读取门控  |
| dd5ad18    | 阶段三 | 地点/势力/冲突/事件页面 + 引用引擎与删除保护 + 关系中心双向引用 + 实体工具 |
| c648352    | 阶段四 | 集中修订工作台（聚合/批量处置/差异/质量分变化）                            |
| 6bb2dae    | 阶段五 | 工具注册表/发送前估算/逐工具授权/取消修复/会话压缩/模板导入导出            |
| 2682136    | 阶段六 | EPUB 3 完整交付（封面/版权/嵌套目录/NCX/检查/校验/预览/持久化配置）        |
| （本提交） | 阶段七 | 安全加固/死代码清理/测试与 smoke 扩展/文档刷新/版本 1.0.0-rc.1             |

## 最终验证结果

- `npm run typecheck` ✅ · `npm run lint` ✅ · `npm test` ✅（37 文件 / 281 用例）
- `npm run build` ✅ · `npm run test:desktop-smoke` ✅（15 项端到端检查）
- 真实桌面启动 ✅ · 浏览器预览逐阶段人工实测 ✅ · 工作区干净（本提交后）

## 最终完成标准对照

- 左侧导航 18 个模块全部为完整功能页，无"规划中"占位 ✅
- 写作/资料/修订/备份/导出全部无 AI 可用 ✅（smoke 无 Provider 全通过）
- Agent 写操作全部走提案：可预览（含行级差异）、可确认、可撤销（快照回滚）、可追踪（运行追踪含授权决策日志）✅
- 旧项目安全打开：schemaVersion 冻结 + 全部新增字段带默认值 + 损坏项目备份恢复入口 ✅
- 质量门禁全绿、每阶段独立提交 ✅

## 已知限制（有意决策，非缺陷）

1. 跨实体引用为名字字符串（有引用检查/解除/替换保护；ID 化需数据迁移，列入 v1 后）。
2. Electron sandbox 关闭（ESM preload 限制；已用 contextIsolation/导航锁定/权限默认拒绝/reveal 白名单补偿）。
3. 浏览器预览的备份、EPUB 为降级演示实现（桌面版完整）。
4. 正文图片不嵌入导出（导出前检查会提示）。
5. 费用估算依赖用户填写单价，输出费用为上界估算。
6. Agent 提案生成与推演需要真实 Provider（应用/撤销链路已用 mock AI 测试覆盖）。

## 唯一剩余外部阻塞

**Windows 代码签名证书与更新源**：本地 NSIS 打包可用；公开分发所需的证书获取与更新源部署为外部条件，接入步骤已写入 docs/release-windows.md。

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
- 文档全面过期：dev-log 停在 2026-05-13、roadmap-next 仍列已实现功能、project-format.md 缺 .inkforge/\* 全部文件。
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
