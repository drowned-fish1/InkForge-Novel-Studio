import { afterEach, describe, expect, it, vi } from "vitest";
import { AiProviderService, minimumAgentOutputTokens, readStreamingAgentCompletion } from "./AiProviderService.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agent streaming completion", () => {
  it("assembles text, usage and fragmented tool calls from SSE", async () => {
    const encoder = new TextEncoder();
    const lines = [
      'data: {"choices":[{"delta":{"content":"正在"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"检查"}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"semantic_","arguments":"{\\"que"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"ry\\":\\"星门\\"}"}}]}}],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}\n\n',
      "data: [DONE]\n\n"
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of lines) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      }
    });
    const chunks: string[] = [];

    const result = await readStreamingAgentCompletion(stream, (delta) => chunks.push(delta.content));

    expect(chunks.join("")).toBe("正在检查");
    expect(result.choices?.[0]?.message?.tool_calls?.[0]).toMatchObject({
      id: "call-1",
      function: {
        name: "semantic_search",
        arguments: '{"query":"星门"}'
      }
    });
    expect(result.usage?.total_tokens).toBe(28);
  });

  it("assembles a tool call whose fragments omit the index field", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // Some OpenAI-compatible providers stream tool-call continuation fragments without
        // an `index`. They must still merge into a single call, not fragment into many.
        for (const line of [
          'data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"propose_chapter_edit","arguments":"{\\"mode\\""}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":":\\"append\\","}}]}}]}\n\n',
          'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"\\"content\\":\\"续写\\"}"}}]}}]}\n\n',
          "data: [DONE]\n\n"
        ]) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      }
    });

    const result = await readStreamingAgentCompletion(stream);

    expect(result.choices?.[0]?.message?.tool_calls).toHaveLength(1);
    expect(result.choices?.[0]?.message?.tool_calls?.[0]).toMatchObject({
      id: "call-1",
      function: { name: "propose_chapter_edit", arguments: '{"mode":"append","content":"续写"}' }
    });
  });

  it("skips a malformed SSE frame instead of aborting the whole stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of [
          'data: {"choices":[{"delta":{"content":"正在"}}]}\n\n',
          "data: {this is not valid json}\n\n",
          'data: {"choices":[{"delta":{"content":"检查"},"finish_reason":"stop"}]}\n\n',
          "data: [DONE]\n\n"
        ]) {
          controller.enqueue(encoder.encode(line));
        }
        controller.close();
      }
    });

    const result = await readStreamingAgentCompletion(stream);

    expect(result.choices?.[0]?.message?.content).toBe("正在检查");
  });

  it("keeps provider reasoning separate from visible answer text", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"reasoning_content":"先核对人物动机。"}}]}\n\n' +
              'data: {"choices":[{"delta":{"content":"建议保留当前冲突。"},"finish_reason":"stop"}]}\n\n' +
              "data: [DONE]\n\n"
          )
        );
        controller.close();
      }
    });
    const deltas: Array<{ type: string; content: string }> = [];

    const result = await readStreamingAgentCompletion(stream, (delta) => deltas.push(delta));

    expect(result.choices?.[0]?.message).toMatchObject({
      content: "建议保留当前冲突。",
      reasoning_content: "先核对人物动机。"
    });
    expect(deltas).toEqual([
      { type: "reasoning", content: "先核对人物动机。" },
      { type: "text", content: "建议保留当前冲突。" }
    ]);
  });

  it("retries an empty streamed response and reserves enough output for tool arguments", async () => {
    const responses = [
      'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n',
      'data: {"choices":[{"delta":{"content":"恢复成功"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
    ];
    const fetchMock = vi.fn(async (_input: string | URL, _init?: RequestInit) => {
      const body = responses.shift() ?? "";
      return new Response(body, {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiProviderService(
      {
        getProvider: vi.fn(async () => ({
          providerId: "test",
          displayName: "Test",
          baseUrl: "https://example.test/v1",
          model: "test-model",
          authMode: "bearer",
          apiKey: "limited-test-key",
          temperature: 0.2,
          maxTokens: 1_200,
          updatedAt: ""
        }))
      } as never,
      {} as never
    );

    const result = await service.runAgentCompletion(
      {
        messages: [{ role: "user", content: "扩写正文" }],
        tools: []
      },
      () => undefined
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).max_tokens).toBe(minimumAgentOutputTokens);
    expect(result.message.content).toBe("恢复成功");
  });

  it("uses a member-specific model override for Agent group routing", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "编辑完成" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiProviderService(
      {
        getProvider: vi.fn(async () => ({
          providerId: "test",
          displayName: "Test",
          baseUrl: "https://example.test/v1",
          model: "main-model",
          authMode: "bearer",
          apiKey: "limited-test-key",
          temperature: 0.2,
          maxTokens: 4_096,
          updatedAt: ""
        }))
      } as never,
      {} as never
    );

    const result = await service.runAgentCompletion({
      messages: [{ role: "user", content: "修剪段落" }],
      modelOverride: "editor-model"
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body)).model).toBe("editor-model");
    expect(result.model).toBe("editor-model");
  });

  it("reserves an explicit long-form output budget and can select the editor model", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "完整正文" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const service = new AiProviderService(
      {
        getProvider: vi.fn(async () => ({
          providerId: "test",
          displayName: "Test",
          baseUrl: "https://example.test/v1",
          model: "writer-model",
          editorModel: "editor-model",
          authMode: "bearer",
          apiKey: "limited-test-key",
          temperature: 0.2,
          maxTokens: 1_200,
          updatedAt: ""
        }))
      } as never,
      {} as never
    );

    const result = await service.runAgentCompletion({
      messages: [{ role: "user", content: "编辑整章" }],
      useEditorModel: true,
      maxOutputTokens: 12_000
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.max_tokens).toBe(12_000);
    expect(body.model).toBe("editor-model");
    expect(body.tool_choice).toBe("none");
    expect(result.model).toBe("editor-model");
  });
});
