import { describe, expect, it } from "vitest";
import { composeAgentScopePrompt, toolsForAgentScope } from "./agentScope";

describe("project Agent scope", () => {
  it("keeps project tools while removing chapter-bound read and write tools", () => {
    expect(
      toolsForAgentScope(
        [
          "get_chapter_context",
          "get_outline_context",
          "search_project",
          "propose_chapter_edit",
          "propose_outline_update",
          "propose_character_update"
        ],
        "project"
      )
    ).toEqual(["get_outline_context", "search_project", "propose_outline_update", "propose_character_update"]);
  });

  it("leaves chapter mode tools and prompts unchanged", () => {
    const tools = ["get_chapter_context", "propose_chapter_patch"] as const;
    expect(toolsForAgentScope([...tools], "chapter")).toEqual(tools);
    expect(composeAgentScopePrompt("检查这一章", "chapter")).toBe("检查这一章");
  });

  it("adds an explicit whole-project boundary to project tasks", () => {
    const prompt = composeAgentScopePrompt("检查全书伏笔", "project");
    expect(prompt).toContain("[全书 Agent 任务]");
    expect(prompt).toContain("整个项目");
    expect(prompt).toContain("不直接改写章节正文");
    expect(prompt).toContain("检查全书伏笔");
  });
});
