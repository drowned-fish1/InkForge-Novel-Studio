# Changelog

本项目的重要变更记录于此。版本遵循语义化版本；小说项目数据的 `schemaVersion` 独立冻结为 `0.1.0`。

## [1.0.0-rc.4] - 2026-08-12

### Added

- 启动页支持导入 EPUB 2/3：读取 OPF 元数据、spine 阅读顺序，以及 NAV/NCX 目录标题。
- EPUB XHTML 正文可安全转换为 Markdown，并支持单个正文文件内按 H1/H2 拆分多个章节。
- 导入预览会显示书名、作者、章节数与解析提示；封面、目录、脚本、空页面和失效本地链接会安全过滤或降级。

### Changed

- `.epub` 与既有 `.md` / `.txt` 共用项目创建和章节落盘流程，桌面端与浏览器模式行为一致。
- EPUB 导入增加压缩包、文件数量、解压体积和单文档大小保护。

## [1.0.0-rc.3] - 2026-08-12

### Added

- 章节 Markdown 中的项目内 PNG/JPG/GIF 图片可嵌入 DOCX 与 EPUB，导出检查会精确报告缺失、越界或不支持的资源。
- 名称引用增加稳定 ID 镜像迁移：旧名称字段继续保留，重名不自动猜测，删除与替换同步维护两套引用。
- 可选 `electron-updater` 状态机与安全更新源入口；CI 新增 macOS DMG/ZIP 和 Linux AppImage/DEB 构建任务。

### Changed

- Electron preload 独立打包为 CJS 并启用 renderer sandbox。
- 页面级动态导入将主渲染包从约 1.06 MB 降至约 310 KB，大型编辑器依赖拆为按需 chunk。
- 浏览器 EPUB 补齐版权页、完整元数据、分卷嵌套目录、NCX、排版设置与安全 Markdown 渲染。

### Known limitations

- 公开 Windows 更新仍需要外部代码签名证书和实际 HTTPS 更新源。
- macOS/Linux 构建由原生 CI runner 生成，本机 Windows 只验证配置和 Windows 产物。
- 浏览器无法读取项目相对图片，正文图片仅保留替代文本；桌面端会实际嵌入。

## [1.0.0-rc.2] - 2026-08-12

### Added

- 长篇小说续写工作流：语料导入、Canon 事实库、分块索引、混合检索、风格画像、故事线程、上下文编译、续写编排与结果验证。
- 独立 Remotion 宣传片工程及 CI 质量门禁，包含横版产品片、配音版和竖屏长版软广告。
- 中英文项目主页、产品截图和 RC2 独立发布说明。

### Changed

- 工作区导航、Agent 作用域和集中修订流程进一步打磨。
- 根应用与桌面应用版本同步提升到 `1.0.0-rc.2`。
- 当前验证基线提升到 52 个测试文件、340 个用例和 15 项桌面 smoke 检查。

### Fixed

- 修复导出与自动备份并发、质量报告刷新、章节统计、批注装饰、异步搜索和 Agent 估算等 RC 复核问题。
- 修复 Windows 打包 CI 和 workspace 残留链接导致的 electron-builder 阻断。
- 将受公告影响的 `nanoid` 更新到安全版本，恢复生产依赖审计门禁。

### Known limitations

- Windows 安装包尚未签名，公开安装可能触发 SmartScreen。
- 应用内更新等待代码签名证书和更新源。
- Electron renderer sandbox、正文图片嵌入导出和 macOS/Linux 打包留待后续版本。

## [1.0.0-rc.1] - 2026-07-27

- 完成章节写作、故事资料、修订、备份、Agent 控制、EPUB 交付和发布加固七个阶段。
- 建立 Windows/Ubuntu CI、400 章性能探针和 unsigned Windows 安装包构建。
