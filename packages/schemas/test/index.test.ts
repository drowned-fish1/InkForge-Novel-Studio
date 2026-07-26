import { describe, expect, it } from "vitest";
import { ZodError, type ZodType } from "zod";
import {
  AgentChatSessionSchema,
  AgentExtensionConfigSchema,
  AgentDataProposalSchema,
  AgentRunTraceSchema,
  AgentToolNameSchema,
  ChapterMemorySchema,
  ChapterEndStateSchema,
  ChapterPlanSchema,
  ChapterStatusSchema,
  ChapterSummarySchema,
  CharacterSchema,
  ClueSchema,
  DecisionPointSchema,
  OutlineSchema,
  PipelineExecutionSchema,
  PipelineSchema,
  PlanningImportResultSchema,
  PlanningImportSelectionSchema,
  PlanningMessageSchema,
  PlanningPackageSchema,
  PlanningSessionSchema,
  ProjectMetaSchema,
  PromptTemplateSchema,
  ScenePlanSchema,
  TermSchema,
  TimelineEventSchema,
  VolumePlanSchema,
  WorldEntrySchema,
  WritingSessionSchema,
  WritingPreferencesSchema,
  createProjectId,
  defaultAgentMembers,
  inkforgeSchemaVersion
} from "../src/index";

const now = "2024-01-02T03:04:05.000Z";

const chapter = {
  id: "chapter-1",
  number: 1,
  title: "Opening",
  file: "chapters/001.md"
};

const outline = {
  schemaVersion: inkforgeSchemaVersion,
  premise: "A local-first writing app",
  volumes: [{ id: "volume-1", title: "Volume One", chapters: [chapter] }]
};

const expectZodError = (schema: ZodType, value: unknown) => {
  expect(() => schema.parse(value)).toThrow(ZodError);
};

