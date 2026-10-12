<p align="center">
  <img src="./apps/desktop/build/icon.png" width="88" alt="InkForge 标志" />
</p>

<h1 align="center">InkForge 小说工坊 — 开源 AI 小说写作工具</h1>

<p align="center">
  本地优先的开源小说写作软件，整合 AI 写作助手、小说大纲、人物设定、世界观管理、Markdown 编辑与 EPUB 电子书导出。
</p>

<p align="center">
  Open-source, local-first novel writing software with optional AI assistance and ebook export.
</p>

<p align="center">
  <a href="./README.md">English</a> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <a href="https://github.com/drowned-fish1/InkForge-Novel-Studio/actions/workflows/ci.yml"><img src="https://github.com/drowned-fish1/InkForge-Novel-Studio/actions/workflows/ci.yml/badge.svg" alt="CI 状态" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-0f766e" alt="MIT 许可证" /></a>
  <img src="https://img.shields.io/badge/status-v1.0.0--rc.1-c58b3a" alt="v1.0.0 RC 1" />
  <img src="https://img.shields.io/badge/platform-Windows-2563eb" alt="Windows" />
</p>

<p align="center">
  <a href="#快速开始">快速开始</a> ·
  <a href="#产品一览">产品一览</a> ·
  <a href="./docs/user-guide.md">用户指南</a> ·
  <a href="./docs/architecture.md">架构</a> ·
  <a href="./docs/roadmap-next.md">路线图</a>
</p>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./docs/assets/readme/writing-workspace-dark.png" />
  <img src="./docs/assets/readme/writing-workspace-light.png" alt="InkForge 章节树、Markdown 编辑器与作者可控 Agent 面板组成的写作工作台" />
</picture>

