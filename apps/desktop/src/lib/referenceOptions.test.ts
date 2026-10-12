import { describe, expect, it } from "vitest";
import { referenceValues, resolveReferenceValues } from "./referenceOptions";

const options = [
  { value: "char-a", label: "林烬", keywords: ["阿烬"] },
  { value: "char-b", label: "同名人物" },
  { value: "char-c", label: "同名人物" }
];

describe("reference selections", () => {
  it("recognizes legacy aliases without duplicating stable references", () => {
    expect(referenceValues(["阿烬", "未建档人物"], ["char-a"], options)).toEqual(["char-a", "未建档人物"]);
  });
  it("uses IDs to disambiguate identical names and preserves unresolved references", () => {
    expect(referenceValues(["同名人物"], ["char-c", "missing-id"], options)).toEqual(["char-c", "missing-id"]);
    expect(referenceValues(["同名人物"], [], options)).toEqual(["同名人物"]);
  });
  it("updates name and ID mirrors together when selecting and removing references", () => {
    expect(resolveReferenceValues(["char-a", "自定义人物"], options)).toEqual({
      names: ["林烬", "自定义人物"],
      ids: ["char-a"]
    });
    expect(resolveReferenceValues(["自定义人物"], options)).toEqual({ names: ["自定义人物"], ids: [] });
  });
});
