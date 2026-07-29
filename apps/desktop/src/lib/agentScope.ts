import type { AgentToolName } from "@inkforge/schemas";

export type AgentScope = "chapter" | "project";

const chapterBoundTools = new Set<AgentToolName>([
  "get_chapter_context",
  "get_chapter_memory",
  "propose_chapter_edit",
  "propose_chapter_patch",
  "propose_scene_plan"
]);

export const toolsForAgentScope = (tools: AgentToolName[], scope: AgentScope): AgentToolName[] =>
  scope === "project" ? tools.filter((tool) => !chapterBoundTools.has(tool)) : tools;

export const composeAgentScopePrompt = (message: string, scope: AgentScope): string =>
  scope === "project"
    ? [
        "[全书 Agent 任务]",
        "请以整个项目为作用域，优先读取完整大纲、故事资料、叙事板与全项目检索结果。当前章节只作为会话锚点，不得把它误当成任务的唯一范围。需要改动大纲或资料时生成可审阅提案；全书模式不直接改写章节正文。",
        message
      ].join("\n")
    : message;
