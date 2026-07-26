import path from "node:path";
import { dialog, type FileFilter } from "electron";
import { compileBeatBoardToInk, compileBeatBoardToTwee } from "@inkforge/schemas";
import type { PlayableExportInput } from "../types.js";
import { FileRepository } from "./FileRepository.js";
import { NarrativeBoardService } from "./NarrativeBoardService.js";
import { ProjectService } from "./ProjectService.js";

export class PlayableExportService {
  constructor(
    private readonly projects = new ProjectService(),
    private readonly files = new FileRepository(),
    private readonly boards = new NarrativeBoardService(files)
  ) {}

  async exportPlayable(input: PlayableExportInput): Promise<string | undefined> {
    const project = await this.projects.openProject(input.projectPath);
    const board = await this.boards.load(input.projectPath);
    const extension = input.format === "twee" ? "twee" : "ink";
    const result = await dialog.showSaveDialog({
      title: "导出可玩分支叙事",
      defaultPath: path.join(input.projectPath, "exports", `${project.meta.title}.${extension}`),
      filters: [this.filterFor(input.format)]
    });
    if (result.canceled || !result.filePath) {
      return undefined;
    }

    const options = { title: project.meta.title, author: project.meta.author };
    const content =
      input.format === "twee" ? compileBeatBoardToTwee(board, options) : compileBeatBoardToInk(board, options);
    await this.files.writeTextAtomic(result.filePath, content);
    return result.filePath;
  }

  private filterFor(format: PlayableExportInput["format"]): FileFilter {
    if (format === "twee") {
      return { name: "Twine Twee Story", extensions: ["twee"] };
    }
    return { name: "Ink Script", extensions: ["ink"] };
  }
}
