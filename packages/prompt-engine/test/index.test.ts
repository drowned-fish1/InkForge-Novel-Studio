import { describe, expect, it } from "vitest";
import {
  createDefaultPromptTemplate,
  defaultPromptPartials,
  promptTasks,
  renderPrompt,
  renderTemplate,
  variablesFromTaskInput,
  type PromptVariables
} from "../src/index";
import type { PromptTemplate } from "@inkforge/schemas";

const template: PromptTemplate = {
  id: "draft-scene",
  name: "Draft Scene",
  system: "Write vivid fiction.",
  userTemplate: "Title: {{ title }}\nTags: {{tags}}\nCount: {{ count }}\nReady: {{ready}}",
  output: "markdown"
};

const fixedDate = new Date("2024-01-02T03:04:05.000Z");

describe("renderPrompt", () => {
  it("replaces scalar variables and preserves template metadata", () => {
    const rendered = renderPrompt(
      template,
      { title: "The Door", count: 3, ready: true, tags: ["mystery", "night"] },
      fixedDate
    );

    expect(rendered).toMatchObject({
      id: template.id,
      name: template.name,
      system: template.system,
      output: "markdown",
      generatedAt: "2024-01-02T03:04:05.000Z"
    });
    expect(rendered.user).toBe("Title: The Door\nTags: mystery, night\nCount: 3\nReady: true");
    expect(rendered.contextSummary).toContain("title");
    expect(rendered.contextSummary).toContain("tags");
    expect(rendered.contextSummary).toContain("count");
    expect(rendered.contextSummary).toContain("ready");
  });

  it("renders empty strings, null, undefined, and missing variables as empty text", () => {
    const rendered = renderPrompt(
      {
        ...template,
        userTemplate: "A={{empty}} B={{nil}} C={{missing}} D={{unknown}}"
      },
      { empty: "", nil: null, missing: undefined },
      fixedDate
    );

    expect(rendered.user).toBe("A= B= C= D=");
    expect(rendered.contextSummary).not.toContain("empty");
    expect(rendered.contextSummary).not.toContain("nil");
    expect(rendered.contextSummary).not.toContain("missing");
  });

  it("joins array variables with the prompt delimiter", () => {
    const rendered = renderPrompt(
      { ...template, userTemplate: "{{beats}}" },
      { beats: ["setup", "turn", "payoff"] },
      fixedDate
    );

    expect(rendered.user).toBe("setup, turn, payoff");
  });

  it("handles an empty variables object", () => {
    const rendered = renderPrompt({ ...template, userTemplate: "Scene: {{scene}}" }, {}, fixedDate);

    expect(rendered.user).toBe("Scene: ");
  });

  it("supports dotted and dashed variable keys", () => {
    const variables: PromptVariables = {
      "character.name": "Mira",
      "scene-goal": "escape"
    };

    const rendered = renderPrompt(
      { ...template, userTemplate: "{{ character.name }} must {{ scene-goal }}." },
      variables,
      fixedDate
    );

    expect(rendered.user).toBe("Mira must escape.");
  });

  it("supports if blocks with else branches", () => {
    const rendered = renderPrompt(
      { ...template, userTemplate: "{{#if ready}}Ready: {{title}}{{else}}Not ready{{/if}}" },
      { ready: false, title: "The Door" },
      fixedDate
    );

    expect(rendered.user).toBe("Not ready");
  });

  it("supports each blocks over scalar arrays", () => {
    const rendered = renderPrompt(
      { ...template, userTemplate: "Cast:\n{{#each characters}}- {{this}}\n{{/each}}" },
      { characters: ["Mira", "Sol"] },
      fixedDate
    );

    expect(rendered.user).toBe("Cast:\n- Mira\n- Sol\n");
  });

  it("supports each blocks over object arrays with local properties", () => {
    const rendered = renderPrompt(
      { ...template, userTemplate: "{{#each beats}}{{order}}. {{action}}\n{{/each}}" },
      {
        beats: [
          { order: 1, action: "Open the gate" },
          { order: 2, action: "Run" }
        ]
      },
      fixedDate
    );

    expect(rendered.user).toBe("1. Open the gate\n2. Run\n");
  });

  it("supports partials rendered in the current scope", () => {
    const rendered = renderPrompt(
      { ...template, userTemplate: "{{> heading}}\n{{#each tags}}{{> tag-line}}{{/each}}" },
      { title: "The Door", tags: ["mystery", "night"] },
      fixedDate,
      {
        heading: "Title: {{title}}",
        "tag-line": "- {{this}}\n"
      }
    );

    expect(rendered.user).toBe("Title: The Door\n- mystery\n- night\n");
  });

  it("renders the default partials used by built-in templates", () => {
    const output = renderTemplate(
      "{{> chapter-context}}",
      {
        chapterTitle: "Opening",
        chapterGoal: "Reach the city",
        style: "fast"
      },
      defaultPromptPartials
    );

    expect(output).toContain("Chapter title: Opening");
    expect(output).toContain("Chapter goal: Reach the city");
    expect(output).toContain("Writing style: fast");
  });
});

describe("default prompt templates", () => {
  it("exports 19 default task templates", () => {
    expect(promptTasks).toHaveLength(19);
  });

  it.each(promptTasks)("creates and renders the %s template", (task) => {
    const prompt = renderPrompt(
      createDefaultPromptTemplate(task),
      variablesFromTaskInput({
        task,
        instruction: "Keep it tense.",
        chapterTitle: "Opening",
        chapterGoal: "Reach the city",
        recentText: "Mira saw the gate.",
        characters: ["Mira", "Sol"],
        worldFacts: ["The city gates close at dusk."],
        style: "Fast, concrete, low exposition"
      }),
      fixedDate
    );

    expect(prompt.user).toContain("Opening");
    expect(prompt.user).toContain("Mira");
    expect(prompt.generatedAt).toBe("2024-01-02T03:04:05.000Z");
  });
});
