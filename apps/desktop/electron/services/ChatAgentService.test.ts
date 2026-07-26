import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentChatSession, AgentPatchBlock } from "@inkforge/schemas";
import type { ChatCompletionToolCall } from "@inkforge/ai-provider";
import {
  ChatAgentService,
  applyAgentPatchBlocks,
  agentCollaborationInstruction,
  chooseUsableEditedDraft,
  collaborationRequestsRework,
  conversationBudgetForMessage,
  formatOutlineMemory,
  maxAgentMessageCharacters,
  mergeCharacterRecord,
  mergeOutlineUpdate,
  isLongFormGroupWritingRequest,
  parseDirectorScenePlan,
  reviewEditedDraft,
  resolveTargetAgents,
  sanitizeLegacyAgentSession,
  toolCallFingerprint,
  validateAgentPatchBlocks,
  visibleBranchMessages,
  writingApproachInstruction
} from "./ChatAgentService.js";
import {
  BeatBoardSchema,
  CharacterSchema,
  OutlineSchema,
  SimulationScenarioSchema,
  defaultAgentMembers,
  inkforgeSchemaVersion
} from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";
import { LibraryService } from "./LibraryService.js";
import { NarrativeBoardService } from "./NarrativeBoardService.js";
import { ProjectService } from "./ProjectService.js";
import { SimulationService } from "./SimulationService.js";
import { StoryStateService } from "./StoryStateService.js";

