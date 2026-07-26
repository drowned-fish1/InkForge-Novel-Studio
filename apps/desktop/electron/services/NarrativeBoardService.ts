import { BeatBoardSchema, type BeatBoard } from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

const boardFile = "beats.json";

export class NarrativeBoardService {
  constructor(private readonly files = new FileRepository()) {}

  async load(projectPath: string): Promise<BeatBoard> {
    try {
      const raw = await this.files.readJson<unknown>(this.files.assertInsideProject(projectPath, boardFile));
      return BeatBoardSchema.parse(raw);
    } catch (error) {
      if (isMissingFile(error)) {
        return BeatBoardSchema.parse({});
      }
      throw error;
    }
  }

  async save(projectPath: string, board: BeatBoard): Promise<BeatBoard> {
    const parsed = BeatBoardSchema.parse({ ...board, updatedAt: new Date().toISOString() });
    await this.files.writeJsonAtomic(this.files.assertInsideProject(projectPath, boardFile), parsed);
    return parsed;
  }
}

const isMissingFile = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT";