> [!IMPORTANT]
> InkForge 当前处于 **v1.0 候选发布阶段**。应用已可使用并有自动化测试覆盖，但公开 Windows 构建尚未签名，可能触发 SmartScreen。详情见[项目状态](#项目状态)。

最新 Windows 安装包见 [v1.0.0-rc.5 预发布页](https://github.com/drowned-fish1/InkForge-Novel-Studio/releases/tag/v1.0.0-rc.5)。该发布包含比当前默认分支源码更新的功能；如需从源码构建 RC5，请切换到对应标签。

## 为什么是 InkForge

| 作品始终属于你                                                                               | AI 始终受你控制                                                                        | 一处管理整部长篇                                                             |
| -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 章节、大纲、故事资料、历史与备份都保存在你选择的文件夹中。核心写作流程不需要账号或 API Key。 | Agent 写入只会生成提案：先看差异，再接受或拒绝；操作过程可追踪，确认后的修改也可回滚。 | 写作、规划、连续性检查、资料管理、跨章修订、备份和交付不再散落在多个工具里。 |

InkForge 专注于**个人长篇小说创作**，有意不加入账号、云同步、付费系统、广告与团队权限。

你可以用 InkForge 完成：

- **小说写作与网文创作：**撰写章节、规划整书大纲、跟踪写作进度，并修订长篇稿件。
- **人物设定与世界观管理：**把人物卡、人物关系、时间线、伏笔和故事背景放在正文旁，减少资料来回查找。
- **AI 辅助写作与电子书制作：**连接 Ollama 或 OpenAI 兼容模型辅助续写和修订，导出 Markdown、TXT、DOCX 或 EPUB。

核心写作功能可离线使用，不需要配置模型。AI 任务需要可访问的模型服务，可以使用本地 Ollama，也可以连接远程 Provider。

## 产品一览

### 带着上下文与 Agent 一起写

写作台整合 Markdown 编辑器、章节目标、搜索、批注、待修改标记、书签、写作统计和可折叠 Agent 面板。多个 Agent 角色可以在授权范围内读取资料、协同调用工具，并返回由作者审核的修改提案。

![InkForge 写作台中的多 Agent 协作](./docs/assets/readme/multi-agent-collaboration.png)

### 审视整部作品，而不只是一页正文

运行确定性的本地质量评测，比较章节基线，检查连续性与引用一致性，并在统一修订流程中汇总批注、问题和待处理提案。这些检查不依赖 AI。

![InkForge 小说质量评测与历史基线](./docs/assets/readme/quality-review.png)

## 已包含的能力

| 领域       | 能力                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------- |
| 写作       | CodeMirror Markdown 编辑器、章节树、专注/打字机模式、查找替换、标题跳转、批注、待修改、书签、写作统计与崩溃恢复草稿 |
| 故事规划   | 分卷与大纲、人物、世界观、地点、势力、事件、时间线、伏笔、术语、冲突和双向关系视图                                  |
| 修订       | 全项目质量巡检、连续性与引用检查、集中处置、提案差异、不可变质量基线与剧情分支                                      |
| Agent 控制 | OpenAI 兼容 Provider、多角色 Agent、工具授权、Token/费用估算、取消、追踪记录、模板与仅提案写入                      |
| 交付       | 自动快照、完整性校验、保护性恢复，以及 Markdown/TXT/DOCX 和带封面、元数据、分卷目录、NCX、排版配置的 EPUB 3 导出    |

完整操作说明见[用户指南](./docs/user-guide.md)。

## 快速开始

### 环境要求

- Node.js 22
- npm 10 或更高版本
- 打包桌面版需要 Windows；浏览器开发预览可在其他平台运行

### 从源码运行桌面应用

```bash
git clone https://github.com/drowned-fish1/InkForge-Novel-Studio.git
cd InkForge-Novel-Studio
npm ci
npm run desktop
```

使用模拟桌面服务运行浏览器预览：

```bash
npm run dev
```

构建本地 Windows 应用目录或未签名 NSIS 安装包：

```bash
npm run pack:desktop
npm run dist:windows
```

公开分发前请阅读 [Windows 发布指南](./docs/release-windows.md)。

## 隐私与 AI 边界

- 不配置 Provider，也可以使用写作、规划、修订、备份和导出等全部非 AI 流程。
- 小说数据保存在用户选择的项目文件夹中；Provider 凭据不会写入小说项目或渲染层存储。
- 只有作者主动发起 AI 任务时，相关写作上下文才会被发送。
- Agent 工具严格区分读取与写入；写入只生成待确认提案。
- AI 输出始终按不可信文本处理，不会作为可执行指令运行。

内置预设覆盖 OpenAI、Gemini 的 OpenAI 兼容端点、Ollama、兼容的 Claude 网关、DeepSeek 及其他 OpenAI 兼容服务。工具调用能力取决于具体模型。

更多细节见 [Agent 协议](./docs/agent-chat.md)、[提示词系统](./docs/prompt-system.md)和[安全策略](./SECURITY.md)。

## 架构

```text
React 渲染层
  → context-isolated preload bridge
  → Electron 主进程服务
  → 本地 Markdown / JSON 项目文件夹
  → 可选 OpenAI 兼容 Provider
```

项目采用 npm workspaces monorepo：

| 路径                     | 职责                                                    |
| ------------------------ | ------------------------------------------------------- |
| `apps/desktop`           | Electron 外壳、React UI、preload bridge、IPC 与桌面服务 |
| `packages/schemas`       | Zod schema 与共享项目契约                               |
| `packages/prompt-engine` | 提示词模板与渲染                                        |
| `packages/ai-provider`   | OpenAI 兼容传输层与错误处理                             |
| `packages/agent-engine`  | 上下文编译、流水线、审阅与 Agent 会话逻辑               |

开发者可从[架构说明](./docs/architecture.md)、[开发指南](./docs/dev-guide.md)和[项目格式](./docs/project-format.md)开始。

## 开发与验证

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:desktop-smoke
```

CI 会在 Windows 与 Ubuntu 上运行相同门禁，并额外构建未签名 Windows 安装包供人工验证。

## 项目状态

InkForge 当前版本为 `v1.0.0-rc.1`，有以下已知且有意保留的限制：

- 当前只有 Windows 打包目标。
- 在获得代码签名证书与更新源前，公开构建均为未签名版本。
- 浏览器预览中的备份和 EPUB 是降级演示实现；Electron 桌面版提供完整实现。
- 章节 Markdown 引用的图片会在导出检查中提示，但暂不会嵌入导出稿件。

详细记录见[实施状态](./docs/v1-implementation-status.md)和 [v1 后候选方向](./docs/roadmap-next.md)。

## 参与贡献

欢迎提交 Issue 与边界清晰的 Pull Request。修改前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全漏洞请按照 [SECURITY.md](./SECURITY.md) 私下报告。

## 许可证

InkForge 基于 [MIT License](./LICENSE) 开源。
