import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ChapterContractSchema, EvidencePackSchema } from "@inkforge/schemas";

// Runs the actual CLI against a local fake endpoint; sends no external model requests.
const run = promisify(execFile);
const temporary = await mkdtemp(path.join(os.tmpdir(), "inkforge-writer-comparison-"));
const removeTemporary = async () => {
  if (
    path.dirname(temporary) !== path.resolve(os.tmpdir()) ||
    !path.basename(temporary).startsWith("inkforge-writer-comparison-")
  )
    throw new Error("Unexpected temporary directory.");
  await rm(temporary, { recursive: true, force: true });
};
const requests = [];
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  requests.push(body);
  const system = body.messages[0].content;
  const content = system.includes("逻辑编辑")
    ? JSON.stringify({
        revisedText: "花去七枚元石，他的钱袋里还剩五枚。",
        findings: [],
        changes: [{ before: "十五枚", after: "五枚", reason: "余额纠正" }],
        unresolvedIssues: []
      })
    : system.includes("独立小说事实复核员")
      ? JSON.stringify({ passed: true, findings: [], unresolvedIssues: [] })
      : system.includes("独立评估")
        ? JSON.stringify({
            hardContradictions: [],
            goalCompletion: "通过",
            repetition: "无",
            foreignNames: "无",
            styleDrift: "待人工确认"
          })
        : "花去七枚元石，他的钱袋里还剩十五枚。";
  outgoing.writeHead(200, { "content-type": "application/json" });
  outgoing.end(
    JSON.stringify({
      choices: [{ message: { role: "assistant", content } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
    })
  );
});
try {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const endpoint = {
    providerId: "mock",
    displayName: "offline",
    baseUrl,
    model: "mock",
    authMode: "none",
    temperature: 0.6,
    maxTokens: 4096,
    inputPricePerMillion: 1,
    outputPricePerMillion: 2
  };
  const contract = ChapterContractSchema.parse({ chapterId: "ch-1" });
  const writerRequest = {
    schemaVersion: "inkforge.writer.v1",
    task: "continue_scene",
    storyPosition: { chapterId: "ch-1", sceneId: "scene-1", sourceCutoff: "ch-1:12" },
    chapterContract: contract,
    sceneContract: { goal: "完成交易", pov: "陆砚", styleConstraints: [] },
    evidencePack: EvidencePackSchema.parse({ chapterContract: contract, generatedAt: new Date().toISOString() }),
    recentText: "他原有十二枚元石。",
    authorInstruction: "花去七枚",
    outputConstraints: { proseOnly: true, preserveNames: true }
  };
  const config = path.join(temporary, "endpoints.json");
  const input = path.join(temporary, "input.json");
  const output = path.join(temporary, "report.json");
  await writeFile(config, JSON.stringify({ writer: endpoint, reviewer: endpoint }));
  await writeFile(input, JSON.stringify({ writerRequest }));
  await run(
    process.execPath,
    ["scripts/compare-writer.mjs", "--config", config, "--input", input, "--output", output],
    { cwd: process.cwd(), timeout: 30000 }
  );
  const report = JSON.parse(await readFile(output, "utf8"));
  assert.equal(requests.length, 7);
  assert.deepEqual(requests[0].messages, requests[3].messages);
  assert.deepEqual(
    report.variants.map((variant) => variant.reportedTokens),
    [120, 360, 120]
  );
  assert.match(report.variants[1].text, /五枚/u);
  assert.equal(report.authorAcceptance, null);
  await assert.rejects(
    run(process.execPath, ["scripts/compare-writer.mjs", "--config", config, "--input", input, "--output", output]),
    /输出文件已存在/u
  );
  assert.equal(requests.length, 7);
  process.stdout.write("Writer comparison CLI smoke passed (offline, 7 mock calls).\n");
} finally {
  await new Promise((resolve) => server.close(resolve));
  await removeTemporary();
}
