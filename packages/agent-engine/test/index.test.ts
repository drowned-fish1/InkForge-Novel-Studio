import { describe, expect, it } from "vitest";
import {
  ChapterContextBuilder,
  DecisionAnalyzer,
  PipelineRunner,
  SelfReviewer,
  WritingSessionManager,
  getPipelinePreset,
  pipelinePresets,
  type WritingScene
} from "../src/index";
import type { Character, Clue, Outline, Term, TimelineEvent, WorldEntry } from "@inkforge/schemas";

const outline: Outline = {
  schemaVersion: "0.1.0",
  premise: "A sealed city is waking up.",
  mainConflict: "The gate wants a human price.",
  endingDirection: "The city leaves the ground.",
  volumes: [
    {
      id: "v1",
      title: "Volume One",
      chapters: [
        {
          id: "c1",
          number: 1,
          title: "Gate",
          file: "chapters/001.md",
          goal: "Mira opens the gate",
          hook: "A second moon appears",
          status: "planned",
          targetWords: 3000,
          actualWords: 0,
          archived: false,
          notes: "",
          conflictPoints: "Pay the toll",
          characters: ["mira"],
          worldRefs: ["gate"]
        }
      ]
    }
  ]
};

const character = (name: string): Character => ({
  id: name.toLowerCase(),
  name,
  aliases: [],
  role: "lead",
  tags: [],
  profile: { age: "", identity: "gate keeper", motivation: "save the city", personality: "direct" },
  currentState: { arc: "trusts herself", powerLevel: "novice", location: "north gate", relationships: [], secrets: [] },
  voiceNotes: "short sentences"
});

describe("ChapterContextBuilder", () => {
  it("builds prioritized context and omits lower priority sections when budget is tight", () => {
    const context = new ChapterContextBuilder().build(
      {
        outline,
        characters: [character("Mira")],
        clues: [
          {
            id: "clue",
            title: "Broken bell",
            relatedCharacters: [],
            expectedPayoff: "rings at dawn",
            status: "planned",
            notes: ""
          } satisfies Clue
        ],
        terms: [
          {
            id: "term",
            name: "Moon Gate",
            category: "place",
            aliases: [],
            definition: "locked threshold",
            locked: true
          } satisfies Term
        ],
        timeline: [
          {
            id: "t1",
            order: 1,
            title: "Arrival",
            location: "gate",
            participants: [],
            summary: "Mira arrives"
          } satisfies TimelineEvent
        ],
        world: [
          {
            id: "w1",
            title: "Gate Law",
            type: "rule",
            locked: true,
            tags: [],
            summary: "A long rule ".repeat(60),
            content: "A longer canon block ".repeat(60),
            relatedCharacters: [],
            relatedClues: []
          } satisfies WorldEntry
        ]
      },
      { currentChapterId: "c1", tokenBudget: 180 }
    );

    expect(context.summary).toContain("Mira");
    expect(context.summary).toContain("Broken bell");
    expect(context.totalTokens).toBeLessThanOrEqual(context.tokenBudget);
    expect(context.sections.find((section) => section.key === "world")?.included).toBe(false);
  });
});

describe("PipelineRunner", () => {
  it("auto commits steps and passes inputFrom data", async () => {
    const runner = new PipelineRunner([
      { id: "first", run: () => ({ id: "first", output: "alpha" }) },
      { id: "second", inputFrom: "first", run: ({ data }) => ({ id: "second", output: `${data.first}-beta` }) }
    ]);

    const state = await runner.run();

    expect(state.status).toBe("completed");
    expect(state.data.second).toBe("alpha-beta");
  });

  it("pauses between steps when autoCommit is disabled", async () => {
    const runner = new PipelineRunner([
      { id: "first", run: () => ({ id: "first", output: "alpha" }) },
      { id: "second", run: () => ({ id: "second", output: "beta" }) }
    ]);

    const paused = await runner.run({ autoCommit: false });
    expect(paused.status).toBe("paused");
    expect(paused.pendingStep?.id).toBe("second");

    const completed = await runner.continue(paused);
    expect(completed.status).toBe("completed");
    expect(completed.data.second).toBe("beta");
  });
});

describe("SelfReviewer", () => {
  it("scores failed canon and term checks", () => {
    const review = new SelfReviewer().review({
      sceneGoal: "open gate",
      draft: "Mira walks away from the Forbidden Door.",
      expectedCharacters: ["Mira"],
      requiredTerms: ["Moon Gate"],
      lockedCanon: ["!Forbidden Door"]
    });

    expect(review.passed).toBe(false);
    expect(review.findings.some((finding) => finding.category === "canon-conflict")).toBe(true);
    expect(review.score).toBeLessThan(100);
  });
});

describe("WritingSessionManager", () => {
  const scenes: WritingScene[] = [
    { id: "s1", title: "Gate", goal: "open gate", expectedCharacters: ["Mira"], requiredTerms: ["Moon Gate"] }
  ];

  it("runs generate, self review, auto revise, and completes", async () => {
    const manager = new WritingSessionManager(WritingSessionManager.create("session", scenes), {
      writer: () => "Mira hesitates.",
      reviser: () => "Mira opens the Moon Gate.",
      maxAutoRevisions: 1
    });

    const state = await manager.runAutoLoop();

    expect(state.status).toBe("done");
    expect(state.drafts[0].revisionCount).toBe(1);
    expect(state.drafts[0].review?.passed).toBe(true);
  });

  it("creates checkpoints and rolls back session state", async () => {
    const manager = new WritingSessionManager(WritingSessionManager.create("session", scenes), {
      writer: () => "Mira opens the Moon Gate.",
      now: () => new Date("2024-01-02T03:04:05.000Z")
    });
    const checkpoint = manager.createCheckpoint("before writing");
    await manager.runAutoLoop();

    const rolledBack = manager.rollback(checkpoint.id);

    expect(rolledBack.status).toBe("planning");
    expect(rolledBack.drafts).toHaveLength(0);
  });
});

describe("DecisionAnalyzer", () => {
  it("detects the five decision contexts and applies a decision", () => {
    const analyzer = new DecisionAnalyzer();
    const decisions = analyzer.detect({
      text: "branch choose: A/B. character action is unclear. canon conflict. foreshadow payoff timing. quality warning.",
      choices: ["A", "B"],
      review: new SelfReviewer().review({ sceneGoal: "open gate", draft: "", requiredTerms: ["Moon Gate"] })
    });

    expect(decisions.map((decision) => decision.type)).toEqual(
      expect.arrayContaining(["branch-choice", "character-action", "canon-conflict", "clue-timing", "quality-warning"])
    );

    const updated = analyzer.applyDecision(WritingSessionManager.create("session", []), {
      decisionId: decisions[0].id,
      selectedChoice: "A"
    });
    expect(updated.status).toBe("writing");
  });
});

describe("pipeline presets", () => {
  it("exports the five requested presets", () => {
    expect(Object.keys(pipelinePresets).sort()).toEqual(
      ["chapter-revise", "consistency-check", "full-chapter", "pre-publish", "quick-continue"].sort()
    );
    expect(getPipelinePreset("full-chapter").steps.map((step) => step.id)).toContain("draft-scenes");
  });
});