describe("schemas", () => {
  it("provides extensible built-in Agent room members", () => {
    const extensions = AgentExtensionConfigSchema.parse({});
    expect(extensions.members).toEqual(defaultAgentMembers);
    expect(extensions.members.map((member) => member.handle)).toEqual(["导演", "作家", "编辑", "资料员"]);
  });

  it("supports world-building proposals from the Agent", () => {
    expect(AgentToolNameSchema.parse("propose_world_update")).toBe("propose_world_update");
    expect(
      AgentDataProposalSchema.parse({
        id: "proposal-world-1",
        entityType: "world",
        title: "边城宵禁",
        payload: { entity: { id: "world-curfew", title: "边城宵禁" } },
        createdAt: now
      }).entityType
    ).toBe("world");
  });

  it("supports outline memory and outline update proposals", () => {
    expect(AgentToolNameSchema.parse("get_outline_context")).toBe("get_outline_context");
    expect(AgentToolNameSchema.parse("propose_outline_update")).toBe("propose_outline_update");
    expect(
      AgentDataProposalSchema.parse({
        id: "proposal-outline-1",
        entityType: "outline",
        title: "全书大纲",
        payload: { outline },
        createdAt: now
      }).entityType
    ).toBe("outline");
  });

  it("supports the read-only narrative deviation preparation tool", () => {
    expect(AgentToolNameSchema.parse("prepare_narrative_deviation")).toBe("prepare_narrative_deviation");
  });

  it("supports narrative board and simulation agent tools", () => {
    expect(AgentToolNameSchema.parse("get_narrative_board")).toBe("get_narrative_board");
    expect(AgentToolNameSchema.parse("get_simulation_runs")).toBe("get_simulation_runs");
    expect(AgentToolNameSchema.parse("propose_beat_update")).toBe("propose_beat_update");
    expect(
      AgentDataProposalSchema.parse({
        id: "proposal-beat-1",
        entityType: "beat",
        title: "2 张节拍卡",
        payload: { actId: "", actTitle: "第二幕", beats: [{ id: "beat-1", title: "对峙", tension: 70 }] },
        createdAt: now
      }).entityType
    ).toBe("beat");
  });

  it.each([
    ["WritingPreferencesSchema", WritingPreferencesSchema, {}],
    [
      "ProjectMetaSchema",
      ProjectMetaSchema,
      {
        schemaVersion: inkforgeSchemaVersion,
        projectId: "project-1",
        title: "InkForge",
        createdAt: now,
        updatedAt: now
      }
    ],
    ["ChapterStatusSchema", ChapterStatusSchema, "drafting"],
    ["ChapterPlanSchema", ChapterPlanSchema, chapter],
    ["VolumePlanSchema", VolumePlanSchema, { id: "volume-1", title: "Volume One", chapters: [chapter] }],
    ["OutlineSchema", OutlineSchema, outline],
    ["CharacterSchema", CharacterSchema, { id: "character-1", name: "Ada" }],
    ["WorldEntrySchema", WorldEntrySchema, { id: "world-1", title: "Harbor", type: "location" }],
    ["TimelineEventSchema", TimelineEventSchema, { id: "event-1", order: 1, title: "Arrival" }],
    ["ClueSchema", ClueSchema, { id: "clue-1", title: "Broken compass", status: "planted" }],
    ["TermSchema", TermSchema, { id: "term-1", name: "Anchorite" }],
    [
      "PromptTemplateSchema",
      PromptTemplateSchema,
      { id: "prompt-1", name: "Draft", system: "Write clearly.", userTemplate: "Scene: {{scene}}", output: "json" }
    ],
    [
      "ChapterSummarySchema",
      ChapterSummarySchema,
      {
        schemaVersion: inkforgeSchemaVersion,
        chapterId: "chapter-1",
        chapterTitle: "Opening",
        savedAt: now
      }
    ],
    ["PlanningMessageSchema", PlanningMessageSchema, { id: "message-1", role: "user", createdAt: now }],
    ["PlanningPackageSchema", PlanningPackageSchema, { meta: { title: "Plan" }, outline }],
    [
      "PlanningSessionSchema",
      PlanningSessionSchema,
      {
        id: "session-1",
        projectId: "project-1",
        title: "Planning",
        createdAt: now,
        updatedAt: now,
        package: { meta: { title: "Plan" }, outline }
      }
    ],
    ["PlanningImportSelectionSchema", PlanningImportSelectionSchema, {}],
    ["PlanningImportResultSchema", PlanningImportResultSchema, { snapshotId: "snapshot-1" }],
    [
      "AgentChatSessionSchema",
      AgentChatSessionSchema,
      {
        id: "agent-chapter-1",
        projectId: "project-1",
        chapterId: "chapter-1",
        title: "Opening chat",
        messages: [{ id: "message-1", role: "assistant", content: "Ready.", createdAt: now }],
        proposals: [
          {
            id: "proposal-1",
            chapterId: "chapter-1",
            mode: "append",
            content: "New prose.",
            createdAt: now
          }
        ],
        updatedAt: now
      }
    ],
    [
      "ChapterMemorySchema",
      ChapterMemorySchema,
      {
        chapterId: "chapter-1",
        summary: "The gate opens.",
        unresolvedThreads: ["Who rang the bell?"],
        keywords: ["gate", "bell"],
        updatedAt: now
      }
    ],
    [
      "PipelineSchema",
      PipelineSchema,
      {
        id: "draft-pipeline",
        name: "Draft pipeline",
        steps: [{ id: "context", name: "Gather context", kind: "context" }]
      }
    ],
    [
      "ChapterEndStateSchema",
      ChapterEndStateSchema,
      {
        chapterId: "chapter-1",
        summary: "The protagonist crosses the threshold.",
        characterStates: [{ characterId: "character-1", location: "Harbor" }]
      }
    ],
    [
      "WritingSessionSchema",
      WritingSessionSchema,
      {
        id: "session-1",
        projectId: "project-1",
        chapterId: "chapter-1",
        scenePlans: [{ id: "scene-1", chapterId: "chapter-1", order: 0, title: "Arrival" }]
      }
    ],
    [
      "ScenePlanSchema",
      ScenePlanSchema,
      {
        id: "scene-1",
        chapterId: "chapter-1",
        order: 0,
        title: "Arrival",
        beats: [{ id: "beat-1", order: 0, action: "Mira enters the harbor." }]
      }
    ],
    [
      "DecisionPointSchema",
      DecisionPointSchema,
      {
        id: "decision-1",
        label: "Choose ally",
        question: "Who helps Mira escape?",
        options: [{ id: "ally", label: "The smuggler", risks: ["betrayal"] }]
      }
    ],
    [
      "PipelineExecutionSchema",
      PipelineExecutionSchema,
      {
        id: "execution-1",
        pipelineId: "draft-pipeline",
        steps: [{ stepId: "context", status: "completed", attempts: 1 }],
        outputs: { context: "Ready" }
      }
    ]
  ] satisfies Array<[string, ZodType, unknown]>)("parses valid %s input", (_name, schema, value) => {
    expect(schema.parse(value)).toBeDefined();
  });

  it.each([
    [
      "missing required ProjectMeta.title",
      ProjectMetaSchema,
      { schemaVersion: inkforgeSchemaVersion, projectId: "p1", createdAt: now, updatedAt: now }
    ],
    [
      "wrong ProjectMeta.targetWords type",
      ProjectMetaSchema,
      {
        schemaVersion: inkforgeSchemaVersion,
        projectId: "p1",
        title: "InkForge",
        createdAt: now,
        updatedAt: now,
        targetWords: "many"
      }
    ],
    ["missing required ChapterPlan.file", ChapterPlanSchema, { id: "chapter-1", number: 1, title: "Opening" }],
    ["wrong ChapterPlan.number type", ChapterPlanSchema, { ...chapter, number: "1" }],
    ["missing required Outline.schemaVersion", OutlineSchema, { premise: "No version" }],
    ["wrong Character.aliases type", CharacterSchema, { id: "character-1", name: "Ada", aliases: "A" }],
    ["missing required WorldEntry.title", WorldEntrySchema, { id: "world-1" }],
    ["wrong TimelineEvent.order type", TimelineEventSchema, { id: "event-1", order: "first", title: "Arrival" }],
    [
      "missing required PromptTemplate.system",
      PromptTemplateSchema,
      { id: "prompt-1", name: "Draft", userTemplate: "{{scene}}" }
    ],
    [
      "wrong PlanningSession.messages type",
      PlanningSessionSchema,
      { id: "session-1", projectId: "project-1", title: "Planning", messages: {}, createdAt: now, updatedAt: now }
    ],
    [
      "AgentChatSessionSchema rejects unsafe proposal mode",
      AgentChatSessionSchema,
      {
        id: "agent-chapter-1",
        projectId: "project-1",
        chapterId: "chapter-1",
        title: "Opening chat",
        proposals: [
          {
            id: "proposal-1",
            chapterId: "chapter-1",
            mode: "overwrite-project",
            content: "Unsafe.",
            createdAt: now
          }
        ],
        updatedAt: now
      }
    ],
    [
      "PipelineSchema requires at least one step",
      PipelineSchema,
      { id: "draft-pipeline", name: "Draft pipeline", steps: [] }
    ],
    [
      "PipelineStepSchema rejects unknown kind",
      PipelineSchema,
      { id: "draft-pipeline", name: "Draft pipeline", steps: [{ id: "x", name: "X", kind: "unknown" }] }
    ],
    ["ScenePlanSchema requires chapterId", ScenePlanSchema, { id: "scene-1", order: 0, title: "Arrival" }],
    [
      "DecisionPointSchema requires at least one option",
      DecisionPointSchema,
      { id: "decision-1", label: "Choice", question: "Choose?", options: [] }
    ],
    [
      "WritingSessionSchema rejects negative actual words",
      WritingSessionSchema,
      { id: "session-1", projectId: "project-1", chapterId: "chapter-1", actualWords: -1 }
    ],
    [
      "PipelineExecutionSchema rejects unknown status",
      PipelineExecutionSchema,
      { id: "execution-1", pipelineId: "pipeline-1", status: "waiting" }
    ]
  ] satisfies Array<[string, ZodType, unknown]>)("throws ZodError for %s", (_name, schema, value) => {
    expectZodError(schema, value);
  });
});

