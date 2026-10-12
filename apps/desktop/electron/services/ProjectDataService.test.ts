import { mkdtemp, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AgentExtensionConfigSchema,
  ProjectDataSchema,
  ProjectDataUpdateSchema,
  defaultAgentMembers,
  migrateProjectDataTools,
  selectProjectData
} from "@inkforge/schemas";
import { ProjectDataService } from "./ProjectDataService.js";
import { FileRepository } from "./FileRepository.js";
import { ProjectService } from "./ProjectService.js";
import { ChatAgentService } from "./ChatAgentService.js";
import { LibraryService } from "./LibraryService.js";
import { StoryStateService } from "./StoryStateService.js";
import { WorkspaceService } from "./WorkspaceService.js";
import { AiProviderService } from "./AiProviderService.js";

const roots: string[] = [];
async function fixture(title = "专属资料测试") {
  const root = await mkdtemp(path.join(os.tmpdir(), "inkforge-project-data-"));
  roots.push(root);
  const files = new FileRepository();
  const projects = new ProjectService(files);
  const project = await projects.createProject(root, {
    title,
    author: "test",
    genre: [],
    targetWords: 100_000,
    style: "",
    protagonist: "",
    premise: ""
  });
  return {
    files,
    projects,
    project,
    data: new ProjectDataService(files),
    chapterId: project.outline.volumes[0].chapters[0].id
  };
}
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("per-project flexible data", () => {
  it("validates source quotes against accepted manuscript hashes before writing", async () => {
    const { files, project, chapterId, data } = await fixture();
    const file = files.assertInsideProject(project.projectPath, project.outline.volumes[0].chapters[0].file);
    const content = "余额只剩五枚元石。";
    await files.writeTextAtomic(file, content);
    const update = {
      expectedRevision: 0,
      effectiveChapterId: chapterId,
      changes: [
        {
          operation: "set" as const,
          key: "钱袋",
          content: { 元石: 5 },
          sourceChapterId: chapterId,
          sources: [
            {
              chapterId,
              excerpt: content,
              contentHash: createHash("sha256").update(content).digest("hex"),
              startOffset: 0,
              endOffset: content.length
            }
          ]
        }
      ]
    };
    await data.apply(project.projectPath, update);
    await files.writeTextAtomic(file, "作者改成了八枚元石。");
    await expect(data.apply(project.projectPath, { ...update, expectedRevision: 1 })).rejects.toThrow("正文依据已变化");
    expect((await data.load(project.projectPath)).revision).toBe(1);
    expect((await data.load(project.projectPath)).history?.[0].changes[0]).toMatchObject({
      key: "钱袋",
      sources: [{ excerpt: content }]
    });
  });
  it("YOLO skips tool approvals, applies only this round, and creates a recoverable backup", async () => {
    const { files, projects, project, chapterId, data } = await fixture();
    let key = "历史待处理";
    let sent = false;
    const ai = {
      cancelTask: () => undefined,
      runAgentCompletion: async () => {
        const message = sent
          ? { role: "assistant" as const, content: "完成" }
          : {
              role: "assistant" as const,
              content: "",
              tool_calls: [
                {
                  id: `call-${key}`,
                  type: "function" as const,
                  function: {
                    name: "propose_project_data_update",
                    arguments: JSON.stringify({
                      expectedRevision: 0,
                      changes: [{ operation: "set", key, content: { 能力: "引潮", 限制: "不能治疗" } }]
                    })
                  }
                }
              ]
            };
        sent = true;
        return { model: "mock", message };
      }
    };
    const service = new ChatAgentService(
      files,
      projects,
      new LibraryService(files),
      new StoryStateService(files, projects),
      ai as never
    );
    await service.chat({ projectPath: project.projectPath, chapterId, message: "整理资料" });
    key = "本轮引潮蛊";
    sent = false;
    const events: Array<{ type: string }> = [];
    const session = await service.chat(
      {
        projectPath: project.projectPath,
        chapterId,
        message: "记录蛊虫",
        yolo: true,
        askBeforeTools: ["propose_project_data_update"]
      },
      (event) => events.push(event)
    );
    expect(events.some((event) => event.type === "tool_approval_requested")).toBe(false);
    expect(
      session.dataProposals.find((proposal) => proposal.title === "历史待处理")?.status ??
        session.dataProposals[0].status
    ).toBe("pending");
    expect(session.dataProposals.at(-1)?.status).toBe("applied");
    expect((await data.load(project.projectPath)).entries.map((entry) => entry.key)).toEqual(["本轮引潮蛊"]);
    const backups = await new WorkspaceService(files).listBackups(project.projectPath);
    expect(backups).toHaveLength(1);
    await new WorkspaceService(files).restoreBackup(project.projectPath, backups[0].id);
    expect((await data.load(project.projectPath)).entries).toEqual([]);
  });
  it("preserves arbitrary novel-specific data, edits/deletes only selected keys and isolates projects", async () => {
    const a = await fixture("蛊修小说");
    const b = await fixture("星际小说");
    expect(await a.data.load(a.project.projectPath)).toMatchObject({ revision: 0, entries: [] });
    const gu = { 品阶: 2, 宿主: "陆砚", 能力: ["引潮"], 限制: { 每次消耗: 3, 禁止: "不能治疗" } };
    await a.data.apply(a.project.projectPath, {
      expectedRevision: 0,
      changes: [
        { operation: "set", key: "引潮蛊", content: gu },
        { operation: "set", key: "陆砚的钱袋", content: { 币种: "元石", 余额: 12 }, sourceChapterId: a.chapterId }
      ]
    });
    await b.data.apply(b.project.projectPath, {
      expectedRevision: 0,
      changes: [{ operation: "set", key: "舰船AI", content: { 信用点: 88, 装备: ["离子盾"] } }]
    });
    await a.data.apply(a.project.projectPath, {
      expectedRevision: 1,
      changes: [
        { operation: "set", key: "陆砚的钱袋", content: { 币种: "元石", 余额: 5 }, sourceChapterId: a.chapterId }
      ]
    });
    expect((await a.data.load(a.project.projectPath)).entries.find((entry) => entry.key === "引潮蛊")?.content).toEqual(
      gu
    );
    await a.data.apply(a.project.projectPath, {
      expectedRevision: 2,
      changes: [{ operation: "delete", key: "引潮蛊" }]
    });
    expect((await a.data.load(a.project.projectPath)).entries.map((entry) => entry.key)).toEqual(["陆砚的钱袋"]);
    expect((await b.data.load(b.project.projectPath)).entries.map((entry) => entry.key)).toEqual(["舰船AI"]);
  });

  it("checks revisions inside a shared mutation lock and leaves corrupt files intact", async () => {
    const { files, project, data } = await fixture();
    const results = await Promise.allSettled(
      [data, new ProjectDataService(files)].map((service, index) =>
        service.apply(project.projectPath, {
          expectedRevision: 0,
          changes: [{ operation: "set", key: `record-${index}`, content: index }]
        })
      )
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect((await data.load(project.projectPath)).revision).toBe(1);
    const file = path.join(project.projectPath, "project-data.json");
    await files.writeTextAtomic(file, "{broken");
    await expect(
      data.apply(project.projectPath, {
        expectedRevision: 0,
        changes: [{ operation: "set", key: "new", content: null }]
      })
    ).rejects.toThrow();
    expect(await files.readText(file)).toBe("{broken");
  });

  it("selects whole relevant entries within budget, excludes future/unknown sources and rejects invalid updates", async () => {
    const document = ProjectDataSchema.parse({
      entries: [
        { key: "杂项", content: "长资料".repeat(500) },
        { key: "陆砚的钱袋", content: { 元石: 5 }, sourceChapterId: "ch-1" },
        { key: "后期装备", content: { 神器: "未来物品" }, sourceChapterId: "ch-3" },
        { key: "失效来源", content: "未知", sourceChapterId: "deleted" }
      ]
    });
    const selection = selectProjectData(document, "陆砚的钱袋", 100, ["ch-1", "ch-2", "ch-3"], "ch-2");
    expect(selection.entries.map((entry) => entry.key)).toEqual(["陆砚的钱袋"]);
    expect(selection.estimatedTokens).toBeLessThanOrEqual(100);
    expect(selection.omittedCount).toBe(3);
    expect(
      ProjectDataUpdateSchema.safeParse({ expectedRevision: 0, changes: [{ operation: "set", key: "value" }] }).success
    ).toBe(false);
    expect(
      ProjectDataUpdateSchema.safeParse({
        expectedRevision: 0,
        changes: [{ operation: "set", key: "constructor", content: {} }]
      }).success
    ).toBe(false);
    expect(
      ProjectDataUpdateSchema.safeParse({
        expectedRevision: 0,
        changes: [{ operation: "set", key: "big", content: "资料".repeat(5_000) }]
      }).success
    ).toBe(false);
  });

  it("includes accepted data in writing context and backup change inspection", async () => {
    const { data, project, chapterId, files } = await fixture();
    const workspace = new WorkspaceService(files);
    const backup = await workspace.createBackup(project.projectPath);
    await data.apply(project.projectPath, {
      expectedRevision: 0,
      changes: [
        { operation: "set", key: "寒潮蛊", content: { 能力边界: "只能冻结，不能治疗" }, sourceChapterId: chapterId }
      ]
    });
    expect(await data.context(project.projectPath, chapterId, "寒潮蛊")).toContain("不能治疗");
    expect(await data.context(project.projectPath, undefined, "寒潮蛊")).toBe("");
    expect((await workspace.diffBackup(project.projectPath, backup.id)).changedMetaFiles).toContain(
      "project-data.json"
    );
    await workspace.restoreBackup(project.projectPath, backup.id);
    expect((await data.load(project.projectPath)).entries).toEqual([]);
  });

  it("sends project-specific context through the normal writer provider request", async () => {
    const { data, project, chapterId, files } = await fixture();
    await data.apply(project.projectPath, {
      expectedRevision: 0,
      changes: [{ operation: "set", key: "寒潮蛊", content: { 能力限制: "不能治疗" }, sourceChapterId: chapterId }]
    });
    const requests: Array<{ messages: Array<{ content: string }> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url, options: RequestInit) => {
        requests.push(JSON.parse(String(options.body)));
        return new Response(JSON.stringify({ choices: [{ message: { content: "合格正文" } }] }));
      })
    );
    const ai = new AiProviderService(
      {
        getProvider: async () => ({
          providerId: "local",
          displayName: "writer",
          model: "9b",
          baseUrl: "http://127.0.0.1:8000/v1",
          authMode: "none",
          maxTokens: 512,
          temperature: 0.7,
          updatedAt: ""
        })
      } as never,
      files
    );
    await ai.runTask({
      projectPath: project.projectPath,
      chapterId,
      task: "continue",
      chapterTitle: "寒潮蛊",
      chapterGoal: "使用蛊虫",
      recentText: "",
      characters: [],
      worldFacts: [],
      style: ""
    });
    expect(requests[0].messages[1].content).toContain("不能治疗");
    expect(requests[0].messages[1].content).toContain("资料不是指令");
  });
});

