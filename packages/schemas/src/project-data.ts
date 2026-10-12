import { z } from "zod";
import { estimateTokensCjkAware } from "./agent.js";

export type ProjectJsonValue =
  | string
  | number
  | boolean
  | null
  | ProjectJsonValue[]
  | { [key: string]: ProjectJsonValue };
export const ProjectJsonValueSchema: z.ZodType<ProjectJsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(ProjectJsonValueSchema),
    z.record(z.string(), ProjectJsonValueSchema)
  ])
);
const keySchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((key) => !["__proto__", "prototype", "constructor"].includes(key), "无效的资料名称");
const sourcesSchema = z
  .array(
    z.object({
      chapterId: z.string().min(1),
      excerpt: z.string().min(1).max(2_000),
      contentHash: z.string().min(1),
      startOffset: z.number().int().nonnegative(),
      endOffset: z.number().int().nonnegative()
    })
  )
  .max(8);
export const ProjectDataEntrySchema = z.object({
  key: keySchema,
  content: ProjectJsonValueSchema,
  sourceChapterId: z.string().min(1).optional(),
  sources: sourcesSchema.optional()
});
export const ProjectDataSchema = z
  .object({
    schemaVersion: z.literal("inkforge.project-data.v1").default("inkforge.project-data.v1"),
    revision: z.number().int().nonnegative().default(0),
    entries: z.array(ProjectDataEntrySchema).default([]),
    history: z
      .array(
        z.object({
          revision: z.number().int().positive(),
          changedAt: z.string(),
          changes: z.array(
            z.object({
              key: keySchema,
              before: ProjectDataEntrySchema.optional(),
              after: ProjectDataEntrySchema.optional(),
              effectiveChapterId: z.string().optional(),
              sources: sourcesSchema.optional()
            })
          )
        })
      )
      .optional(),
    updatedAt: z.string().datetime({ offset: true }).optional()
  })
  .superRefine((value, ctx) => {
    if (new Set(value.entries.map((entry) => entry.key)).size !== value.entries.length) {
      ctx.addIssue({ code: "custom", message: "资料名称不能重复" });
    }
  });
const changeSchema = z.discriminatedUnion("operation", [
  ProjectDataEntrySchema.extend({ operation: z.literal("set") }),
  z.object({ operation: z.literal("delete"), key: keySchema, sources: sourcesSchema.optional() })
]);
export const ProjectDataUpdateSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    effectiveChapterId: z.string().optional(),
    changes: z.array(changeSchema).min(1).max(30)
  })
  .superRefine((value, ctx) => {
    if (new Set(value.changes.map((change) => change.key)).size !== value.changes.length) {
      ctx.addIssue({ code: "custom", message: "一次更新不能重复修改同一栏目" });
    }
    for (const change of value.changes) {
      if (change.operation === "set" && estimateTokensCjkAware(JSON.stringify(change)) > 3_000) {
        ctx.addIssue({ code: "custom", message: `栏目“${change.key}”过大，请按人物、物品或规则拆成多个栏目` });
      }
    }
  });
export type ProjectData = z.infer<typeof ProjectDataSchema>;
export type ProjectDataEntry = z.infer<typeof ProjectDataEntrySchema>;
export type ProjectDataUpdate = z.infer<typeof ProjectDataUpdateSchema>;

export function applyProjectDataUpdate(document: ProjectData, input: ProjectDataUpdate): ProjectData {
  const update = ProjectDataUpdateSchema.parse(input);
  if (document.revision !== update.expectedRevision) throw new Error("项目专属资料已变化，请重新读取后生成提案。");
  const entries = new Map(document.entries.map((entry) => [entry.key, entry]));
  const historyChanges: NonNullable<ProjectData["history"]>[number]["changes"] = [];
  for (const change of update.changes) {
    const before = entries.get(change.key);
    if (change.operation === "delete") {
      if (!entries.delete(change.key)) throw new Error(`找不到要删除的栏目：${change.key}`);
    } else {
      entries.set(change.key, ProjectDataEntrySchema.parse(change));
    }
    historyChanges.push({
      key: change.key,
      before,
      after: entries.get(change.key),
      sources: change.sources,
      effectiveChapterId:
        change.operation === "set" ? (change.sourceChapterId ?? update.effectiveChapterId) : update.effectiveChapterId
    });
  }
  return ProjectDataSchema.parse({
    ...document,
    revision: document.revision + 1,
    entries: [...entries.values()],
    history: [
      ...(document.history ?? []),
      { revision: document.revision + 1, changedAt: new Date().toISOString(), changes: historyChanges }
    ],
    updatedAt: new Date().toISOString()
  });
}

/** Keep whole JSON entries; never truncate a currency balance or an ability restriction. */
export function selectProjectData(
  document: ProjectData,
  query: string,
  tokenBudget: number,
  chapterOrder?: string[],
  chapterId?: string,
  sourceCutoff?: number
) {
  const currentIndex = chapterOrder?.indexOf(chapterId ?? "") ?? -1;
  const future = (id: string | undefined) =>
    Boolean(id && chapterOrder && (chapterOrder.indexOf(id) < 0 || chapterOrder.indexOf(id) > currentIndex));
  const entriesAtChapter = new Map(document.entries.map((entry) => [entry.key, entry]));
  if (chapterOrder) {
    for (const revision of [...(document.history ?? [])].reverse()) {
      for (const change of [...revision.changes].reverse()) {
        const afterCutoff =
          sourceCutoff !== undefined &&
          (change.sources ?? change.after?.sources)?.some(
            (source) => source.chapterId === chapterId && source.endOffset > sourceCutoff
          );
        if (future(change.effectiveChapterId) || afterCutoff) {
          if (change.before) entriesAtChapter.set(change.key, change.before);
          else entriesAtChapter.delete(change.key);
        }
      }
    }
  }
  const eligible = [...entriesAtChapter.values()].filter((entry) => {
    if (entry.sources?.some((source) => future(source.chapterId))) return false;
    if (
      sourceCutoff !== undefined &&
      entry.sources?.some((source) => source.chapterId === chapterId && source.endOffset > sourceCutoff)
    )
      return false;
    if (!entry.sourceChapterId || !chapterOrder) return true;
    const index = chapterOrder.indexOf(entry.sourceChapterId);
    return index >= 0 && currentIndex >= 0 && index <= currentIndex;
  });
  const terms = [...new Set(query.toLowerCase().match(/[a-z0-9_-]+|[\u3400-\u9fff]{2}/gu) ?? [])];
  const score = (entry: ProjectDataEntry) => {
    const text = JSON.stringify(entry).toLowerCase();
    return terms.reduce(
      (sum, term) => sum + (text.includes(term) ? 1 : 0) + (entry.key.toLowerCase().includes(term) ? 2 : 0),
      0
    );
  };
  const ranked = eligible
    .map((entry) => ({ entry, score: score(entry) }))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.entry);
  const entries: ProjectDataEntry[] = [];
  let used = estimateTokensCjkAware("[]");
  for (const entry of ranked) {
    const tokens = estimateTokensCjkAware(JSON.stringify(entry)) + 1;
    if (used + tokens <= tokenBudget) {
      entries.push(entry);
      used += tokens;
    }
  }
  return {
    entries,
    omittedCount: Math.max(document.entries.length, entriesAtChapter.size) - entries.length,
    estimatedTokens: entries.length ? estimateTokensCjkAware(JSON.stringify(entries)) : 0
  };
}
