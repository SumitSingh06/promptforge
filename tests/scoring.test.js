import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePrompt, totalPct, verdict, buildRewrite, LEVELS, checkLevel, battlePoints, clamp, parseJSON } from "../lib/scoring.js";

test("weak prompt scores low, strong prompt scores high", () => {
  const weak = totalPct(scorePrompt("Write about AI"));
  const strong = totalPct(scorePrompt(
    "You are an expert teacher. Explain photosynthesis to Class 7 students because they are beginners. " +
    "Do not use jargon, max 100 words. Respond with 3 bullet points."));
  assert.ok(weak.pct < 40, "weak should be < 40, got " + weak.pct);
  assert.ok(strong.pct >= 70, "strong should be >= 70, got " + strong.pct);
  assert.ok(strong.pct - weak.pct >= 40, "strong should beat weak by 40+ points");
});

test("each part is detected", () => {
  assert.equal(scorePrompt("You are a chef")["Role"] > 0, true);
  assert.equal(scorePrompt("hello there")["Role"], 0);
  assert.equal(scorePrompt("respond with a table")["Output Format"] > 0, true);
  assert.equal(scorePrompt("no more than 50 words")["Constraints"] > 0, true);
});

test("long prompt without keywords still gets a little Context credit", () => {
  const long = Array(40).fill("lorem").join(" ");
  assert.equal(scorePrompt(long)["Context"], 4);
});

test("totalPct is out of 100 and verdict thresholds work", () => {
  assert.deepEqual(totalPct({ a: 10, b: 10, c: 10, d: 10, e: 10 }), { total: 50, pct: 100 });
  assert.equal(verdict(90), "Forged! 🔥");
  assert.equal(verdict(60), "Getting there 👍");
  assert.equal(verdict(10), "Needs work ⚒️");
});

test("buildRewrite only adds placeholders for missing parts", () => {
  const scores = { Role: 0, Task: 10, Context: 10, Constraints: 0, "Output Format": 10 };
  const out = buildRewrite("Explain DNS", scores);
  assert.match(out, /ROLE: You are an expert/);
  assert.match(out, /CONTEXT: \(keep your context\)/);
  assert.match(out, /CONSTRAINTS: \[Tone/);
});

test("battle level 1 passes with a good prompt and fails with a bad one", () => {
  const good = checkLevel(LEVELS[0], "Explain photosynthesis in 3 bullet points in simple words for a Class 7 student");
  assert.equal(good.ratio, 1);
  const bad = checkLevel(LEVELS[0], "tell me something");
  assert.ok(bad.ratio < 0.5);
});

test("battlePoints gives a streak bonus only for perfect rounds", () => {
  assert.equal(battlePoints(100, 3), 130);
  assert.equal(battlePoints(80, 3), 80);
});

test("clamp handles bad numbers", () => {
  assert.equal(clamp("abc", 0, 10), 0);
  assert.equal(clamp(99, 0, 10), 10);
  assert.equal(clamp(-5, 0, 10), 0);
  assert.equal(clamp(7.5, 0, 10), 7.5);
});

test("parseJSON strips code fences and surrounding text", () => {
  assert.deepEqual(parseJSON('```json\n{"score": 80}\n```'), { score: 80 });
  assert.deepEqual(parseJSON('Sure! {"a":1} done'), { a: 1 });
  assert.throws(() => parseJSON("no json here"));
});
