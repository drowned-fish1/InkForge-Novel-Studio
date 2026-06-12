import {
  defaultProviderConfig,
  inkforgeSchemaVersion,
  type ChapterPlan,
  type Character,
  type Clue,
  type Term,
  type TimelineEvent,
  type WorldEntry
} from "@inkforge/schemas";
import type {
  CreateChapterInput,
  CreateProjectInput,
  ExportInput,
  AiTaskInput,
  AiTaskResult,
  ConsistencyIssue,
  ProviderConfigInput,
  ProjectSummary,
  ProviderStatus,
  SaveChapterInput,
  SaveClueInput,
  SaveCharacterInput,
  SaveWorldEntryInput
} from "@/types/app";
import { hasAuthMaterial, maskApiKey, runBrowserAiTask } from "@/lib/browserAiProvider";

const now = new Date().toISOString().replace("Z", "+00:00");

const chapterOne: ChapterPlan = {
  id: "ch-0001",
  number: 1,
  title: "第一章 旧城夜雨",
  file: "chapters/volume-001/ch-0001.md",
  goal: "主角在雨夜发现父亲留下的黑匣，引出血脉秘密。",
  hook: "黑匣中传出第二个人的心跳声。",
  status: "drafting",
  targetWords: 3000,
  actualWords: 0,
  archived: false,
  notes: "开篇压迫感要足，尽量少解释黑匣来源。",
  conflictPoints: "主角逃亡压力；是否信任苏青。",
  characters: ["林烬", "苏青"],
  worldRefs: ["黑石城", "炼体境"]
};

const chapterTwo: ChapterPlan = {
  id: "ch-0002",
  number: 2,
  title: "第二章 黑匣开声",
  file: "chapters/volume-001/ch-0002.md",
  goal: "展示黑匣与主角血脉的联系，同时让敌对势力第一次露面。",
  hook: "主角在城门榜上看见父亲的通缉画像。",
  status: "planned",
  targetWords: 3200,
  actualWords: 0,
  archived: false,
  notes: "",
  conflictPoints: "黑匣线索与巡夜司追捕升级。",
  characters: ["林烬"],
  worldRefs: ["黑匣", "巡夜司"]
};

let project: ProjectSummary = {
  projectPath: "browser-demo://逆星长夜",
  meta: {
    schemaVersion: inkforgeSchemaVersion,
    projectId: "novel_demo_inkforge",
    title: "逆星长夜",
    author: "local-user",
    genre: ["玄幻", "升级流", "网文"],
    targetWords: 1200000,
    createdAt: now,
    updatedAt: now,
    defaultProviderId: defaultProviderConfig.providerId,
    defaultModel: defaultProviderConfig.model,
    writingPreferences: {
      pov: "第三人称有限视角",
      style: "节奏快，冲突强，少解释，多行动",
      chapterWords: 3000
    }
  },
  outline: {
    schemaVersion: inkforgeSchemaVersion,
    premise: "边城少年林烬在父亲失踪后得到黑匣，发现体内藏着失落星火血脉。",
    mainConflict: "林烬要在宗门、王朝与古族的追猎中找出父亲失踪真相。",
    endingDirection: "主角重铸星火长夜，打开被封锁的天外战场。",
    volumes: [
      {
        id: "vol-001",
        title: "第一卷 黑石城",
        goal: "建立主角动机、金手指规则与第一阶段追杀压力。",
        targetWords: 90000,
        chapters: [chapterOne, chapterTwo]
      }
    ]
  }
};

const chapterBodies = new Map<string, string>([
  [
    chapterOne.file,
    `# ${chapterOne.title}\n\n雨从旧城墙上砸下来，像一把把钝刀。\n\n林烬把黑匣压在怀里，听见巷口的脚步声越来越近。巡夜司的人不该来得这么快，除非父亲失踪前留下的东西，远比他想象得更危险。\n\n他没有回头，只把油纸伞往苏青手里一塞。\n\n“往南门走。”\n\n苏青怔了一下：“那你呢？”\n\n林烬看着墙根下那道被雨水冲开的暗纹，笑得很轻：“我去确认一件事。”\n`
  ],
  [chapterTwo.file, `# ${chapterTwo.title}\n\n`]
]);

