import { z } from "zod";
import { CharacterSchema, type Character } from "@inkforge/schemas";

const NameCandidateSchema = z.object({
  name: z.string().trim().min(1).max(40),
  meaning: z.string().max(1000).default(""),
  fit: z.string().max(1000).default("")
});
const GeneratedCharacterSchema = CharacterSchema.omit({ id: true }).extend({
  profile: CharacterSchema.shape.profile.removeDefault(),
  currentState: CharacterSchema.shape.currentState.removeDefault(),
  name: z.string().trim().min(1).max(40),
  role: z.enum(["protagonist", "antagonist", "supporting", "minor"]).default("supporting")
});

export type GeneratedCharacter = z.infer<typeof GeneratedCharacterSchema>;
export type NameCandidate = z.infer<typeof NameCandidateSchema>;
export interface NamingConstraints {
  surname: string;
  length: number;
  avoid: string;
}
export const nameConstraintIssue = (name: string, constraints: NamingConstraints): string => {
  if (constraints.surname.trim() && !name.startsWith(constraints.surname.trim())) return "不符合指定姓氏";
  if (constraints.length && [...name].length !== constraints.length) return "不符合姓名长度";
  const blocked = constraints.avoid
    .split(/[,，、;；\s]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (blocked.some((value) => normalizeName(name).includes(normalizeName(value)))) return "包含避用字／名字";
  return "";
};
const normalizeName = (value: string) => value.normalize("NFKC").trim().toLocaleLowerCase();
export const characterNameTaken = (name: string, characters: Character[], exceptId: string) =>
  characters.some(
    (character) =>
      character.id !== exceptId &&
      [character.name, ...character.aliases].some((value) => normalizeName(value) === normalizeName(name))
  );

export const parseCharacterGeneration = (text: string, fullCard: boolean) => {
  if (text.length > 100000) throw new Error("模型返回过长，请减少要求后重新生成。");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("模型没有返回有效 JSON。可以保留要求后重新生成。");
  }
  const parsed = z
    .object({
      names: z.array(NameCandidateSchema).min(1).max(20),
      character: fullCard ? GeneratedCharacterSchema : GeneratedCharacterSchema.optional()
    })
    .safeParse(raw);
  if (!parsed.success)
    throw new Error("模型返回的人物结构不完整，请重新生成（需要名字候选、profile 和 currentState）。");
  const seen = new Set<string>();
  const names = parsed.data.names
    .filter((candidate) => {
      const key = normalizeName(candidate.name);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 12);
  // Model-authored references cannot assert stable IDs in the author's library.
  const card = parsed.data.character;
  if (card) {
    delete card.currentState.locationId;
    delete card.currentState.relationshipCharacterIds;
  }
  return { names, character: card };
};

export const applyGeneratedCharacter = (draft: Character, card: GeneratedCharacter, fillEmpty: boolean): Character => {
  const choose = (current: string, generated: string) => (fillEmpty && current.trim() ? current : generated);
  const chooseList = (current: string[], generated: string[]) => (fillEmpty && current.length ? current : generated);
  return {
    id: draft.id,
    name: draft.name === "新角色" ? card.name : choose(draft.name, card.name),
    role: fillEmpty ? draft.role : card.role,
    aliases: chooseList(draft.aliases, card.aliases),
    tags: chooseList(
      draft.tags.filter((tag) => tag !== "待完善"),
      card.tags
    ),
    profile: {
      age: choose(draft.profile.age, card.profile.age),
      identity: choose(draft.profile.identity, card.profile.identity),
      motivation: choose(draft.profile.motivation, card.profile.motivation),
      personality: choose(draft.profile.personality, card.profile.personality)
    },
    currentState: {
      arc: choose(draft.currentState.arc, card.currentState.arc),
      powerLevel: choose(draft.currentState.powerLevel, card.currentState.powerLevel),
      location: choose(draft.currentState.location, card.currentState.location),
      relationships: chooseList(draft.currentState.relationships, card.currentState.relationships),
      secrets: chooseList(draft.currentState.secrets, card.currentState.secrets),
      ...(fillEmpty && draft.currentState.location.trim() && draft.currentState.locationId
        ? { locationId: draft.currentState.locationId }
        : {}),
      ...(fillEmpty && draft.currentState.relationships.length && draft.currentState.relationshipCharacterIds
        ? { relationshipCharacterIds: draft.currentState.relationshipCharacterIds }
        : {})
    },
    voiceNotes: choose(draft.voiceNotes, card.voiceNotes)
  };
};