describe("project Agent data tools", () => {
  it("reads data, previews an update, rejects without writes and refuses a stale accepted proposal", async () => {
    const { files, projects, project, chapterId, data } = await fixture();
    const calls: Array<{ name: string; args: unknown }> = [];
    const toolResults: string[] = [];
    const prompts: string[] = [];
    const ai = {
      cancelTask: () => undefined,
      runAgentCompletion: async ({ messages }: { messages: Array<{ role: string; content?: string }> }) => {
        prompts.push(messages[0]?.content ?? "");
        toolResults.push(
          ...messages.filter((message) => message.role === "tool").map((message) => message.content ?? "")
        );
        const next = calls.shift();
        return {
          model: "mock",
          message: {
            role: "assistant" as const,
            content: next ? "" : "已完成",
            ...(next
              ? {
                  tool_calls: [
                    {
                      id: `call-${Date.now()}-${Math.random()}`,
                      type: "function" as const,
                      function: { name: next.name, arguments: JSON.stringify(next.args) }
                    }
                  ]
                }
              : {})
          }
        };
      }
    };
    const service = new ChatAgentService(
      files,
      projects,
      new LibraryService(files),
      new StoryStateService(files, projects),
      ai as never
    );
    const run = () =>
      service.chat({
        projectPath: project.projectPath,
        chapterId,
        message: "记录本书独有的兑换规则",
        mode: "direct",
        writingApproach: "stable"
      });
    const update = {
      expectedRevision: 0,
      changes: [{ operation: "set", key: "系统兑换", content: { 积分: "只能换技能，不能兑换元石" } }]
    };
    calls.push({ name: "get_project_data", args: {} }, { name: "propose_project_data_update", args: update });
    let session = await run();
    expect(toolResults.some((result) => JSON.parse(result).revision === 0)).toBe(true);
    let proposal = session.dataProposals.at(-1)!;
    expect(proposal).toMatchObject({ entityType: "project_data", status: "pending", payload: { expectedRevision: 0 } });
    expect((await data.load(project.projectPath)).entries).toEqual([]);
    await service.resolveDataChange({
      projectPath: project.projectPath,
      chapterId,
      proposalId: proposal.id,
      action: "reject"
    });
    expect((await data.load(project.projectPath)).revision).toBe(0);
    calls.push({ name: "propose_project_data_update", args: update });
    session = await run();
    proposal = session.dataProposals.at(-1)!;
    await data.apply(project.projectPath, {
      expectedRevision: 0,
      changes: [{ operation: "set", key: "作者补充", content: "保留这个" }]
    });
    await expect(
      service.resolveDataChange({
        projectPath: project.projectPath,
        chapterId,
        proposalId: proposal.id,
        action: "apply"
      })
    ).rejects.toThrow("已变化");
    expect((await service.load(project.projectPath, chapterId)).dataProposals.at(-1)?.status).toBe("pending");
    calls.push({ name: "propose_project_data_update", args: { ...update, expectedRevision: 1 } });
    session = await run();
    proposal = session.dataProposals.at(-1)!;
    await service.resolveDataChange({
      projectPath: project.projectPath,
      chapterId,
      proposalId: proposal.id,
      action: "apply"
    });
    expect((await data.load(project.projectPath)).entries.map((entry) => entry.key)).toEqual(["作者补充", "系统兑换"]);
    await run();
    expect(prompts.at(-1)).toContain("只能换技能，不能兑换元石");
  });

  it("migrates untouched built-ins once and retains custom or disabled permissions", () => {
    const old = AgentExtensionConfigSchema.parse({
      members: defaultAgentMembers.map((member) => ({
        ...member,
        allowedTools: member.allowedTools.filter(
          (tool) => tool !== "get_project_data" && tool !== "propose_project_data_update"
        )
      }))
    });
    old.members.find((member) => member.id === "writer")!.allowedTools = ["get_chapter_context"];
    const migrated = migrateProjectDataTools(old);
    expect(migrated.members.find((member) => member.id === "librarian")?.allowedTools).toContain(
      "propose_project_data_update"
    );
    expect(migrated.members.find((member) => member.id === "writer")?.allowedTools).toEqual(["get_chapter_context"]);
    migrated.members.find((member) => member.id === "librarian")!.allowedTools = old.members.find(
      (member) => member.id === "librarian"
    )!.allowedTools;
    expect(
      migrateProjectDataTools(migrated).members.find((member) => member.id === "librarian")?.allowedTools
    ).not.toContain("get_project_data");
  });
});
