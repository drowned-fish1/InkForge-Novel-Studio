import path from "node:path";
import { ScenePlanSchema, type ScenePlan } from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

export class ScenePlanService {
  constructor(private readonly files = new FileRepository()) {}

  async list(projectPath: string, chapterId: string): Promise<ScenePlan[]> {
    try {
      const raw = await this.files.readJson<unknown[]>(this.scenePath(projectPath, chapterId));
      return raw.map((item) => ScenePlanSchema.parse(item)).sort((a, b) => a.order - b.order);
    } catch (error) {
      if (isMissingFile(error)) {
        return [];
      }
      throw error;
    }
  }

  async save(projectPath: string, chapterId: string, scenes: ScenePlan[]): Promise<ScenePlan[]> {
    const parsed = scenes
      .map((scene, index) => ScenePlanSchema.parse({ ...scene, chapterId, order: index }))
      .sort((a, b) => a.order - b.order);
    await this.files.writeJsonAtomic(this.scenePath(projectPath, chapterId), parsed);
    return parsed;
  }

  async upsert(projectPath: string, chapterId: string, scenes: ScenePlan[]): Promise<ScenePlan[]> {
    const existing = await this.list(projectPath, chapterId);
    const byId = new Map(existing.map((scene) => [scene.id, scene]));
    for (const scene of scenes) {
      byId.set(scene.id, ScenePlanSchema.parse({ ...scene, chapterId }));
    }
    return this.save(projectPath, chapterId, [...byId.values()]);
  }

  private scenePath(projectPath: string, chapterId: string): string {
    return this.files.assertInsideProject(
      projectPath,
      path.posix.join(".inkforge", "scene-plans", `${safeId(chapterId)}.json`)
    );
  }
}

const safeId = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "chapter";

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
