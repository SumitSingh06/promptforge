import { test } from "node:test";
import assert from "node:assert/strict";
import { wordDiff } from "../lib/diff.js";
import { createLimiter } from "../lib/rateLimit.js";

test("wordDiff marks added and removed words", () => {
  const d = wordDiff("write about AI", "You are an expert. Write about AI today");
  const added = d.filter((p) => p.type === "add").map((p) => p.text).join(" ");
  assert.match(added, /expert/);
  assert.match(added, /today/);
  assert.ok(d.some((p) => p.type === "same" && /about AI/.test(p.text)));
});

test("wordDiff of identical text has no changes", () => {
  const d = wordDiff("a b c", "a b c");
  assert.deepEqual(d, [{ type: "same", text: "a b c" }]);
});

test("wordDiff detects deletions", () => {
  const d = wordDiff("keep remove keep2", "keep keep2");
  assert.ok(d.some((p) => p.type === "del" && p.text === "remove"));
});

test("rate limiter blocks after the limit and recovers after the window", () => {
  const check = createLimiter({ limit: 3, windowMs: 1000 });
  const t = 1_000_000;
  assert.equal(check("ip", t).ok, true);
  assert.equal(check("ip", t + 1).ok, true);
  assert.equal(check("ip", t + 2).ok, true);
  const blocked = check("ip", t + 3);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter >= 1);
  assert.equal(check("other-ip", t + 3).ok, true, "other IPs are unaffected");
  assert.equal(check("ip", t + 1500).ok, true, "allowed again after the window");
});
