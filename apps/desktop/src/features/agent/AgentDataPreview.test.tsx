import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AgentDataPreview } from "./AgentDataPreview";

describe("AgentDataPreview", () => {
  it("shows arbitrary project data changes with the original value and deletions", () => {
    const html = renderToStaticMarkup(
      <AgentDataPreview
        proposal={{
          id: "data",
          entityType: "project_data",
          action: "upsert",
          title: "专属资料",
          explanation: "更新本书",
          status: "pending",
          createdAt: "2026-10-10T00:00:00.000Z",
          payload: {
            expectedRevision: 3,
            before: [
              { key: "陆砚的钱袋", content: { 元石: 12 } },
              { key: "旧技能", content: "已废弃" }
            ],
            changes: [
              { operation: "set", key: "陆砚的钱袋", content: { 元石: 5 }, sourceChapterId: "ch-2" },
              { operation: "delete", key: "旧技能" }
            ]
          }
        }}
      />
    );
    expect(html).toContain("原内容");
    expect(html).toContain("12");
    expect(html).toContain("5");
    expect(html).toContain("删除：旧技能");
    expect(html).toContain("ch-2");
    expect(html).not.toContain("新增栏目");
  });
  it("renders scene proposals as readable cards without technical fields", () => {
    const html = renderToStaticMarkup(
      <AgentDataPreview
        proposal={{
          id: "proposal-1",
          entityType: "scene",
          action: "upsert",
          title: "1 个场景计划",
          payload: {
            scenes: [
              {
                schemaVersion: "0.1.0",
                id: "scene-1",
                chapterId: "ch-0001",
                order: 0,
                title: "夜探图书馆",
                location: "旧城图书馆",
                time: "深夜",
                goal: "找到黑皮书",
                conflict: "馆门突然反锁",
                outcome: "书页写出新的名字",
                requiredCharacters: ["林默"]
              }
            ]
          },
          explanation: "测试",
          status: "pending",
          createdAt: "2026-07-24T00:00:00.000Z"
        }}
      />
    );

    expect(html).toContain("夜探图书馆");
    expect(html).toContain("旧城图书馆");
    expect(html).toContain("找到黑皮书");
    expect(html).not.toContain("schemaVersion");
    expect(html).not.toContain("chapterId");
  });

  it("renders outline proposals as labeled fields instead of raw JSON", () => {
    const html = renderToStaticMarkup(
      <AgentDataPreview
        proposal={{
          id: "proposal-outline-1",
          entityType: "outline",
          action: "upsert",
          title: "全书大纲",
          payload: {
            outline: {
              schemaVersion: "0.1.0",
              premise: "一场失踪案牵出旧城秘密",
              mainConflict: "真相与亲情冲突",
              volumes: [
                {
                  id: "vol-001",
                  title: "迷雾卷",
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
            }
          },
          explanation: "测试",
          status: "pending",
          createdAt: "2026-07-24T00:00:00.000Z"
        }}
      />
    );

    expect(html).toContain("完整大纲");
    expect(html).toContain("作品前提");
    expect(html).toContain("迷雾卷");
    expect(html).toContain("雨夜");
    expect(html).not.toContain("schemaVersion");
    expect(html).not.toContain("chapters/volume-001");
  });
});
