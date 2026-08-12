# InkForge GitHub 产品宣传片

24 秒、1920×1080、30fps 的 Remotion 产品宣传片。叙事围绕三个传播钩子：

- 本地优先：作品、章节与故事资料留在作者选择的文件夹中。
- 作者控制：AI 只提交可预览的提案，由作者接受、拒绝或回滚。
- 一体化长篇工作流：规划、写作、连续性检查、修订与 EPUB 3 导出。

结尾 CTA 直接引导至：

`github.com/drowned-fish1/InkForge-Novel-Studio`

工程包含两个版本：

- `InkForgePromo`：24 秒纯音乐版。
- `InkForgePromoVoiceover`：32.83 秒曼波音配音版，带高对比逐句字幕和自动音乐闪避。
- `InkForgeLongformSoftAd`：3 分 40 秒、9:16 竖屏的原速曼波音软广告，从第三方“发现好项目”的视角展开。

## 使用

```powershell
npm install
npm run audio
npm run voiceover:manbo
npm run voiceover:longform
npm run audio:voiceover
npm run audio:longform
npm run dev
```

默认渲染：

```powershell
npm run render:promo
npm run render:voiceover
npm run render:longform
```

若 Remotion 的 Headless Chrome 下载受限，可直接使用本机 Chrome：

```powershell
node node_modules/@remotion/cli/remotion-cli.js render InkForgePromo out/inkforge-github-promo.mp4 --codec=h264 --crf=16 --audio-codec=aac --pixel-format=yuv420p --concurrency=4 --browser-executable="C:\Program Files\Google\Chrome\Application\chrome.exe"
```

## 结构

- `src/InkForgePromo.tsx`：六段分镜、动效、转场与 CTA。
- `src/ManboCaptionOverlay.tsx`：逐句字幕、关键词强调与字幕入退场。
- `src/LongformSoftAd.tsx`：15 段竖屏软广告画面、真实产品证据、限制说明与弱 CTA。
- `src/LongformCaptionOverlay.tsx`：适配 9:16 信息流的逐句字幕。
- `scripts/generate-manbo-voiceover.mjs`：调用曼波音 API、下载分段 MP3、测量时长并生成动态时间轴。
- `scripts/generate-manbo-longform.mjs`：生成长版原速旁白、按句拆分字幕并形成 3 分 40 秒动态时间轴。
- `scripts/generate-audio.mjs`：确定性生成 24 秒立体声未来感配乐。
- `public/voiceover/manbo/`：曼波音分段、字幕 JSON 与动态时间轴。
- `public/voiceover/manbo-longform/`：长版 15 段原速曼波音、字幕与时间轴。
- `public/assets/`：来自主项目的品牌图标与真实产品截图。
- `out/stills/`：视觉 QA 代表帧。
- `out/inkforge-github-promo.mp4`：最终交付成片。
- `out/inkforge-github-promo-manbo.mp4`：曼波音配音版成片。
- `out/inkforge-longform-soft-ad.mp4`：最终长版竖屏软广告成片。
- `out/inkforge-longform-soft-ad-voice-only.mp4`：移除背景音乐、仅保留原速曼波音的长版成片。
