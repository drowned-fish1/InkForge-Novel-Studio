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
      providerRole: "reviewer",
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

describe("task provider transport", () => {
  const make = (overrides = {}) => {
    const getProvider = vi.fn(async () => ({
      providerId: "writer",
      displayName: "9B",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "novelist",
      authMode: "none",
      temperature: 0.6,
      maxTokens: 1024,
      supportsTools: false,
      roleConfigured: true,
      updatedAt: "",
      ...overrides
    }));
    const service = new AiProviderService({ getProvider } as never, {} as never);
    return { service, getProvider };
  };
  it("routes prose without authentication or tool parameters and respects the role output limit", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _request: RequestInit) =>
        new Response(JSON.stringify({ choices: [{ message: { content: "正文" } }] }))
    );
    vi.stubGlobal("fetch", fetchMock);
    const { service, getProvider } = make();
    await service.runAgentCompletion({
      providerRole: "writer",
      messages: [{ role: "user", content: "续写" }],
      maxOutputTokens: 6000,
      toolChoice: "none"
    });
    expect(getProvider).toHaveBeenCalledWith("writer");
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:8000/v1/chat/completions");
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ model: "novelist", max_tokens: 1024, temperature: 0.6 });
    expect(body).not.toHaveProperty("tools");
    expect(body).not.toHaveProperty("tool_choice");
    expect(request.headers).not.toHaveProperty("authorization");
  });
  it("does not silently send an Agent request to a prose-only endpoint", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { service } = make();
    await expect(
      service.runAgentCompletion({
        messages: [],
        tools: [{ type: "function", function: { name: "search", description: "Search", parameters: {} } }]
      })
    ).rejects.toThrow("未启用工具调用");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps text connectivity successful when tools are unsupported and leaves streaming unverified", async () => {
    const fetchMock = vi.fn(async (_url: string, _request: RequestInit) =>
      fetchMock.mock.calls.length === 1
        ? new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }))
        : new Response(JSON.stringify({ error: { message: "tools unsupported" } }), { status: 400 })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { service } = make({ supportsTools: true });
    const result = await service.probeProvider("writer");
    expect(result).toMatchObject({ ok: true, modelReachable: true, capabilities: { tools: false } });
    expect(result.capabilities.streaming).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body))).not.toHaveProperty("tools");
  });
  it("probes a prose-only endpoint without sending a tool request", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    expect((await make().service.probeProvider("writer")).ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("sends configured stop strings, records protocol/cost, and blocks an oversized final message", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "正文" } }],
            usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
          })
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const { service } = make({
      contextWindow: 4096,
      stop: ["<end>"],
      modelRevision: "sft-v1",
      tokenizerRevision: "base-v2",
      chatTemplateRevision: "chat-v3",
      inputPricePerMillion: 1,
      outputPricePerMillion: 2
    });
    const result = await service.runAgentCompletion({
      providerRole: "writer",
      messages: [{ role: "user", content: "继续" }]
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)).stop).toEqual(["<end>"]);
    expect(result.telemetry).toMatchObject({
      modelRevision: "sft-v1",
      tokenizerRevision: "base-v2",
      chatTemplateRevision: "chat-v3",
      maxOutputTokens: 1024
    });
    expect(result.telemetry?.estimatedCost).toBeCloseTo(0.00014);
    await expect(
      service.runAgentCompletion({
        providerRole: "writer",
        messages: [{ role: "user", content: "正文".repeat(10000) }]
      })
    ).rejects.toThrow("超过上下文窗口");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