describe("createProjectId", () => {
  const fixedDate = new Date("2024-06-07T08:09:10.000Z");

  it("normalizes common title text", () => {
    expect(createProjectId("  My Great Novel!  ", fixedDate)).toBe("novel_20240607_my-great-novel");
  });

  it("keeps unicode letters and numbers", () => {
    expect(createProjectId("星海 42", fixedDate)).toBe("novel_20240607_星海-42");
  });

  it("falls back to untitled for empty or punctuation-only titles", () => {
    expect(createProjectId("", fixedDate)).toBe("novel_20240607_untitled");
    expect(createProjectId(" !!! --- ", fixedDate)).toBe("novel_20240607_untitled");
  });

  it("limits the normalized title segment to 36 characters", () => {
    expect(createProjectId("abcdefghijklmnopqrstuvwxyz0123456789-extra", fixedDate)).toBe(
      "novel_20240607_abcdefghijklmnopqrstuvwxyz0123456789"
    );
  });
});

describe("PlanningImportSelectionSchema", () => {
  it("defaults overwrite conflict choices independently from selected ids", () => {
    expect(PlanningImportSelectionSchema.parse({ characters: ["char-1"] })).toMatchObject({
      characters: ["char-1"],
      overwrite: {
        characters: [],
        worldEntries: [],
        timeline: [],
        terms: [],
        clues: [],
        outlineVolumeIds: []
      }
    });
  });
});

