import { describe, expect, it } from "vitest";
import { buildPrompt } from "../src/index";
import type { PromptTemplate } from "@inkforge/schemas";

const template: PromptTemplate = {
  id: "continue_custom",
  name: "Custom Continue",
  system: "Stay within established canon.",
  userTemplate: "Task={{task}}\nInstruction={{taskInstruction}}\nTitle={{chapterTitle}}\nCast={{characters}}",
  output: "markdown"
};

describe("buildPrompt", () => {
  it("renders a prompt template through the shared prompt engine", () => {
    const rendered = buildPrompt(
      template,
      {
        task: "continue",
        chapterTitle: "A Cold Door",
        chapterGoal: "Open the vault",
        recentText: "The lock clicked.",
        characters: ["Mira", "Tao"],
        worldFacts: [],
        style: "Tense and concise"
      },
      new Date("2024-01-02T03:04:05.000Z")
    );

    expect(rendered).toMatchObject({
      id: "continue_custom",
      name: "Custom Continue",
      system: "Stay within established canon.",
      output: "markdown",
      generatedAt: "2024-01-02T03:04:05.000Z"
    });
    expect(rendered.user).toContain("Task=continue");
    expect(rendered.user).toContain("Instruction=Continue the current chapter");
    expect(rendered.user).toContain("Title=A Cold Door");
    expect(rendered.user).toContain("Cast=Mira, Tao");
  });
});