describe("agent group routing", () => {
  it("resolves enabled @ targets and generates bounded role instructions", () => {
    const targets = resolveTargetAgents(defaultAgentMembers, ["writer", "editor", "missing"]);
    expect(targets.map((member) => member.id)).toEqual(["writer", "editor"]);
    expect(agentCollaborationInstruction(targets)).toContain("### @成员名");
    expect(agentCollaborationInstruction([defaultAgentMembers[2]])).toContain("@编辑");
  });

  it("routes long-form @ group writing into the staged pipeline", () => {
    expect(isLongFormGroupWritingRequest("@全体 完成第二章", defaultAgentMembers, "direct", "inspiration")).toBe(true);
    expect(isLongFormGroupWritingRequest("@全体 分析第二章的问题", defaultAgentMembers, "direct", "stable")).toBe(
      false
    );
    expect(isLongFormGroupWritingRequest("@全体 完成第二章", defaultAgentMembers, "plan", "stable")).toBe(false);
  });

  it("keeps the complete writer draft when the editor output is empty or heavily truncated", () => {
    const writerDraft = "正文".repeat(1_000);
    expect(chooseUsableEditedDraft(writerDraft, "")).toBe(writerDraft);
    expect(chooseUsableEditedDraft(writerDraft, "过短")).toBe(writerDraft);
    expect(chooseUsableEditedDraft(writerDraft, "修订".repeat(800))).toBe("修订".repeat(800));
  });

  it("parses strict director scene headings and blocks fact-losing edits", () => {
    const scenes = parseDirectorScenePlan("### 场景 1｜进入废墟\n目标：找到水源\n\n### 场景 2｜傀儡苏醒\n冲突：活下来");
    expect(scenes.map((scene) => scene.title)).toEqual(["进入废墟", "傀儡苏醒"]);
    const review = reviewEditedDraft(`乐园能源只剩3%。${"正文".repeat(400)}`, "能源告急。" + "修订".repeat(300), [
      "3%"
    ]);
    expect(review.usable).toBe(false);
    expect(review.removedFacts).toEqual(["3%"]);
    expect(collaborationRequestsRework("VERDICT: REWORK\n人物动机缺失")).toBe(true);
    expect(collaborationRequestsRework("VERDICT: APPROVE")).toBe(false);
  });

  it("creates a pending long-form proposal without writing the chapter file", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-group-pipeline-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const project = await projects.createProject(parentDir, {
        title: "群聊整章测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: "测试分阶段正文生成"
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const chapterPath = files.assertInsideProject(project.projectPath, chapter.file);
      await files.writeTextAtomic(chapterPath, "");
      const completions = [
        "### 场景 1｜建立目标\n目标：进入废墟\n\n### 场景 2｜冲突升级\n目标：解决威胁",
        "已确认事实：人物仍在废墟，目标未改变。",
        "甲".repeat(500),
        "乙".repeat(500),
        "编辑".repeat(400),
        "VERDICT: APPROVE\n场景目标和硬事实均已保留。"
      ];
      const ai = {
        runAgentCompletion: async () => ({
          message: { role: "assistant" as const, content: completions.shift() ?? "" },
          model: "mock-model",
          usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 }
        }),
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(
        files,
        projects,
        new LibraryService(files),
        new StoryStateService(files, projects),
        ai as never
      );

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "@全体 完成第一章",
        mode: "direct",
        writingApproach: "stable",
        targetAgentIds: ["director", "writer", "editor", "librarian"]
      });

      const proposal = session.proposals.at(-1);
      expect(proposal).toMatchObject({ status: "pending", mode: "replace" });
      expect(proposal?.content).toBe("编辑".repeat(400));
      expect(proposal?.review).toMatchObject({ sceneCount: 2, sourceCharacters: 1_002 });
      expect(proposal?.sourceContent).toContain("甲");
      expect(session.collaborationRuns.at(-1)).toMatchObject({
        status: "completed",
        coordinatorId: "director"
      });
      expect(session.collaborationRuns.at(-1)?.agents).toHaveLength(4);
      expect(session.collaborationRuns.at(-1)?.messages.some((message) => message.kind === "handoff")).toBe(true);
      expect(await readFile(chapterPath, "utf8")).toBe("");
      expect(session.messages.at(-1)?.agentName).toBe("@创作组");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("runs ordinary group discussion as independent agents followed by coordinator synthesis", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-agent-discussion-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const project = await projects.createProject(parentDir, {
        title: "多人讨论测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: "验证独立会话与协调汇总"
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const outputs = [
        {
          role: "assistant" as const,
          content: "",
          tool_calls: [
            {
              id: "writer-context",
              type: "function" as const,
              function: {
                name: "get_chapter_context",
                arguments: JSON.stringify({ include_full_text: false })
              }
            }
          ]
        },
        { role: "assistant" as const, content: "作家独立意见" },
        { role: "assistant" as const, content: "编辑独立意见" },
        { role: "assistant" as const, content: "协调者综合结论" }
      ];
      const ai = {
        runAgentCompletion: async () => ({
          message: outputs.shift() ?? { role: "assistant" as const, content: "" },
          model: "mock-model"
        }),
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(
        files,
        projects,
        new LibraryService(files),
        new StoryStateService(files, projects),
        ai as never
      );

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "@导演 @作家 @编辑 分析本章开头的问题",
        mode: "direct",
        writingApproach: "stable",
        targetAgentIds: ["director", "writer", "editor"]
      });
      const run = session.collaborationRuns.at(-1);

      expect(run).toMatchObject({ status: "completed", coordinatorId: "director" });
      expect(run?.tasks).toHaveLength(3);
      expect(run?.tasks.every((task) => task.status === "approved")).toBe(true);
      expect(run?.agents.find((agent) => agent.agentId === "writer")?.transcript).toHaveLength(3);
      expect(session.messages.some((message) => message.agentId === "writer")).toBe(true);
      expect(session.messages.some((message) => message.agentId === "editor")).toBe(true);
      expect(
        session.messages.some(
          (message) =>
            message.role === "tool" && message.agentId === "writer" && message.toolName === "get_chapter_context"
        )
      ).toBe(true);
      expect(session.messages.at(-1)?.content).toBe("协调者综合结论");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("resumes at the first unfinished scene after an interrupted generation", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-group-resume-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const project = await projects.createProject(parentDir, {
        title: "断点续写测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: "验证逐场景恢复"
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const chapterPath = files.assertInsideProject(project.projectPath, chapter.file);
      await files.writeTextAtomic(chapterPath, "");
      let firstCalls = 0;
      const firstAi = {
        runAgentCompletion: async () => {
          firstCalls += 1;
          if (firstCalls === 1) {
            return {
              message: {
                role: "assistant" as const,
                content: "### 场景 1｜进入遗迹\n目标：找到入口\n\n### 场景 2｜遭遇守卫\n目标：成功脱身"
              },
              model: "mock-model"
            };
          }
          if (firstCalls === 2) {
            return {
              message: { role: "assistant" as const, content: "事实交接单" },
              model: "mock-model"
            };
          }
          if (firstCalls === 3) {
            return {
              message: { role: "assistant" as const, content: "甲".repeat(500) },
              model: "mock-model"
            };
          }
          throw new Error("simulated interruption");
        },
        cancelTask: () => undefined
      };
      const firstService = new ChatAgentService(
        files,
        projects,
        new LibraryService(files),
        new StoryStateService(files, projects),
        firstAi as never
      );
      const request = {
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "@全体 完成第一章",
        mode: "direct" as const,
        writingApproach: "stable" as const,
        targetAgentIds: ["director", "writer", "editor", "librarian"]
      };

      await expect(firstService.chat(request)).rejects.toThrow("simulated interruption");
      expect(firstCalls).toBe(4);

      let resumedCalls = 0;
      const resumedOutputs = ["乙".repeat(500), "编辑".repeat(400), "VERDICT: APPROVE\n通过验收。"];
      const resumedAi = {
        runAgentCompletion: async () => {
          resumedCalls += 1;
          return {
            message: { role: "assistant" as const, content: resumedOutputs.shift() ?? "" },
            model: "mock-model"
          };
        },
        cancelTask: () => undefined
      };
      const resumedService = new ChatAgentService(
        files,
        projects,
        new LibraryService(files),
        new StoryStateService(files, projects),
        resumedAi as never
      );
      const session = await resumedService.chat(request);

      expect(resumedCalls).toBe(3);
      expect(session.proposals.at(-1)?.sourceContent).toContain("甲");
      expect(session.proposals.at(-1)?.sourceContent).toContain("乙");
      expect(session.proposals.at(-1)?.content).toBe("编辑".repeat(400));
      expect(await readFile(chapterPath, "utf8")).toBe("");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("executes one bounded writer rework and final editor pass when coordinator rejects", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-agent-rework-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const project = await projects.createProject(parentDir, {
        title: "返工链路测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: "验证协调验收和返工"
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const outputs = [
        "### 场景 1｜进入遗迹\n目标：找到入口\n\n### 场景 2｜守卫苏醒\n目标：脱离追击",
        "确认事实：主角仍在遗迹。",
        "甲".repeat(500),
        "乙".repeat(500),
        "初编".repeat(400),
        "VERDICT: REWORK\n主角的关键选择缺乏动作支撑。",
        "返工".repeat(450),
        "终编".repeat(400)
      ];
      const ai = {
        runAgentCompletion: async () => ({
          message: { role: "assistant" as const, content: outputs.shift() ?? "" },
          model: "mock-model"
        }),
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(
        files,
        projects,
        new LibraryService(files),
        new StoryStateService(files, projects),
        ai as never
      );

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "@全体 完成第一章",
        mode: "direct",
        writingApproach: "stable",
        targetAgentIds: ["director", "writer", "editor", "librarian"]
      });
      const run = session.collaborationRuns.at(-1);

      expect(session.proposals.at(-1)?.content).toBe("终编".repeat(400));
      expect(run?.tasks.find((task) => task.id === "chapter-writer-rework")?.status).toBe("approved");
      expect(run?.tasks.find((task) => task.id === "chapter-final-editor-pass")?.status).toBe("approved");
      expect(run?.tasks.find((task) => task.id === "chapter-writer-rework")?.attempt).toBe(1);
      expect(run?.status).toBe("completed");
      expect(outputs).toHaveLength(0);
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });
});

describe("agent data proposals and tool dedup", () => {
  it("applies a partial world update without wiping existing fields", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-data-merge-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const library = new LibraryService(files);
      const story = new StoryStateService(files, projects);
      const project = await projects.createProject(parentDir, {
        title: "资料合并测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: "验证局部更新不清空既有字段"
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const originalContent = "旧港的门规：夜间不得鸣钟。".repeat(20);
      await library.saveWorldEntry(project.projectPath, {
        id: "w1",
        title: "旧港",
        type: "location",
        locked: true,
        tags: ["core"],
        summary: "重要港口城市",
        content: originalContent,
        relatedCharacters: ["c1"],
        relatedClues: []
      });

      const toolCall = {
        id: "call-1",
        type: "function" as const,
        function: {
          name: "propose_world_update",
          arguments: JSON.stringify({
            entity: { id: "w1", title: "旧港", tags: ["core", "haunted"] },
            explanation: "标记为闹鬼地点"
          })
        }
      };
      let served = false;
      const ai = {
        runAgentCompletion: async () =>
          served
            ? { message: { role: "assistant" as const, content: "已生成提案。" }, model: "mock" }
            : ((served = true),
              { message: { role: "assistant" as const, content: "", tool_calls: [toolCall] }, model: "mock" }),
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(files, projects, library, story, ai as never);

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "把旧港标记为闹鬼地点",
        mode: "direct",
        writingApproach: "stable"
      });
      const proposal = session.dataProposals.at(-1);
      expect(proposal).toMatchObject({ entityType: "world", status: "pending" });

      await service.resolveDataChange({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        proposalId: proposal!.id,
        action: "apply"
      });

      const entry = (await library.listWorldEntries(project.projectPath)).find((item) => item.id === "w1");
      expect(entry?.content).toBe(originalContent);
      expect(entry?.summary).toBe("重要港口城市");
      expect(entry?.tags).toEqual(["core", "haunted"]);
      expect(entry?.relatedCharacters).toEqual(["c1"]);
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("serves the narrative board with structure analysis to the model", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-agent-board-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const library = new LibraryService(files);
      const story = new StoryStateService(files, projects);
      const project = await projects.createProject(parentDir, {
        title: "叙事板读取测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: ""
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const boards = new NarrativeBoardService(files);
      await boards.save(
        project.projectPath,
        BeatBoardSchema.parse({
          acts: [
            {
              id: "act-1",
              title: "第一幕",
              beats: [
                { id: "b1", title: "相遇", type: "setup", tension: 30 },
                { id: "b2", title: "摊牌", type: "climax", tension: 90 }
              ]
            }
          ]
        })
      );

      const toolCall = {
        id: "call-board",
        type: "function" as const,
        function: { name: "get_narrative_board", arguments: "{}" }
      };
      let served = false;
      const ai = {
        runAgentCompletion: async () =>
          served
            ? { message: { role: "assistant" as const, content: "结构已读取。" }, model: "mock" }
            : ((served = true),
              { message: { role: "assistant" as const, content: "", tool_calls: [toolCall] }, model: "mock" }),
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(files, projects, library, story, ai as never);

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "现在的节奏结构怎么样？",
        mode: "direct",
        writingApproach: "stable"
      });
      const toolMessage = session.messages.find((item) => item.toolName === "get_narrative_board");
      expect(toolMessage?.toolStatus).toBe("completed");
      expect(toolMessage?.content).toContain("1 幕 2 个节拍");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("applies beat proposals with partial merge and act creation", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-agent-beat-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const library = new LibraryService(files);
      const story = new StoryStateService(files, projects);
      const project = await projects.createProject(parentDir, {
        title: "节拍提案测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: ""
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const boards = new NarrativeBoardService(files);
      await boards.save(
        project.projectPath,
        BeatBoardSchema.parse({
          acts: [
            {
              id: "act-1",
              title: "第一幕",
              beats: [{ id: "b1", title: "相遇", type: "setup", tension: 30, summary: "两人在车站相遇。" }]
            }
          ]
        })
      );

      const toolCall = {
        id: "call-beat",
        type: "function" as const,
        function: {
          name: "propose_beat_update",
          arguments: JSON.stringify({
            act_title: "第二幕",
            beats: [
              { id: "b1", tension: 85 },
              { title: "深夜对峙", type: "climax", tension: 92 }
            ],
            explanation: "提高相遇的张力，并补一场高潮"
          })
        }
      };
      let served = false;
      const ai = {
        runAgentCompletion: async () =>
          served
            ? { message: { role: "assistant" as const, content: "已生成节拍提案。" }, model: "mock" }
            : ((served = true),
              { message: { role: "assistant" as const, content: "", tool_calls: [toolCall] }, model: "mock" }),
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(files, projects, library, story, ai as never);

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "把张力曲线拉起来",
        mode: "direct",
        writingApproach: "stable"
      });
      const proposal = session.dataProposals.at(-1);
      expect(proposal).toMatchObject({ entityType: "beat", status: "pending" });

      await service.resolveDataChange({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        proposalId: proposal!.id,
        action: "apply"
      });

      const board = await boards.load(project.projectPath);
      const updated = board.acts[0].beats.find((beat) => beat.id === "b1");
      expect(updated).toMatchObject({ title: "相遇", tension: 85, summary: "两人在车站相遇。" });
      const secondAct = board.acts.find((act) => act.title === "第二幕");
      expect(secondAct?.beats).toHaveLength(1);
      expect(secondAct?.beats[0]).toMatchObject({ title: "深夜对峙", type: "climax", tension: 92 });
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("serves recent simulation runs to the model", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-agent-sim-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const library = new LibraryService(files);
      const story = new StoryStateService(files, projects);
      const project = await projects.createProject(parentDir, {
        title: "推演读取测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: ""
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const simulations = new SimulationService(files, library, { cancelTask: () => undefined } as never);
      await simulations.saveScenario(
        project.projectPath,
        SimulationScenarioSchema.parse({
          id: "scene-1",
          title: "深夜对峙",
          premise: "站长深夜出现在储物间。",
          participants: [{ characterId: "lin", goal: "弄清真相", knowledge: [], hiddenAgenda: "" }]
        })
      );

      const toolCall = {
        id: "call-sim",
        type: "function" as const,
        function: { name: "get_simulation_runs", arguments: "{}" }
      };
      let served = false;
      const ai = {
        runAgentCompletion: async () =>
          served
            ? { message: { role: "assistant" as const, content: "推演已读取。" }, model: "mock" }
            : ((served = true),
              { message: { role: "assistant" as const, content: "", tool_calls: [toolCall] }, model: "mock" }),
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(files, projects, library, story, ai as never);

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "参考推演结果给我一个走向建议",
        mode: "direct",
        writingApproach: "stable"
      });
      const toolMessage = session.messages.find((item) => item.toolName === "get_simulation_runs");
      expect(toolMessage?.toolStatus).toBe("completed");
      expect(toolMessage?.content).toContain("1 个推演场景");
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });

  it("skips a repeated read-only tool call instead of ending the run", async () => {
    const parentDir = await mkdtemp(path.join(os.tmpdir(), "inkforge-dedup-"));
    try {
      const files = new FileRepository();
      const projects = new ProjectService(files);
      const project = await projects.createProject(parentDir, {
        title: "去重测试",
        author: "作者",
        genre: [],
        targetWords: 100_000,
        style: "",
        protagonist: "",
        premise: "验证重复读取工具不终止运行"
      });
      const chapter = project.outline.volumes[0].chapters[0];
      const readCall = {
        type: "function" as const,
        function: { name: "get_chapter_context", arguments: JSON.stringify({ include_full_text: false }) }
      };
      const turns = [
        {
          message: { role: "assistant" as const, content: "", tool_calls: [{ ...readCall, id: "c1" }] },
          model: "mock"
        },
        {
          message: { role: "assistant" as const, content: "", tool_calls: [{ ...readCall, id: "c2" }] },
          model: "mock"
        },
        { message: { role: "assistant" as const, content: "根据上下文，这是最终答复。" }, model: "mock" }
      ];
      let index = 0;
      const ai = {
        runAgentCompletion: async () => turns[index++] ?? turns[turns.length - 1],
        cancelTask: () => undefined
      };
      const service = new ChatAgentService(
        files,
        projects,
        new LibraryService(files),
        new StoryStateService(files, projects),
        ai as never
      );

      const session = await service.chat({
        projectPath: project.projectPath,
        chapterId: chapter.id,
        message: "分析本章",
        mode: "direct",
        writingApproach: "stable",
        limits: { maxTurns: 5, maxToolCalls: 10 }
      });

      expect(index).toBe(3);
      expect(session.messages.at(-1)?.content).toBe("根据上下文，这是最终答复。");
      expect(session.messages.some((message) => /停止重复工具调用/.test(message.content))).toBe(false);
    } finally {
      await rm(parentDir, { recursive: true, force: true });
    }
  });
});

const block = (patch: Partial<AgentPatchBlock>): AgentPatchBlock => ({
  id: "patch-1",
  operation: "replace",
  originalText: "",
  proposedText: "",
  explanation: "",
  status: "accepted",
  ...patch
});

describe("agent chapter patches", () => {
  it("applies accepted insert, replace and delete blocks in order", () => {
    const result = applyAgentPatchBlocks("甲。\n\n乙。\n\n丙。", [
      block({ id: "replace", originalText: "甲。", proposedText: "新甲。" }),
      block({ id: "insert", operation: "insert_after", originalText: "乙。", proposedText: "\n\n新增。" }),
      block({ id: "delete", operation: "delete", originalText: "\n\n丙。" })
    ]);

    expect(result).toBe("新甲。\n\n乙。\n\n新增。");
  });

  it("supports appending with an empty insert anchor", () => {
    expect(
      applyAgentPatchBlocks("原文。", [block({ operation: "insert_after", originalText: "", proposedText: "续写。" })])
    ).toBe("原文。\n\n续写。");
  });

  it("rejects stale anchors before a proposal is created", () => {
    expect(
      validateAgentPatchBlocks("当前正文", [block({ originalText: "已经被作者改掉的原文", proposedText: "替换内容" })])
    ).toContain("找不到");
  });

  it("throws instead of silently applying a missing anchor", () => {
    expect(() =>
      applyAgentPatchBlocks("当前正文", [block({ originalText: "不存在", proposedText: "替换内容" })])
    ).toThrow("找不到");
  });
});

describe("agent structured data merging", () => {
  it("preserves character profile and current-state siblings during partial nested updates", () => {
    const existing = CharacterSchema.parse({
      id: "char-1",
      name: "沈青",
      profile: {
        age: "27",
        identity: "调查员",
        motivation: "查清旧案",
        personality: "克制"
      },
      currentState: {
        arc: "第一卷",
        powerLevel: "普通人",
        location: "旧港",
        relationships: ["顾舟：搭档"],
        secrets: ["隐瞒证物"]
      }
    });

    const merged = mergeCharacterRecord(existing, {
      id: "char-1",
      profile: { motivation: "保护证人" },
      currentState: { location: "北站" }
    });

    expect(merged.profile).toEqual({
      age: "27",
      identity: "调查员",
      motivation: "保护证人",
      personality: "克制"
    });
    expect(merged.currentState.location).toBe("北站");
    expect(merged.currentState.secrets).toEqual(["隐瞒证物"]);
    expect(merged.currentState.relationships).toEqual(["顾舟：搭档"]);
  });

  it("updates and appends outline chapters without losing current chapter identity or file", () => {
    const existing = OutlineSchema.parse({
      schemaVersion: inkforgeSchemaVersion,
      premise: "一场失踪案牵出旧城秘密",
      mainConflict: "真相与亲情冲突",
      volumes: [
        {
          id: "vol-001",
          title: "第一卷",
          chapters: [
            {
              id: "ch-0001",
              number: 1,
              title: "雨夜",
              file: "chapters/volume-001/ch-0001.md",
              goal: "接案"
            }
          ]
        }
      ]
    });

    const merged = mergeOutlineUpdate(
      existing,
      {
        mainConflict: "真相、亲情与城市秩序冲突",
        volumes: [
          {
            id: "vol-001",
            chapters: [
              { id: "ch-0001", goal: "接案并发现矛盾证词" },
              { number: 2, title: "北站来客", goal: "追踪证人" }
            ]
          }
        ]
      },
      false,
      "ch-0001"
    );

    expect(merged.mainConflict).toContain("城市秩序");
    expect(merged.volumes[0].chapters[0]).toMatchObject({
      id: "ch-0001",
      file: "chapters/volume-001/ch-0001.md",
      goal: "接案并发现矛盾证词"
    });
    expect(merged.volumes[0].chapters[1]).toMatchObject({
      title: "北站来客",
      file: "chapters/volume-001/ch-0002.md"
    });

    const duplicateNumber = mergeOutlineUpdate(
      existing,
      {
        volumes: [{ id: "vol-001", chapters: [{ number: 1, title: "新的第一章" }] }]
      },
      false,
      "ch-0001"
    );
    const files = duplicateNumber.volumes[0].chapters.map((chapter) => chapter.file);
    expect(new Set(files).size).toBe(files.length);
    expect(duplicateNumber.volumes[0].chapters.at(-1)?.file).not.toBe("chapters/volume-001/ch-0001.md");
  });

  it("formats the outline as persistent Agent memory", () => {
    const outline = OutlineSchema.parse({
      schemaVersion: inkforgeSchemaVersion,
      premise: "一场失踪案牵出旧城秘密",
      mainConflict: "真相与亲情冲突",
      endingDirection: "主角公开真相",
      volumes: [
        {
          id: "vol-001",
          title: "迷雾卷",
          goal: "找到第一名证人",
          chapters: [
            {
              id: "ch-0001",
              number: 1,
              title: "雨夜",
              file: "chapters/volume-001/ch-0001.md",
              goal: "接案",
              hook: "证人失踪"
            }
          ]
        }
      ]
    });

    const memory = formatOutlineMemory(outline, "ch-0001");
    expect(memory).toContain("大纲长期记忆");
    expect(memory).toContain("一场失踪案牵出旧城秘密");
    expect(memory).toContain("雨夜");
    expect(memory).toContain("证人失踪");
  });
});

describe("agent writing approaches", () => {
  it("keeps stable writing backward compatible", () => {
    expect(writingApproachInstruction("stable")).toBe("");
    expect(writingApproachInstruction(undefined)).toBe("");
  });

  it("adds bounded inspiration constraints without forcing random twists", () => {
    const instruction = writingApproachInstruction("inspiration");
    expect(instruction).toContain("视角人物");
    expect(instruction).toContain("私人的小目标");
    expect(instruction).toContain("不得在同一场中完整解释");
    expect(instruction).toContain("时间、数字、人物、事件和因果是硬事实");
    expect(instruction).toContain("不要为了“特别”破坏连贯性");
  });

  it("makes comparison output independent, balanced and read-only", () => {
    const instruction = writingApproachInstruction("compare");
    expect(instruction).toContain("A｜稳定版");
    expect(instruction).toContain("B｜灵感版");
    expect(instruction).toContain("篇幅和情节任务相当");
    expect(instruction).toContain("禁止生成任何会修改正文或资料的提案");
  });

  it("does not inject prose constraints into Plan mode", () => {
    expect(writingApproachInstruction("inspiration", "plan")).toBe("");
  });
});

describe("agent tool loop guard", () => {
  const call = (argumentsValue: string): ChatCompletionToolCall => ({
    id: "call-1",
    type: "function",
    function: {
      name: "propose_chapter_patch",
      arguments: argumentsValue
    }
  });

  it("treats repeatedly truncated JSON as the same failed tool call", () => {
    expect(toolCallFingerprint(call('{"blocks":['))).toBe(toolCallFingerprint(call('{"explanation":"扩写"')));
  });

  it("normalizes object key order while preserving different arguments", () => {
    expect(toolCallFingerprint(call('{"blocks":[],"explanation":"扩写"}'))).toBe(
      toolCallFingerprint(call('{"explanation":"扩写","blocks":[]}'))
    );
    expect(toolCallFingerprint(call('{"blocks":[],"explanation":"改写"}'))).not.toBe(
      toolCallFingerprint(call('{"blocks":[],"explanation":"扩写"}'))
    );
  });
});

describe("agent long messages", () => {
  it("reserves enough conversation budget to keep a long current document intact", () => {
    const longDocument = "世".repeat(120_000);
    expect(conversationBudgetForMessage(longDocument, 64_000, 2_600)).toBeGreaterThanOrEqual(40_000);
  });

  it("allows a substantially larger document while retaining a finite safety cap", () => {
    expect(maxAgentMessageCharacters).toBe(180_000);
  });
});

describe("legacy demo cleanup", () => {
  it("removes contaminated assistant replies while preserving author messages", () => {
    const session: AgentChatSession = {
      schemaVersion: "0.1.0",
      id: "session-legacy",
      projectId: "project-1",
      chapterId: "chapter-1",
      title: "创作对话",
      messages: [
        {
          id: "author-outline",
          role: "user",
          content: "这是作者真正导入的大纲。",
          createdAt: "2026-01-01",
          branchId: "main"
        },
        {
          id: "legacy-answer",
          role: "assistant",
          content: "林烬正在寻找失踪的父亲。",
          createdAt: "2026-01-02",
          branchId: "main"
        }
      ],
      proposals: [],
      dataProposals: [],
      branches: [{ id: "main", title: "主会话", createdAt: "2026-01-01" }],
      activeBranchId: "main",
      updatedAt: "2026-01-02"
    };

    expect(sanitizeLegacyAgentSession(session).messages.map((message) => message.id)).toEqual(["author-outline"]);
  });
});

describe("agent session branches", () => {
  it("keeps a branch frozen at its fork point while including branch replies", () => {
    const session: AgentChatSession = {
      schemaVersion: "0.1.0",
      id: "session-1",
      projectId: "project-1",
      chapterId: "chapter-1",
      title: "测试会话",
      messages: [
        { id: "main-1", role: "user", content: "共同历史", createdAt: "2026-01-01", branchId: "main" },
        { id: "main-2", role: "assistant", content: "分叉点", createdAt: "2026-01-02", branchId: "main" },
        { id: "branch-1", role: "user", content: "分支问题", createdAt: "2026-01-03", branchId: "branch-a" },
        { id: "main-3", role: "user", content: "分叉后主线消息", createdAt: "2026-01-04", branchId: "main" },
        { id: "branch-2", role: "assistant", content: "分支回答", createdAt: "2026-01-05", branchId: "branch-a" }
      ],
      proposals: [],
      dataProposals: [],
      branches: [
        { id: "main", title: "主会话", createdAt: "2026-01-01" },
        {
          id: "branch-a",
          title: "分支 A",
          parentBranchId: "main",
          forkedFromMessageId: "main-2",
          createdAt: "2026-01-03"
        }
      ],
      activeBranchId: "branch-a",
      updatedAt: "2026-01-05"
    };

    expect(visibleBranchMessages(session, "branch-a").map((message) => message.id)).toEqual([
      "main-1",
      "main-2",
      "branch-1",
      "branch-2"
    ]);
  });
});
