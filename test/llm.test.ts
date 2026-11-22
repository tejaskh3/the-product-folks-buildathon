// lib/llm.ts: request shape, stream parsing, error mapping and retries, with fetch stubbed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmError, structuredCall, userMessage } from "@/lib/llm";
import { SYSTEM_PROMPT } from "@/lib/prompts";

const paper = { filename: "p.pdf", data: "https://storage.example/p.pdf?token=abc" };

/** An OpenRouter-style SSE body: one data line per chunk, plus a keep-alive comment and [DONE]. */
function sse(chunks: unknown[]): Response {
  const body = [": OPENROUTER PROCESSING", ...chunks.map((c) => `data: ${JSON.stringify(c)}`), "data: [DONE]", ""].join("\n");
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const answer = (text: string, finish = "stop", extra: Record<string, unknown> = {}) => [
  { choices: [{ delta: { content: text.slice(0, 5) } }] },
  { choices: [{ delta: { content: text.slice(5) }, finish_reason: finish, ...extra }] },
  {
    choices: [],
    usage: {
      prompt_tokens: 1200,
      completion_tokens: 300,
      cost: 0.0042,
      prompt_tokens_details: { cached_tokens: 1000 },
      completion_tokens_details: { reasoning_tokens: 120 },
    },
  },
];

const call = (over: Partial<Parameters<typeof structuredCall>[0]> = {}) =>
  structuredCall<{ ok: boolean }>({ paper, prompt: "draw", schema: { type: "object" }, effort: "medium", ...over });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("structuredCall", () => {
  it("parses the streamed JSON and reports OpenRouter's usage and cost", async () => {
    const fetchMock = vi.fn(async () => sse(answer('{"ok":true}')));
    vi.stubGlobal("fetch", fetchMock);
    const onText = vi.fn();

    const { data, usage } = await call({ onText, model: "google/gemini-3.8-flash" });

    expect(data).toEqual({ ok: true });
    expect(onText).toHaveBeenCalledTimes(1);
    expect(usage).toEqual({
      latency_ms: expect.any(Number),
      model: "google/gemini-3.8-flash",
      input_tokens: 1200,
      output_tokens: 300,
      cached_tokens: 1000,
      reasoning_tokens: 120,
      cost_usd: 0.0042,
    });
  });

  it("sends the PDF first, asks for the schema, and routes only to providers that honour it", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse(answer('{"ok":true}')));
    vi.stubGlobal("fetch", fetchMock);

    await call({ model: "anthropic/claude-haiku-5.5", effort: "xhigh" });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.stream).toBe(true);
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.messages[0].role).toBe("system");
    const [file, marker, text] = body.messages[1].content;
    expect(file.file.file_data).toBe(paper.data);
    // Anthropic models only cache with an explicit marker, on a text part after the PDF.
    expect(file.cache_control).toBeUndefined();
    expect(marker.cache_control).toEqual({ type: "ephemeral" });
    expect(text).toEqual({ type: "text", text: "draw" });
  });

  it("sends today's exact request body for a whole-PDF paper (PAPER_SENDING=full)", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse(answer('{"ok":true}')));
    vi.stubGlobal("fetch", fetchMock);
    await call({ model: "anthropic/claude-haiku-5.5", maxTokens: 16000 });
    // Byte for byte: the body's JSON text, not just its parsed shape.
    expect(fetchMock.mock.calls[0][1].body).toBe(
      JSON.stringify({
        model: "anthropic/claude-haiku-5.5",
        stream: true,
        max_tokens: 16000,
        reasoning: { effort: "medium" },
        response_format: { type: "json_schema", json_schema: { name: "curio_output", strict: true, schema: { type: "object" } } },
        provider: { require_parameters: true },
        plugins: [{ id: "file-parser", pdf: { engine: "native" } }],
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "file", file: { filename: "p.pdf", file_data: paper.data } },
              { type: "text", text: "The paper is attached above.", cache_control: { type: "ephemeral" } },
              { type: "text", text: "draw" },
            ],
          },
        ],
      }),
    );
  });

  it("adds no cache marker for models that cache automatically", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sse(answer('{"ok":true}')));
    vi.stubGlobal("fetch", fetchMock);
    await call({ model: "google/gemini-3.8-flash" });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.messages[1].content.some((p: { cache_control?: unknown }) => p.cache_control)).toBe(false);
  });

  it.each([
    [401, "KeyInvalid", "No auth credentials found"],
    [402, "OutOfCredit", "Insufficient credits"],
    [403, "AtCapacity", "Key limit exceeded"],
  ])("maps HTTP %i to %s without retrying", async (status, kind, msg) => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: { message: msg } }), { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(call()).rejects.toMatchObject({ kind });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries a 429, honouring retry-after, then succeeds", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "retry-after": "2" } }))
      .mockResolvedValueOnce(sse(answer('{"ok":true}')));
    vi.stubGlobal("fetch", fetchMock);

    const p = call();
    await vi.advanceTimersByTimeAsync(2600);
    await expect(p).resolves.toMatchObject({ data: { ok: true } });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up after repeated provider errors", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => new Response("bad gateway", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const p = call();
    const settled = expect(p).rejects.toMatchObject({ kind: "Upstream", status: 502 });
    await vi.advanceTimersByTimeAsync(60_000);
    await settled;
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("treats an error inside the stream like an HTTP error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse([{ error: { code: 402, message: "Insufficient credits" } }])));
    await expect(call()).rejects.toMatchObject({ kind: "OutOfCredit" });
  });

  it("reports cut-off output as Truncated", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(answer('{"ok":tr', "length"))));
    await expect(call()).rejects.toMatchObject({ kind: "Truncated" });
  });

  it("reports a refusal as Refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(answer("I can't help with that", "stop", { native_finish_reason: "refusal" }))));
    await expect(call()).rejects.toMatchObject({ kind: "Refused" });
  });

  it("reports text that isn't JSON as BadOutput", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(answer("Here is your diagram!"))));
    await expect(call()).rejects.toMatchObject({ kind: "BadOutput" });
  });

  it("parses lines split across network chunks", async () => {
    const text = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":' } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "true}" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n");
    const bytes = new TextEncoder().encode(text);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        // Split mid-line and mid-character boundaries.
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.subarray(i, i + 7));
        c.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(stream, { status: 200 })));
    await expect(call()).resolves.toMatchObject({ data: { ok: true } });
  });

  it("refuses to run without a key", async () => {
    await expect(call({ apiKey: "" })).rejects.toMatchObject({ kind: "KeyInvalid" });
  });
});

describe("userMessage", () => {
  it("tells the user what to do for each failure kind", () => {
    expect(userMessage(new LlmError("KeyInvalid", "x"))).toMatch(/key was rejected/);
    expect(userMessage(new LlmError("OutOfCredit", "x"))).toMatch(/out of credit/);
    expect(userMessage(new LlmError("AtCapacity", "x"))).toMatch(/wasn’t counted/);
    expect(userMessage(new LlmError("RateLimited", "x"))).toMatch(/busy/);
    expect(userMessage(new LlmError("Refused", "x"), "this scene")).toBe("The model declined to draw this scene.");
    expect(userMessage(new Error("boom"), "this scene")).toBe("Curio couldn’t draw this scene. Please try again.");
  });

  it("never names Claude", () => {
    for (const kind of ["KeyInvalid", "OutOfCredit", "AtCapacity", "RateLimited", "Refused", "Truncated", "BadOutput", "Upstream"] as const)
      expect(userMessage(new LlmError(kind, "x"))).not.toMatch(/claude/i);
  });
});
