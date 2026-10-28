import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ALL_FORMATS, FilePathSource, Input } from "mediabunny";

const API = "https://api.milorapart.top/apis/mbAIsc";
const FPS = 30;
const TRANSITION_FRAMES = 12;
const VOICE_INSET_SECONDS = 0.55;
const BASE_TAIL_SECONDS = 1.2;
const TARGET_MIN_SECONDS = 220;

const scenes = [
  {
    id: "discovery",
    text: "我最近在 GitHub 上翻项目。本来只是想找个能在本地写小说的工具。结果翻着翻着……看到一个设计，有点不太对劲。",
  },
  {
    id: "problem",
    text: "现在很多 AI 写作软件，点一下生成，它就直接往你的正文里塞。写得好不好先不说。写到最后，到底哪些是你写的，哪些是它改的，有时候自己都分不清。",
  },
  {
    id: "proposal-discovery",
    text: "但这个项目不一样。它居然不允许 AI 直接动正文。AI 想改一个字，都得先给作者提交提案。哎？看到这里，我才认真点进去。",
  },
  {
    id: "meet-inkforge",
    text: "项目叫 InkForge。简单说，就是一个专门给长篇小说作者做的，本地 AI 写作工作台。不是让 AI 替你写一本书。更像是把 AI 放在旁边，当一个没有最终决定权的实习编辑。",
  },
  {
    id: "approval-flow",
    text: "它可以读取你批准的章节、人物和世界观。可以帮你续写、检查冲突、分析节奏。但它不能偷偷改稿。它先交作业，你看完差异，再决定接受、拒绝，或者直接回滚。",
  },
  {
    id: "permission-principle",
    text: "这个逻辑听起来好像很普通。但你仔细想一下，现在愿意主动限制 AI 权限的软件，其实并不多。大部分产品都在强调，它能替你做多少事。这个项目反而一直在强调，它不能替你决定什么。",
  },
  {
    id: "whole-novel",
    text: "另外，它也不是只管当前这一页。大纲、分卷、章节、人物、地点、势力、时间线、伏笔和冲突，基本都能放在同一个项目里。写长篇最烦的那堆资料，不需要再散落在十几个文档里。",
  },
  {
    id: "quality-review",
    text: "它甚至还有整部小说的质量检查。不是让 AI 随便说一句写得很好。它会把连续性、角色、节奏、文风、重复和伏笔分开检查，还能把某次结果保存成基线，之后再看有没有写崩。",
  },
  {
    id: "local-first",
    text: "我本来以为，这种项目最后肯定又要注册账号、开会员、把稿子传到云端。结果它核心工作流不需要账号。章节、设定、历史记录和备份，都放在你自己选择的文件夹里。",
  },
  {
    id: "ai-optional",
    text: "AI 也不是强制的。不开模型的时候，写作、规划、检查、备份和导出照样能用。需要 AI 时，再接 OpenAI 兼容接口或者本地模型。这个边界，我个人还挺喜欢。",
  },
  {
    id: "delivery",
    text: "写完以后，可以导出 Markdown、TXT、DOCX，还有带目录和封面的 EPUB。它连备份恢复和文件完整性检查都做了。怎么说呢……这个作者，明显真的被长篇写作折磨过。",
  },
  {
    id: "limitations",
    text: "不过先说缺点。它现在还是发布候选版本，主要支持 Windows。公开安装包没有签名，第一次运行可能会被系统拦一下。界面也不是那种打开就会用的极简软件，需要花点时间熟悉。",
  },
  {
    id: "fit",
    text: "所以，如果你只是偶尔让 AI 写几百字，这个东西可能有点重。但如果你真的在写长篇，又在意稿件放在哪里、AI 改了什么、出了问题能不能回去，那它确实挺少见。",
  },
  {
    id: "soft-cta",
    text: "项目是开源的，名字叫 InkForge。我把 GitHub 地址放在画面上。感兴趣可以自己进去看看。先不用急着 Star……真觉得好用，再点也不迟。",
  },
  {
    id: "final-thought",
    text: "至少这个项目，让 AI 先问一句再动笔。我觉得，这个方向挺对。",
  },
];