describe("AgentRunTraceSchema", () => {
  it("parses persisted trace metrics and stream events", () => {
    const trace = AgentRunTraceSchema.parse({
      id: "trace-1",
      requestId: "request-1",
      chapterId: "chapter-1",
      userMessage: "继续写",
      status: "completed",
      model: "test-model",
      startedAt: "2026-01-01T00:00:00.000Z",
      durationMs: 18,
      usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 },
      context: { tokenBudget: 2600, estimatedTokens: 1200, semanticHits: 3 },
      events: [
        {
          id: "event-1",
          type: "tool_completed",
          timestamp: "2026-01-01T00:00:00.010Z",
          toolName: "semantic_search",
          label: "语义检索",
          detail: "命中 3 条"
        }
      ]
    });

    expect(trace.context?.semanticHits).toBe(3);
    expect(trace.events[0].toolName).toBe("semantic_search");
  });
});

describe("writing workspace annotations", () => {
  it("defaults legacy annotations to comment kind with open status", async () => {
    const { WritingWorkspaceSchema } = await import("../src/workspace");
    const workspace = WritingWorkspaceSchema.parse({
      annotations: [
        {
          id: "annotation-1",
          chapterId: "chapter-1",
          start: 0,
          end: 4,
          quote: "旧数据",
          note: "升级前创建",
          color: "green",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    });
    expect(workspace.annotations[0].kind).toBe("comment");
    expect(workspace.annotations[0].status).toBe("open");
  });

  it("round-trips revision marks with resolved status", async () => {
    const { WritingAnnotationSchema } = await import("../src/workspace");
    const mark = WritingAnnotationSchema.parse({
      id: "annotation-2",
      chapterId: "chapter-1",
      start: 10,
      end: 24,
      quote: "需要返工的句子",
      note: "节奏太拖",
      color: "rose",
      kind: "revision",
      status: "resolved",
      createdAt: "2026-01-01T00:00:00.000Z"
    });
    expect(mark.kind).toBe("revision");
    expect(mark.status).toBe("resolved");
  });
});
