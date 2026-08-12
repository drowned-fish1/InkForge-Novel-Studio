# Windows 发布指南（v1.0 RC）

## 构建产物

```bash
npm run pack:desktop    # 生成未打包应用目录（快速本地验证）
npm run dist:windows    # 生成 NSIS 安装包（x64）
```

electron-builder 配置位于 `apps/desktop/package.json` 的 `build` 字段：
asar 打包、NSIS x64 安装器、图标与 `dist-electron`/`dist` 产物（测试文件被显式排除，
该排除依赖 `!dist-electron/**/*.test.js` 与 electron tsconfig 的 exclude 保持同步）。

## 安装包验证清单

1. `npm run test:desktop-smoke` 全绿（构建 + 真实主进程 16 项端到端检查）。
2. 安装 NSIS 包 → 启动 → 创建项目 → 写作/保存 → 关闭 → 重新打开项目内容完整。
3. 无 API Key 时验证：写作台、批注/待修改、资料页、修订工作台、备份/恢复、四格式导出全部可用。
4. 配置真实 Provider 后验证：Agent 提案生成→确认→写入→撤销、推演、发送前估算。
5. 用主流阅读器（Calibre、Apple Books 或 Thorium）打开导出的 EPUB，确认封面、目录层级与版权页。
6. 卸载后确认用户数据目录（`%APPDATA%/@inkforge/desktop`）中的密钥文件不随项目泄露。

## 代码签名（外部阻塞）

当前没有代码签名证书，未签名安装包会触发 SmartScreen 警告。接入步骤：

1. 获取 OV/EV 代码签名证书（EV 可即时建立 SmartScreen 信誉）。
2. 在 `apps/desktop/package.json` 的 `build.win` 增加：
   - 证书文件方式：`certificateFile` + `CSC_KEY_PASSWORD` 环境变量；或
   - 云签名/HSM：`signtoolOptions` 或 `azureSignOptions`（electron-builder ≥ 26）。
3. CI 中通过安全变量注入证书，本地不落盘。

## 自动更新（代码已接入，更新源仍为外部条件）

1. 设置 `INKFORGE_UPDATE_URL=https://updates.example.com/inkforge/` 后，正式包会使用 generic feed；未设置时完全禁用且不联网。
2. preload 已暴露状态、检查、下载和安装 IPC；下载不会自动开始，安装必须由调用方确认。
3. 更新源只接受 HTTPS（测试时允许 localhost/127.0.0.1 HTTP），并必须与签名配套。
4. 版本号策略：应用版本已在 v1.0 RC4 统一为 `1.0.0-rc.4`（root 与 `apps/desktop`）；
   `packages/*` 保持内部 `0.1.0`，项目数据 schemaVersion 独立冻结为 `0.1.0`。

## 安全与平台说明

- preload 由 esbuild 独立打包成 `preload.cjs`，renderer 已启用 sandbox、contextIsolation，禁用 nodeIntegration。
- `npm run dist:mac` 与 `npm run dist:linux` 必须在对应原生平台执行；CI 已配置原生 runner。
