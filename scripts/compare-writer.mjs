import { access, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { buildWriterMessages } from "@inkforge/prompt-engine";
import { authHeaders, completionsUrl, normalizeProviderEndpoint, assertCompletionFits } from "@inkforge/ai-provider";

export const paragraphRetention = (original, revised) => {
  const paragraphs = original.split(/\n\s*\n/u).filter((value) => value.trim());
  return paragraphs.length ? paragraphs.filter((value) => revised.includes(value)).length / paragraphs.length : 0;
};

/** Fixed messages, one writer sample reused for raw/edited comparison, no project writes. */
export async function compareWriter({ request, complete, review }) {
  const messages = buildWriterMessages(request);
  const startedAt = Date.now();
  const writer = await complete({ providerRole: "writer", messages, toolChoice: "none" });
  const original = writer.message.content?.trim();
  if (!original) throw new Error("写手返回空正文。");
  const edited = await review({
    draft: original,
    recentText: request.recentText,
    instruction: request.authorInstruction,
    evidencePack: request.evidencePack
  });
  const general = await complete({ providerRole: "reviewer", messages, toolChoice: "none" });
  const generalText = general.message.content?.trim();
  if (!generalText) throw new Error("通用模型返回空正文。");
  const variants = [
    { name: "writer-only", text: original, calls: [writer] },
    {
      name: "writer-reviewed",
      text: edited.revisedText,
      calls: [writer, ...edited.calls],
      review: edited,
      originalParagraphRetention: paragraphRetention(original, edited.revisedText)
    },
    { name: "general-only", text: generalText, calls: [general] }
  ];
  for (const variant of variants) {
    const judge = await complete({
      providerRole: "reviewer",
      toolChoice: "none",
      maxOutputTokens: 2000,
      messages: [
        {
          role: "system",
          content:
            '独立评估小说正文，证据与计划不得混淆。只输出JSON：{"hardContradictions":[{"detail":"问题","evidence":"原文"}],"goalCompletion":"评价","repetition":"评价","foreignNames":"评价","styleDrift":"评价"}。证据不足须明确未知，不以另一模型自评为依据。'
        },
        { role: "user", content: JSON.stringify({ input: request, prose: variant.text }) }
      ]
    });
    variant.assessment = JSON.parse(
      (judge.message.content ?? "")
        .trim()
        .replace(/^```(?:json)?\s*/iu, "")
        .replace(/\s*```$/u, "")
    );
    variant.judgeCall = judge;
    const tokens = (calls) => calls.reduce((sum, call) => sum + (call.usage?.total_tokens ?? 0), 0);
    variant.reportedTokens = variant.calls.every((call) => call.usage?.total_tokens !== undefined)
      ? tokens(variant.calls)
      : undefined;
    variant.durationMs = variant.calls.reduce((sum, call) => sum + (call.telemetry?.durationMs ?? 0), 0);
    variant.estimatedCost = variant.calls.every((call) => call.telemetry?.estimatedCost !== undefined)
      ? variant.calls.reduce((sum, call) => sum + call.telemetry.estimatedCost, 0)
      : undefined;
    // Avoid duplicating full prompt messages inside each call; source input is retained once.
    variant.calls = variant.calls.map(({ model, usage, telemetry, phase }) => ({ model, usage, telemetry, phase }));
    variant.judgeCall = { model: judge.model, usage: judge.usage, telemetry: judge.telemetry };
  }
  return {
    schemaVersion: "inkforge.writer-comparison.v1",
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    request,
    messages,
    variants,
    assessmentKind: "model-assessment-requires-human-review",
    authorAcceptance: null
  };
}

async function main() {
  const options = Object.fromEntries(
    process.argv
      .slice(2)
      .reduce(
        (pairs, value, index, args) => (value.startsWith("--") ? [...pairs, [value.slice(2), args[index + 1]]] : pairs),
        []
      )
  );
  if (!options.config || !options.input || !options.output)
    throw new Error(
      "用法：node scripts/compare-writer.mjs --config endpoints.json --input continuation-run.json --output comparison.json（先 npm run build）"
    );
  try {
    await access(options.output);
    throw new Error("输出文件已存在，请使用新文件名。");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const configs = JSON.parse(await readFile(options.config, "utf8"));
  const source = JSON.parse(await readFile(options.input, "utf8"));
  const request = source.writerRequest ?? source;
  const { LogicReviewService } = await import("../apps/desktop/dist-electron/services/LogicReviewService.js");
  const complete = async (input) => {
    const raw = configs[input.providerRole];
    if (!raw) throw new Error(`缺少 ${input.providerRole} 配置。`);
    const endpoint = normalizeProviderEndpoint({
      ...raw,
      apiKey: raw.apiKeyEnv ? process.env[raw.apiKeyEnv] : undefined
    });
    if (endpoint.authMode !== "none" && !endpoint.apiKey)
      throw new Error(`请配置 ${raw.apiKeyEnv ?? "API Key 环境变量名称"}。`);
    const body = {
      model: endpoint.model,
      messages: input.messages,
      temperature: endpoint.temperature,
      max_tokens: Math.min(input.maxOutputTokens ?? endpoint.maxTokens, endpoint.maxTokens),
      stop: endpoint.stop,
      stream: false
    };
    const estimatedInputTokens = assertCompletionFits(body, endpoint.contextWindow);
    const started = Date.now();
    const response = await fetch(completionsUrl(endpoint.baseUrl), {
      method: "POST",
      headers: { "content-type": "application/json", ...authHeaders(endpoint.authMode, endpoint.apiKey) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(600000)
    });
    if (!response.ok) throw new Error(`${input.providerRole} 请求失败 HTTP ${response.status}`);
    const result = await response.json();
    if (!result.choices?.[0]?.message?.content?.trim()) throw new Error("模型未返回有效内容。");
    return {
      message: result.choices[0].message,
      model: endpoint.model,
      usage: result.usage,
      telemetry: {
        durationMs: Date.now() - started,
        estimatedInputTokens,
        maxOutputTokens: body.max_tokens,
        modelRevision: endpoint.modelRevision,
        tokenizerRevision: endpoint.tokenizerRevision,
        chatTemplateRevision: endpoint.chatTemplateRevision,
        stop: endpoint.stop,
        estimatedCost:
          result.usage?.prompt_tokens !== undefined &&
          result.usage?.completion_tokens !== undefined &&
          endpoint.inputPricePerMillion !== undefined &&
          endpoint.outputPricePerMillion !== undefined
            ? (result.usage.prompt_tokens * endpoint.inputPricePerMillion +
                result.usage.completion_tokens * endpoint.outputPricePerMillion) /
              1000000
            : undefined
      }
    };
  };
  const reviewer = new LogicReviewService({ runAgentCompletion: complete });
  const report = await compareWriter({ request, complete, review: (input) => reviewer.review(input) });
  await writeFile(options.output, JSON.stringify(report, null, 2), { encoding: "utf8", flag: "wx" });
  process.stdout.write(`对照结果已保存：${options.output}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
