# Project Format

Each novel is a folder. v1.0 RC layout:

```text
project.novel.json          # 项目元数据（schemaVersion 0.1.0）
outline.json                # 分卷/章节大纲
chapters/volume-XXX/ch-XXXX.md
summaries/                  # 章节摘要
characters/<id>.json        # 人物（每实体一文件）
world/<id>.world.json       # 世界观条目（含地点/势力/组织等类型；旧散置 .md 会被读取）
timeline.json               # 事件（时间线/事件页共用）
clues.json                  # 伏笔
terms.json                  # 术语
conflicts.json              # 冲突（v1 新增）
prompts/*.prompt.json       # 提示模板
exports/                    # 导出产物（可清理）
.inkforge/                  # 应用状态（不建议提交进作品仓库）
  app-state.json / cache.json
  backups/<snapshot>/manifest.json + project/   # 快照（含章节 sha256 清单）
  backup-settings.json      # 备份间隔/保留/磁盘上限/外部目录
  chapter-history/<file>/*.md                   # 章节历史版本（每章最多 50 个）
  writing-workspace.json    # 批注/待修改标记/书签/写作会话/灵感片段
  revision-state.json       # 修订工作台处置状态
  export.json               # 导出与 EPUB 配置
  agent-extensions.json     # 提示词包/权限包/自定义工具/成员/任务与工作流模板
  agents/chat/<chapterId>.json                  # Agent 会话与提案（保存时压缩到最近 240 条消息）
  agents/traces/…           # 运行追踪（含授权决策日志）
  quality/<chapterId>.json + baselines/         # 质量报告与基线
  story-branches.json / batch-runs.json / simulations/ / planning-sessions.json
```

## Schema Versioning

所有核心 schema 固定 `schemaVersion: "0.1.0"`（zod literal）。v1.0 RC 冻结该版本：
新增字段一律带默认值（旧文件可直接解析），未提供 breaking 迁移框架。
`.inkforge/` 下的旁车文件（backup-settings/export/revision-state 等）不携带版本号，
同样只做带默认值的增量演进。

## Git Guidance

Track:

- `project.novel.json`, `outline.json`
- `chapters/**/*.md`, `summaries/*.json`
- `characters/*.json`, `world/*`
- `timeline.json`, `clues.json`, `terms.json`, `conflicts.json`
- `prompts/*.prompt.json`

Ignore:

- `.inkforge/`（本地状态、备份、缓存与 Agent 会话）
- `exports/`（可再生成）
