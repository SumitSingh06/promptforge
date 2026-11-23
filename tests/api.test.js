import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/chat.js";

// Minimal fake of Vercel's req/res objects
function mockRes() {
  const res = {
    statusCode: 200, headers: {}, body: undefined, chunks: [], ended: false, headersSent: false,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    write(c) { this.headersSent = true; this.chunks.push(String(c)); },
    end() { this.ended = true; },
  };
  return res;
}
let ipCounter = 0;
const req = (body, extra = {}) => ({ method: "POST", headers: { "x-forwarded-for": "10.0.0." + ++ipCounter }, body, ...extra });

const realFetch = globalThis.fetch;
let lastCall;
beforeEach(() => { process.env.GEMINI_API_KEY = "test-key"; lastCall = null; });
afterEach(() => { globalThis.fetch = realFetch; });

function mockGemini(text) {
  globalThis.fetch = async (url, opts) => {
    lastCall = { url, opts, body: JSON.parse(opts.body) };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
  };
}

test("rejects non-POST", async () => {
  const res = mockRes();
  await handler({ method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 405);
});

test("500 when API key is missing", async () => {
  delete process.env.GEMINI_API_KEY;
  const res = mockRes();
  await handler(req({ mode: "coach", messages: [{ role: "user", content: "hi" }] }), res);
  assert.equal(res.statusCode, 500);
});

test("400 for invalid mode, no messages, and empty message", async () => {
  for (const body of [
    { mode: "hack", messages: [{ role: "user", content: "x" }] },
    { mode: "coach", messages: [] },
    { mode: "coach", messages: [{ role: "user", content: "   " }] },
  ]) {
    const res = mockRes();
    await handler(req(body), res);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
  }
});

test("coach returns reply and sends key in header, not in URL", async () => {
  mockGemini("Use the five parts!");
  const res = mockRes();
  await handler(req({ mode: "coach", messages: [{ role: "user", content: "What is a prompt?" }] }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reply, "Use the five parts!");
  assert.equal(lastCall.opts.headers["x-goog-api-key"], "test-key");
  assert.ok(!lastCall.url.includes("test-key"));
  assert.match(lastCall.body.systemInstruction.parts[0].text, /Prompt Coach/);
});

test("judge mode asks Gemini for JSON", async () => {
  mockGemini('{"scores":{}}');
  const res = mockRes();
  await handler(req({ mode: "judge", messages: [{ role: "user", content: "Write about AI" }] }), res);
  assert.equal(lastCall.body.generationConfig.responseMimeType, "application/json");
});

test("coach messages are cut to 1000 characters", async () => {
  mockGemini("ok");
  const res = mockRes();
  await handler(req({ mode: "coach", messages: [{ role: "user", content: "a".repeat(5000) }] }), res);
  assert.equal(lastCall.body.contents[0].parts[0].text.length, 1000);
});

test("Gemini 429 becomes a friendly 429", async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "quota" } }), { status: 429 });
  const res = mockRes();
  await handler(req({ mode: "coach", messages: [{ role: "user", content: "hi" }] }), res);
  assert.equal(res.statusCode, 429);
});

test("network failure returns 500 with friendly message", async () => {
  globalThis.fetch = async () => { throw new Error("offline"); };
  const res = mockRes();
  await handler(req({ mode: "coach", messages: [{ role: "user", content: "hi" }] }), res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /Could not reach/);
});

test("streaming converts Gemini SSE into our SSE format", async () => {
  const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"Hel"}]}}]}\r\n\r\ndata: {"candidates":[{"content":{"parts":[{"text":"lo"}]}}]}\r\n\r\n';
  globalThis.fetch = async (url) => {
    lastCall = { url };
    return new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  };
  const res = mockRes();
  await handler(req({ mode: "coach", stream: true, messages: [{ role: "user", content: "hi" }] }), res);
  assert.match(lastCall.url, /streamGenerateContent\?alt=sse/);
  assert.equal(res.headers["content-type"].startsWith("text/event-stream"), true);
  const out = res.chunks.join("");
  assert.match(out, /data: {"t":"Hel"}/);
  assert.match(out, /data: {"t":"lo"}/);
  assert.match(out, /data: \[DONE\]/);
});

test("rate limit returns 429 with Retry-After after 20 requests from one IP", async () => {
  mockGemini("ok");
  const fixed = { "x-forwarded-for": "9.9.9.9" };
  let last;
  for (let i = 0; i < 21; i++) {
    last = mockRes();
    await handler({ method: "POST", headers: fixed, body: { mode: "coach", messages: [{ role: "user", content: "hi" }] } }, last);
  }
  assert.equal(last.statusCode, 429);
  assert.ok(last.headers["retry-after"]);
});
