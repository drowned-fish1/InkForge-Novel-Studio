import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { CharacterSchema, WorldEntrySchema, type Character, type WorldEntry } from "@inkforge/schemas";
import { FileRepository } from "./FileRepository.js";

const safeFileId = (value: string): string =>
  value
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 64) || `item-${Date.now()}`;

export class LibraryService {
  constructor(private readonly files = new FileRepository()) {}

  async listCharacters(projectPath: string): Promise<Character[]> {
    const dir = this.files.assertInsideProject(projectPath, "characters");
    await this.files.ensureDir(dir);
    const names = await readdir(dir);
    const characters: Character[] = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      const raw = await this.files.readJson(path.join(dir, name));
      characters.push(CharacterSchema.parse(raw));
    }
    return characters.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  }

  async saveCharacter(projectPath: string, character: Character): Promise<Character[]> {
    const parsed = CharacterSchema.parse(character);
    const fileName = `${safeFileId(parsed.id)}.json`;
    await this.files.writeJsonAtomic(
      this.files.assertInsideProject(projectPath, path.posix.join("characters", fileName)),
      parsed
    );
    return this.listCharacters(projectPath);
  }

  async listWorldEntries(projectPath: string): Promise<WorldEntry[]> {
    const dir = this.files.assertInsideProject(projectPath, "world");
    await this.files.ensureDir(dir);
    const names = await readdir(dir);
    const entries: WorldEntry[] = [];
    for (const name of names) {
      const fullPath = path.join(dir, name);
      if (name.endsWith(".world.json")) {
        entries.push(WorldEntrySchema.parse(await this.files.readJson(fullPath)));
      } else if (name.endsWith(".md")) {
        const content = await this.files.readText(fullPath);
        entries.push(
          WorldEntrySchema.parse({
            id: name.replace(/\.md$/i, ""),
            title: name.replace(/\.md$/i, ""),
            type: name.includes("power") ? "power-system" : "note",
            content
          })
        );
      }
    }
    return entries.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  }

  async saveWorldEntry(projectPath: string, entry: WorldEntry): Promise<WorldEntry[]> {
    const parsed = WorldEntrySchema.parse(entry);
    const fileName = `${safeFileId(parsed.id)}.world.json`;
    await this.files.writeJsonAtomic(
      this.files.assertInsideProject(projectPath, path.posix.join("world", fileName)),
      parsed
    );
    return this.listWorldEntries(projectPath);
  }

  async deleteCharacter(projectPath: string, characterId: string): Promise<Character[]> {
    const fileName = `${safeFileId(characterId)}.json`;
    await rm(this.files.assertInsideProject(projectPath, path.posix.join("characters", fileName)), { force: true });
    return this.listCharacters(projectPath);
  }

  async deleteWorldEntry(projectPath: string, entryId: string): Promise<WorldEntry[]> {
    const jsonName = `${safeFileId(entryId)}.world.json`;
    await rm(this.files.assertInsideProject(projectPath, path.posix.join("world", jsonName)), { force: true });
    // Legacy loose markdown entries surface with their file name as the id.
    const markdownName = `${safeFileId(entryId)}.md`;
    await rm(this.files.assertInsideProject(projectPath, path.posix.join("world", markdownName)), { force: true });
    return this.listWorldEntries(projectPath);
  }
}