let characters: Character[] = [
  {
    id: "char_main_protagonist",
    name: "林烬",
    aliases: ["林小子", "烬哥"],
    role: "protagonist",
    tags: ["主角", "升级流", "嘴硬心软"],
    profile: {
      age: "17",
      identity: "边城少年",
      motivation: "找到失踪的父亲并破解血脉秘密",
      personality: "冷静、记仇、关键时刻敢赌"
    },
    currentState: {
      arc: "第一卷",
      powerLevel: "炼体三重",
      location: "黑石城",
      relationships: ["与苏青保持盟友关系"],
      secrets: ["尚不知道母亲真实身份"]
    },
    voiceNotes: "对白短，少解释，遇到挑衅时喜欢反问。"
  },
  {
    id: "char_suqing",
    name: "苏青",
    aliases: [],
    role: "ally",
    tags: ["盟友", "机关师"],
    profile: {
      age: "16",
      identity: "流落黑石城的机关师",
      motivation: "修复家族留下的星舟残图",
      personality: "理性、敏锐、嘴上不饶人"
    },
    currentState: {
      arc: "第一卷",
      powerLevel: "无",
      location: "黑石城",
      relationships: ["暂时信任林烬"],
      secrets: ["知道黑匣外壳的机关纹路来源"]
    },
    voiceNotes: "对白精准，习惯先指出风险，再给解决方案。"
  }
];

let worldEntries: WorldEntry[] = [
  {
    id: "power-system",
    title: "炼体境",
    type: "power-system",
    locked: true,
    tags: ["修炼体系", "第一卷"],
    summary: "第一阶段修炼体系，以骨血、筋脉和星火感应为核心。",
    content: "炼体境分九重。前三重锻骨，中三重洗髓，后三重引星火入脉。已锁定设定不得在续写中随意更改。",
    relatedCharacters: ["林烬"],
    relatedClues: ["黑匣"]
  },
  {
    id: "black-stone-city",
    title: "黑石城",
    type: "location",
    locked: false,
    tags: ["地点", "边城"],
    summary: "北境边城，巡夜司势力强，旧城墙下埋有星火古阵。",
    content: "黑石城常年夜雨，分旧城、南门集、市楼、巡夜司四个主要区域。",
    relatedCharacters: ["林烬", "苏青"],
    relatedClues: []
  }
];

let timeline: TimelineEvent[] = [
  {
    id: "event-rain-night",
    chapterId: "ch-0001",
    order: 1,
    title: "旧城夜雨发现黑匣",
    location: "黑石城",
    participants: ["林烬", "苏青"],
    summary: "林烬在雨夜带走父亲留下的黑匣。"
  }
];

let clues: Clue[] = [
  {
    id: "clue-black-box-heartbeat",
    title: "黑匣中的第二道心跳",
    plantedChapterId: "ch-0001",
    relatedCharacters: ["林烬"],
    expectedPayoff: "揭示黑匣与星火血脉的关系",
    status: "planted",
    notes: "第一章末尾强化悬念。"
  }
];

let terms: Term[] = [
  {
    id: "term-body-tempering",
    name: "炼体境",
    category: "境界",
    aliases: ["炼体"],
    definition: "修炼第一阶段，共九重。",
    locked: true
  }
];

let providerStatus: ProviderStatus = {
  configured: false,
  providerId: defaultProviderConfig.providerId,
  displayName: defaultProviderConfig.displayName,
  baseUrl: defaultProviderConfig.baseUrl,
  model: defaultProviderConfig.model,
  authMode: defaultProviderConfig.authMode
};
let runtimeApiKey = "";

