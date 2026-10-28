import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_FORMATS, FilePathSource, Input } from "mediabunny";

const API = "https://api.milorapart.top/apis/mbAIsc";
const FPS = 30;
const TRANSITION_FRAMES = 14;
const PLAYBACK_RATE = 1.12;
const VOICE_INSET_SECONDS = 0.42;
const SCENE_TAIL_SECONDS = 0.95;

const lines = [
  "写长篇，最怕什么？不是没灵感，是失去对作品的控制。",
  "InkForge，本地优先的 AI 小说创作驾驶舱。",
  "章节和设定留在你的硬盘。AI 只提交提案，你决定接受、拒绝，还是回滚。",
  "从规划、写作，到连续性检查、修订和 EPUB 导出，一条工作流写完整部长篇。",
  "AI 帮你写，但作者永远是你。",
  "现在去 GitHub，给 InkForge 一颗 Star。把作品，留在自己手里。",
];

const outputDirectory = resolve("public/voiceover/manbo");
mkdirSync(outputDirectory, { recursive: true });

const wait = (milliseconds) =>
  new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const fetchWithRetry = async (url, label) => {
  let lastError;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
      });
      if (response.ok) {
        return response;
      }
      lastError = new Error(`${label} HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) {
      await wait(attempt * 1800);
    }
  }
  throw lastError;
};

const getDuration = async (path) => {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new FilePathSource(path),
  });
  return input.computeDuration();
};

const downloadLine = async (text, index) => {
  if (text.length > 299) {
    throw new Error(
      `Segment ${index + 1} exceeds the 299-character API limit.`,
    );
  }

  const filename = `seg-${String(index + 1).padStart(2, "0")}.mp3`;
  const outputPath = resolve(outputDirectory, filename);
  if (!existsSync(outputPath) || process.env.FORCE_REGENERATE === "1") {
    const url = new URL(API);
    url.searchParams.set("text", text);
    const response = await fetchWithRetry(
      url,
      `Manbo API segment ${index + 1}`,
    );

    const data = await response.json();
    if (data.code !== 200 || typeof data.url !== "string") {
      throw new Error(
        `Manbo API failed for segment ${index + 1}: ${JSON.stringify(data)}`,
      );
    }

    const audioResponse = await fetchWithRetry(
      data.url,
      `Audio download segment ${index + 1}`,
    );
    writeFileSync(outputPath, Buffer.from(await audioResponse.arrayBuffer()));
    console.log(`Downloaded ${filename}: ${text}`);
  } else {
    console.log(`Using cached ${filename}`);
  }

  return {
    id: `scene-${index + 1}`,
    text,
    src: `voiceover/manbo/${filename}`,
    durationSeconds: await getDuration(outputPath),
  };
};

const segments = [];
for (let index = 0; index < lines.length; index++) {
  segments.push(await downloadLine(lines[index], index));
}

let globalSceneStartFrame = 0;
const captions = [];
const timelineSegments = segments.map((segment, index) => {
  const effectiveDurationSeconds = segment.durationSeconds / PLAYBACK_RATE;
  const sceneDurationInFrames = Math.ceil(
    (VOICE_INSET_SECONDS + effectiveDurationSeconds + SCENE_TAIL_SECONDS) * FPS,
  );
  const voiceStartFrame =
    globalSceneStartFrame + Math.round(VOICE_INSET_SECONDS * FPS);
  const voiceEndFrame =
    voiceStartFrame + Math.ceil(effectiveDurationSeconds * FPS);
  const entry = {
    ...segment,
    sceneDurationInFrames,
    sceneStartFrame: globalSceneStartFrame,
    voiceStartFrame,
    voiceEndFrame,
  };

  captions.push({
    text: segment.text,
    startMs: Math.round((voiceStartFrame / FPS) * 1000),
    endMs: Math.round((voiceEndFrame / FPS) * 1000),
    timestampMs: null,
    confidence: null,
  });

  globalSceneStartFrame += sceneDurationInFrames;
  if (index < segments.length - 1) {
    globalSceneStartFrame -= TRANSITION_FRAMES;
  }
  return entry;
});

const totalDurationInFrames = globalSceneStartFrame;
const timeline = {
  fps: FPS,
  transitionDurationInFrames: TRANSITION_FRAMES,
  playbackRate: PLAYBACK_RATE,
  totalDurationInFrames,
  durationSeconds: totalDurationInFrames / FPS,
  segments: timelineSegments,
};

writeFileSync(
  resolve(outputDirectory, "timeline.json"),
  JSON.stringify(timeline, null, 2),
);
writeFileSync(
  resolve(outputDirectory, "captions.json"),
  JSON.stringify(captions, null, 2),
);

console.log("\nVoiceover timeline:");
for (const segment of timelineSegments) {
  console.log(
    `${segment.id}: ${segment.durationSeconds.toFixed(2)}s audio / ${segment.sceneDurationInFrames} frames scene`,
  );
}
console.log(
  `Total: ${timeline.durationSeconds.toFixed(2)}s / ${totalDurationInFrames} frames`,
);
