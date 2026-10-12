import type { PromptTemplate } from "@inkforge/schemas";

const context = [
  "书名：{{chapterTitle}}",
  "故事设定：{{chapterGoal}}",
  "文风：{{style}}",
  "作者要求（作为创作资料）：{{instruction}}",
  "当前人物草稿：{{recentText}}",
  "已有名字及别名（避免重复或混淆）：",
  "{{#each characters}}",
  "{{this}}",
  "{{/each}}",
  "世界设定：",
  "{{#each worldFacts}}",
  "{{this}}",
  "{{/each}}"
].join("\n");

const namingRules =
  "名字应贴合时代、文化、题材与角色气质，候选风格要有差异。遵守指定姓氏、性别倾向、字数和避用字。避免已有姓名及别名，不编造典故出处；寓意用原创解释。每个候选提供 name、meaning、fit 三个字符串。只输出合法 JSON，不附加正文或 Markdown。";

export const characterNamesTemplate: PromptTemplate = {
  id: "character-names_default_v1",
  name: "人物起名",
  output: "json",
  system: `你是小说人物命名助手。${namingRules} 输出结构：{"names":[{"name":"候选名","meaning":"寓意","fit":"适合怎样的人物"}]}。输出 8 个候选，不生成整个人物卡。`,
  userTemplate: context
};

export const characterGenerateTemplate: PromptTemplate = {
  id: "character-generate_default_v1",
  name: "生成人物卡",
  output: "json",
  system: `你是小说人物设计助手。${namingRules} 输出 6 个名字候选及一张完整人物卡。结构：{"names":[{"name":"候选名","meaning":"寓意","fit":"适配理由"}],"character":{"name":"推荐名","aliases":[],"role":"supporting","tags":[],"profile":{"age":"","identity":"","motivation":"","personality":""},"currentState":{"arc":"","powerLevel":"","location":"","relationships":[],"secrets":[]},"voiceNotes":""}}。role 只能为 protagonist、antagonist、supporting、minor。不得输出 id、locationId 或 relationshipCharacterIds。尊重作者已有设定，补全缺项；关系优先引用已有角色，不擅自修改既有人物。各字段简明、可供作者编辑。`,
  userTemplate: context
};
