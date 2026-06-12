import type { PipelineStep } from "./pipeline.js";

export type PipelinePresetId =
  | "quick-continue"
  | "full-chapter"
  | "chapter-revise"
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
    name: "Quick Continue",
    description: "Build context, draft the next passage, and run a lightweight self review.",
    autoCommit: true,
    stopOnError: true,
    steps: [
      passStep("context", "Build context"),
      passStep("draft", "Draft continuation", "context"),
      passStep("review", "Self review", "draft")
    ]
  },
  "full-chapter": {
    id: "full-chapter",
    name: "Full Chapter",
    description: "Plan scenes, draft each scene, self review, revise, and summarize the chapter.",
    autoCommit: true,
    stopOnError: true,
    steps: [
      passStep("context", "Build context"),
      passStep("scene-plan", "Plan scenes", "context"),
      passStep("draft-scenes", "Draft scenes", "scene-plan"),
      passStep("review", "Self review", "draft-scenes"),
      passStep("revise", "Auto revise", "review"),
      passStep("summary", "Summarize chapter", "revise")
    ]
  },
  "chapter-revise": {
    id: "chapter-revise",
    name: "Chapter Revise",
    description: "Review an existing chapter and produce a focused revision pass.",
    autoCommit: false,
    stopOnError: true,
    steps: [
      passStep("review", "Review chapter"),
      passStep("revise", "Revise chapter", "review"),
      passStep("final-check", "Final check", "revise")
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