const outputDirectory = resolve("public/voiceover/manbo-longform");
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
      if (response.ok) return response;
      lastError = new Error(`${label} HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < 4) await wait(attempt * 1800);
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

const downloadScene = async (scene, index) => {
  if (scene.text.length > 299) {
    throw new Error(`${scene.id} exceeds the 299-character API limit.`);
  }
  const filename = `scene-${String(index + 1).padStart(2, "0")}-${scene.id}.mp3`;
  const outputPath = resolve(outputDirectory, filename);
  if (!existsSync(outputPath) || process.env.FORCE_REGENERATE === "1") {
    const url = new URL(API);
    url.searchParams.set("text", scene.text);
    const response = await fetchWithRetry(url, `Manbo API ${scene.id}`);
    const data = await response.json();
    if (data.code !== 200 || typeof data.url !== "string") {
      throw new Error(
        `Manbo API failed for ${scene.id}: ${JSON.stringify(data)}`,
      );
    }
    const audioResponse = await fetchWithRetry(
      data.url,
      `Audio download ${scene.id}`,
    );
    writeFileSync(outputPath, Buffer.from(await audioResponse.arrayBuffer()));
    console.log(`Downloaded ${filename}`);
  } else {
    console.log(`Using cached ${filename}`);
  }
  return {
    ...scene,
    src: `voiceover/manbo-longform/${filename}`,
    durationSeconds: await getDuration(outputPath),
  };
};

const measured = [];
for (let index = 0; index < scenes.length; index++) {
  measured.push(await downloadScene(scenes[index], index));
}

const baseSceneFrames = measured.map((scene) =>
  Math.ceil(
    (VOICE_INSET_SECONDS + scene.durationSeconds + BASE_TAIL_SECONDS) * FPS,
  ),
);
const baseTotalFrames =
  baseSceneFrames.reduce((sum, frames) => sum + frames, 0) -
  TRANSITION_FRAMES * (scenes.length - 1);
const extraFramesPerScene = Math.max(
  0,
  Math.ceil((TARGET_MIN_SECONDS * FPS - baseTotalFrames) / scenes.length),
);

let globalSceneStartFrame = 0;
const captions = [];
const timelineScenes = measured.map((scene, index) => {
  const sceneDurationInFrames = baseSceneFrames[index] + extraFramesPerScene;
  const voiceStartFrame =
    globalSceneStartFrame + Math.round(VOICE_INSET_SECONDS * FPS);
  const voiceEndFrame =
    voiceStartFrame + Math.ceil(scene.durationSeconds * FPS);
  const captionChunks = scene.text
    .match(/[^。！？…]+[。！？…]*/g)
    ?.filter(Boolean) ?? [scene.text];
  const totalWeight = captionChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0,
  );
  let chunkCursor = voiceStartFrame;
  captionChunks.forEach((chunk, chunkIndex) => {
    const isLast = chunkIndex === captionChunks.length - 1;
    const chunkFrames = isLast
      ? voiceEndFrame - chunkCursor
      : Math.max(
          1,
          Math.round(
            (scene.durationSeconds * FPS * chunk.length) / totalWeight,
          ),
        );
    captions.push({
      text: chunk.trim(),
      startMs: Math.round((chunkCursor / FPS) * 1000),
      endMs: Math.round(((chunkCursor + chunkFrames) / FPS) * 1000),
      timestampMs: null,
      confidence: null,
    });
    chunkCursor += chunkFrames;
  });

  const entry = {
    ...scene,
    sceneDurationInFrames,
    sceneStartFrame: globalSceneStartFrame,
    voiceStartFrame,
    voiceEndFrame,
  };
  globalSceneStartFrame += sceneDurationInFrames;
  if (index < scenes.length - 1) globalSceneStartFrame -= TRANSITION_FRAMES;
  return entry;
});

const timeline = {
  fps: FPS,
  transitionDurationInFrames: TRANSITION_FRAMES,
  playbackRate: 1,
  totalDurationInFrames: globalSceneStartFrame,
  durationSeconds: globalSceneStartFrame / FPS,
  scenes: timelineScenes,
};

writeFileSync(
  resolve(outputDirectory, "timeline.json"),
  JSON.stringify(timeline, null, 2),
);
writeFileSync(
  resolve(outputDirectory, "captions.json"),
  JSON.stringify(captions, null, 2),
);

console.log("\nLongform voiceover timeline:");
for (const scene of timelineScenes) {
  console.log(
    `${scene.id}: ${scene.durationSeconds.toFixed(2)}s voice / ${scene.sceneDurationInFrames} frames scene`,
  );
}
console.log(
  `Total: ${timeline.durationSeconds.toFixed(2)}s / ${timeline.totalDurationInFrames} frames`,
);
