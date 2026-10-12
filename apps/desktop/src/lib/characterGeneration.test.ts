import { describe, expect, it } from "vitest";
import { CharacterSchema } from "@inkforge/schemas";
import {
  applyGeneratedCharacter,
  characterNameTaken,
  nameConstraintIssue,
  parseCharacterGeneration
} from "./characterGeneration";

const result = () => ({
  names: [
    { name: "顾照微", meaning: "见微知著", fit: "细心的剑修" },
    { name: "顾照微", meaning: "重复", fit: "" },
    { name: "顾清霜", meaning: "坚定", fit: "女剑修" }
  ],
  character: CharacterSchema.parse({
    id: "model-must-not-own-id",
    name: "顾照微",
    role: "protagonist",
    profile: { identity: "剑修", personality: "谨慎", motivation: "寻找师父" },
    currentState: {
      location: "山门",
      locationId: "invented",
      relationships: ["林舟的师妹"],
      relationshipCharacterIds: ["invented"],
      secrets: ["藏着旧信"]
    },
    voiceNotes: "话少，态度明确"
  })
});

describe("AI character generation", () => {
  it("accepts fenced JSON, deduplicates names and strips model-authored IDs", () => {
    const parsed = parseCharacterGeneration(`结果：\n\`\`\`json\n${JSON.stringify(result())}\n\`\`\``, true);
    expect(parsed.names).toHaveLength(2);
    expect(parsed.character).not.toHaveProperty("id");
    expect(parsed.character?.currentState.locationId).toBeUndefined();
    expect(parsed.character?.currentState.relationshipCharacterIds).toBeUndefined();
  });
  it("requires usable JSON and a complete card, while name-only output works", () => {
    expect(parseCharacterGeneration(JSON.stringify({ names: result().names }), false).names).toHaveLength(2);
    expect(() => parseCharacterGeneration("模型输出了正文", true)).toThrow("有效 JSON");
    expect(() => parseCharacterGeneration(JSON.stringify({ names: result().names }), true)).toThrow("人物结构");
    expect(() =>
      parseCharacterGeneration(JSON.stringify({ names: result().names, character: { name: "顾照微" } }), true)
    ).toThrow("人物结构");
    expect(() => parseCharacterGeneration(JSON.stringify({ names: [] }), false)).toThrow("人物结构");
  });
  it("checks all existing names and aliases with Unicode normalization, except current character", () => {
    const characters = [CharacterSchema.parse({ id: "one", name: "林舟", aliases: ["顾照微", "ＡＮＮ"] })];
    expect(characterNameTaken("顾照微", characters, "new")).toBe(true);
    expect(characterNameTaken("ann", characters, "new")).toBe(true);
    expect(characterNameTaken("林舟", characters, "one")).toBe(false);
  });
  it("rejects candidates that break surname, length or avoid-word constraints", () => {
    const constraints = { surname: "顾", length: 3, avoid: "轩，辰" };
    expect(nameConstraintIssue("顾照微", constraints)).toBe("");
    expect(nameConstraintIssue("林照微", constraints)).toContain("姓氏");
    expect(nameConstraintIssue("顾微", constraints)).toContain("长度");
    expect(nameConstraintIssue("顾轩微", constraints)).toContain("避用");
    expect(nameConstraintIssue("司徒照微", { surname: "司徒", length: 4, avoid: "" })).toBe("");
  });
  it("fills empty fields preserving author edits and references, and clears references on replacement", () => {
    const draft = CharacterSchema.parse({
      id: "stable",
      name: "旧名",
      profile: { identity: "作者身份" },
      currentState: {
        location: "港口",
        locationId: "port",
        relationships: ["已有关系"],
        relationshipCharacterIds: ["lin"]
      }
    });
    const card = parseCharacterGeneration(JSON.stringify(result()), true).character!;
    const filled = applyGeneratedCharacter(draft, card, true);
    expect(filled.id).toBe("stable");
    expect(filled.name).toBe("旧名");
    expect(filled.profile.identity).toBe("作者身份");
    expect(filled.profile.personality).toBe("谨慎");
    expect(filled.currentState.locationId).toBe("port");
    expect(filled.currentState.relationshipCharacterIds).toEqual(["lin"]);
    const replaced = applyGeneratedCharacter(draft, card, false);
    expect(replaced.id).toBe("stable");
    expect(replaced.name).toBe("顾照微");
    expect(replaced.currentState.locationId).toBeUndefined();
    expect(replaced.currentState.relationshipCharacterIds).toBeUndefined();
    expect(applyGeneratedCharacter({ ...draft, name: "新角色" }, card, true).name).toBe("顾照微");
  });
});