const createChapterPlan = (input: CreateChapterInput): ChapterPlan => {
  const volumeIndex = Math.max(
    0,
    project.outline.volumes.findIndex((item) => item.id === input.volumeId)
  );
  const volumeNumber = volumeIndex + 1;
  const maxNumber = Math.max(
    ...project.outline.volumes.flatMap((item) => item.chapters.map((chapter) => chapter.number))
  );
  const nextNumber = maxNumber + 1;
  return {
    id: `ch-${String(nextNumber).padStart(4, "0")}`,
    number: nextNumber,
    title: input.title || `第${nextNumber}章 未命名`,
    file: `chapters/volume-${String(volumeNumber).padStart(3, "0")}/ch-${String(nextNumber).padStart(4, "0")}.md`,
    goal: "",
    hook: "",
    status: "drafting",
    targetWords: project.meta.writingPreferences.chapterWords,
    actualWords: 0,
    archived: false,
    notes: "",
    conflictPoints: "",
    characters: [],
    worldRefs: []
  };
};

export const demoBridge = {
  async createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    project = {
      ...project,
      projectPath: `browser-demo://${input.title}`,
      meta: {
        ...project.meta,
        title: input.title,
        author: input.author || "local-user",
        genre: input.genre,
        targetWords: input.targetWords,
        writingPreferences: {
          ...project.meta.writingPreferences,
          style: input.style
        }
      },
      outline: {
        ...project.outline,
        premise: input.premise
      }
    };
    return structuredClone(project);
  },
  async openProject(): Promise<ProjectSummary> {
    return structuredClone(project);
  },
  async revealProject(): Promise<void> {},
  async readChapter(_projectPath: string, file: string): Promise<string> {
    return chapterBodies.get(file) ?? "";
  },
  async saveChapter(input: SaveChapterInput): Promise<void> {
    chapterBodies.set(input.file, input.content);
  },
  async createChapter(input: CreateChapterInput): Promise<ProjectSummary> {
    const chapter = createChapterPlan(input);
    const volume = project.outline.volumes.find((item) => item.id === input.volumeId) ?? project.outline.volumes[0];
    volume.chapters.push(chapter);
    chapterBodies.set(chapter.file, `# ${chapter.title}\n\n`);
    return structuredClone(project);
  },
  async updateOutline(input: import("@/types/app").UpdateOutlineInput): Promise<ProjectSummary> {
    project = {
      ...project,
      outline: structuredClone(input.outline),
      meta: {
        ...project.meta,
        updatedAt: new Date().toISOString().replace("Z", "+00:00")
      }
    };
    return structuredClone(project);
  },
  async exportManuscript(input: ExportInput): Promise<string> {
    const extension = input.format === "markdown" ? "md" : input.format;
    return `browser-demo://exports/manuscript.${extension}`;
  },
  async listCharacters(): Promise<Character[]> {
    return structuredClone(characters);
  },
  async saveCharacter(input: SaveCharacterInput): Promise<Character[]> {
    const existing = characters.findIndex((item) => item.id === input.character.id);
    if (existing >= 0) {
      characters[existing] = input.character;
    } else {
      characters = [...characters, input.character];
    }
    return structuredClone(characters);
  },
  async listTimeline(): Promise<TimelineEvent[]> {
    return structuredClone(timeline);
  },
  async saveTimelineEvent(input: import("@/types/app").SaveTimelineEventInput): Promise<TimelineEvent[]> {
    const index = timeline.findIndex((item) => item.id === input.event.id);
    timeline =
      index >= 0
        ? timeline.map((item) => (item.id === input.event.id ? input.event : item))
        : [...timeline, input.event];
    return structuredClone(timeline);
  },
  async listClues(): Promise<Clue[]> {
    return structuredClone(clues);
  },
  async saveClue(input: SaveClueInput): Promise<Clue[]> {
    const index = clues.findIndex((item) => item.id === input.clue.id);
    clues = index >= 0 ? clues.map((item) => (item.id === input.clue.id ? input.clue : item)) : [...clues, input.clue];
    return structuredClone(clues);
  },
  async listTerms(): Promise<Term[]> {
    return structuredClone(terms);
  },
  async saveTerm(input: import("@/types/app").SaveTermInput): Promise<Term[]> {
    const index = terms.findIndex((item) => item.id === input.term.id);
    terms = index >= 0 ? terms.map((item) => (item.id === input.term.id ? input.term : item)) : [...terms, input.term];
    return structuredClone(terms);
  },
  async inspectStory(): Promise<ConsistencyIssue[]> {
    const issues: ConsistencyIssue[] = [];
    for (const clue of clues) {
      if (clue.status !== "resolved" && !clue.expectedPayoff) {
        issues.push({
          id: `clue-${clue.id}`,
          severity: "warning",
          scope: "clue",
          title: "伏笔缺少预期回收",
          detail: clue.title
        });
      }
    }
    for (const term of terms) {
      if (!term.definition) {
        issues.push({
          id: `term-${term.id}`,
          severity: "info",
          scope: "term",
          title: "术语缺少定义",
          detail: term.name
        });
      }
    }
    return issues.length
      ? issues
      : [
          {
            id: "ok",
            severity: "info",
            scope: "project",
            title: "本地检查通过",
            detail: "没有发现基础结构问题。"
          }
        ];
  },
  async listWorldEntries(): Promise<WorldEntry[]> {
    return structuredClone(worldEntries);
  },
  async saveWorldEntry(input: SaveWorldEntryInput): Promise<WorldEntry[]> {
    const existing = worldEntries.findIndex((item) => item.id === input.entry.id);
    if (existing >= 0) {
      worldEntries[existing] = input.entry;
    } else {
      worldEntries = [...worldEntries, input.entry];
    }
    return structuredClone(worldEntries);
  },
  async providerStatus(): Promise<ProviderStatus> {
    return structuredClone(providerStatus);
  },
  async saveProviderConfig(input: ProviderConfigInput): Promise<ProviderStatus> {
    const nextApiKey = input.apiKey?.trim();
    if (nextApiKey) {
      runtimeApiKey = nextApiKey;
    }
    providerStatus = {
      configured: hasAuthMaterial(input.authMode, runtimeApiKey),
      providerId: input.providerId,
      displayName: input.displayName,
      baseUrl: input.baseUrl,
      model: input.model,
      authMode: input.authMode,
      maskedKey: nextApiKey ? maskApiKey(nextApiKey) : providerStatus.maskedKey,
      updatedAt: new Date().toISOString()
    };
    return structuredClone(providerStatus);
  },
  async runAiTask(input: AiTaskInput): Promise<AiTaskResult> {
    if (providerStatus.configured) {
      return runBrowserAiTask(input, {
        providerId: providerStatus.providerId,
        displayName: providerStatus.displayName,
        baseUrl: providerStatus.baseUrl,
        model: providerStatus.model,
        authMode: providerStatus.authMode,
        apiKey: runtimeApiKey,
        temperature: defaultProviderConfig.temperature,
        maxTokens: defaultProviderConfig.maxTokens
      });
    }
    if (!providerStatus.configured) {
      throw new Error("Provider 尚未配置。");
    }
    return {
      task: input.task,
      text: `任务：${input.task}\n\n${input.chapterTitle} 的 AI 草稿示例。\n\n基于当前章节目标、人物和设定，建议先保留冲突压力，再让新线索自然浮出。`,
      providerId: providerStatus.providerId,
      model: providerStatus.model,
      contextSummary: `浏览器演示：${input.characters.length} 个角色，${input.worldFacts.length} 条设定`,
      generatedAt: new Date().toISOString()
    };
  },
  async saveChapterSummary(input: import("@/types/app").SaveChapterSummaryInput): Promise<string> {
    return `browser-demo://summaries/${input.chapterId}.summary.json`;
  }
};

export const bridge = window.inkforge ?? demoBridge;
