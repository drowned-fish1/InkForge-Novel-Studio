import type { PipelineStep } from "./pipeline.js";

export type PipelinePresetId =
  | "quick-continue"
  | "full-chapter"
  | "chapter-revise"
  | "literary-polish"
  | "consistency-check"
  | "pre-publish";

export interface PipelinePreset {
  id: PipelinePresetId;
  name: string;
  description: string;
  steps: PipelineStep[];
  stopOnError: boolean;
  autoCommit: boolean;
}

const passStep = (id: string, title: string, inputFrom?: string | string[]): PipelineStep => ({
  id,
  title,
  inputFrom,
  run: ({ data }) => ({ id, output: data, data: { [`${id}Completed`]: true } })
});

export const pipelinePresets: Record<PipelinePresetId, PipelinePreset> = {
  "quick-continue": {
    id: "quick-continue",
    name: "快速续写协作组",
    description: "资料员准备上下文，正文 Agent 续写，审稿 Agent 做轻量检查。",
    autoCommit: true,
    stopOnError: true,
    steps: [
      passStep("context", "资料员 · 构建上下文"),
      passStep("draft", "正文 Agent · 续写"),
      passStep("review", "审稿 Agent · 自检")
    ]
  },
  "full-chapter": {
    id: "full-chapter",
    name: "完整章节 Agent 组",
    description: "策划、正文、审稿、修订和记忆 Agent 依次工作，每阶段由作者确认。",
    autoCommit: true,
    stopOnError: true,
    steps: [
      passStep("context", "资料员 · 构建上下文"),
      passStep("scene-plan", "策划 Agent · 场景方案", "context"),
      passStep("draft-scenes", "正文 Agent · 起草场景", "scene-plan"),
      passStep("review", "审稿 Agent · 质量检查", "draft-scenes"),
      passStep("revise", "修订 Agent · 定向改稿", "review"),
      passStep("summary", "记忆 Agent · 沉淀状态", "revise")
    ]
  },
  "chapter-revise": {
    id: "chapter-revise",
    name: "章节修订 Agent 组",
    description: "审稿、修订和终检 Agent 对当前章节进行定向改稿。",
    autoCommit: false,
    stopOnError: true,
    steps: [
      passStep("review", "Review chapter"),
      passStep("revise", "Revise chapter", "review"),
      passStep("final-check", "Final check", "revise")
    ]
  },
  "literary-polish": {
    id: "literary-polish",
    name: "文学精修 Agent 组",
    description: "粗稿 Agent 铺齐情节，感官 Agent 去除默认表达，独立编辑模型修剪节奏；确认前不写入正文。",
    autoCommit: false,
    stopOnError: true,
    steps: [
      passStep("context", "资料员 · 锁定事实"),
      passStep("rough-draft", "粗稿 Agent · 铺齐节点", "context"),
      passStep("sensory-pass", "感官 Agent · 逐段精修", "rough-draft"),
      passStep("editor-pass", "编辑 Agent · 节奏修剪", "sensory-pass")
    ]
  },
  "consistency-check": {
    id: "consistency-check",
    name: "Consistency Check",
    description: "Check characters, terms, foreshadowing, timeline, and world rules.",
    autoCommit: true,
    stopOnError: false,
    steps: [
      passStep("character-check", "Character check"),
      passStep("term-check", "Term check"),
      passStep("clue-check", "Clue check"),
      passStep("timeline-check", "Timeline check"),
      passStep("world-check", "World check")
    ]
  },
  "pre-publish": {
    id: "pre-publish",
    name: "Pre Publish",
    description: "Run consistency, polish, typo, and export-readiness checks before publishing.",
    autoCommit: false,
    stopOnError: true,
    steps: [
      passStep("consistency", "Consistency check"),
      passStep("polish", "Polish pass", "consistency"),
      passStep("typo", "Typo check", "polish"),
      passStep("export-check", "Export readiness", "typo")
    ]
  }
};

export const getPipelinePreset = (id: PipelinePresetId): PipelinePreset => pipelinePresets[id];
