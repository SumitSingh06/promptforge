// Pure logic for PromptForge (no DOM) so it can be unit tested with `npm test`.

export const PARTS = {
  Role: {
    patterns: [/\b(you are|act as|acting as|pretend to be|your role)\b/i, /\bas an? (expert|teacher|tutor|developer|engineer|doctor|chef|writer|analyst|mentor|coach)\b/i],
    tip: 'Start with "You are a ..." so the AI knows who to be.',
  },
  Task: {
    patterns: [/\b(write|create|build|explain|generate|summari[sz]e|list|design|solve|compare|analy[sz]e|translate|convert|draft|suggest|give|make|teach)\b/i, /\b(task|your job|i want you to|i need)\b/i],
    tip: "Use a clear action verb: write, explain, compare, build...",
  },
  Context: {
    patterns: [/\b(because|background|context|audience|target|purpose|problem|for (a|an|my|the)|students?|beginners?|class \d+|grade \d+)\b/i, /\b(i am|i'm|we are|my (project|team|goal))\b/i],
    tip: "Add who it's for and why: audience, background, goal.",
  },
  Constraints: {
    patterns: [/\b(must|only|do not|don't|avoid|never|limit|within|at most|no more than|maximum|minimum|exactly|should|without)\b/i, /\b\d+\s*(words?|lines?|points?|bullets?|sentences?|paragraphs?|examples?|minutes?)\b/i],
    tip: 'Add limits: word count, tone, "do not..." rules.',
  },
  "Output Format": {
    patterns: [/\b(format|table|bullet|json|steps?|markdown|paragraph|headings?|code block|numbered|outline|csv|output)\b/i, /\b(in the form of|structured as|respond with)\b/i],
    tip: "Say how the answer should look: table, bullets, JSON, steps...",
  },
};

export const PART_NAMES = Object.keys(PARTS);

/** Heuristic score: 0 / 6 / 10 per part (0 = no pattern, 6 = one pattern, 10 = both). */
export function scorePrompt(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  const result = {};
  for (const [name, def] of Object.entries(PARTS)) {
    const hits = def.patterns.filter((p) => p.test(text)).length;
    let s = hits === 0 ? 0 : hits === 1 ? 6 : 10;
    if (name === "Context" && hits === 0 && words > 30) s = 4; // long prompts usually carry some context
    result[name] = s;
  }
  return result;
}

/** Sum of the 5 part scores (max 50) and the same as a 0-100 percentage. */
export function totalPct(scores) {
  const total = Object.values(scores).reduce((a, b) => a + b, 0);
  return { total, pct: Math.round((total / (PART_NAMES.length * 10)) * 100) };
}

export function verdict(pct) {
  return pct >= 80 ? "Forged! 🔥" : pct >= 50 ? "Getting there 👍" : "Needs work ⚒️";
}

/** Template rewrite: keeps what exists, adds placeholders for missing parts. */
export function buildRewrite(text, scores) {
  const clean = String(text).trim();
  const missing = (n) => scores[n] === 0;
  return [
    "ROLE: " + (missing("Role") ? "You are an expert [field] who explains things clearly." : "(keep your role line)"),
    "TASK: " + clean,
    "CONTEXT: " + (missing("Context") ? "[Who is this for? Why do they need it? Any background?]" : "(keep your context)"),
    "CONSTRAINTS: " + (missing("Constraints") ? "[Tone, length, things to avoid. e.g. max 150 words, simple language, no jargon]" : "(keep your constraints)"),
    "OUTPUT FORMAT: " + (missing("Output Format") ? "[e.g. 5 bullet points / a table / step-by-step list]" : "(keep your format)"),
  ].join("\n\n");
}

/* ---------------- Prompt Battle ---------------- */
export const LEVELS = [
  { target: "A 3-bullet summary of photosynthesis, written simply for a Class 7 student.",
    checks: [
      ["Mentions photosynthesis", /photosynthesis/i],
      ["Asks for 3 bullets", /\b(3|three)\b.*\bbullet|\bbullet.*\b(3|three)\b/i],
      ["Names the audience (Class 7)", /class\s*7|grade\s*7|7th/i],
      ["Asks for simple language", /simple|easy|basic/i],
    ] },
  { target: "A friendly email in under 100 words, from a student to a professor, asking for a 2-day deadline extension.",
    checks: [
      ["Email format", /email/i],
      ["Word limit (100)", /(under|less than|within|max(imum)?|at most)\s*100|100\s*words/i],
      ["Mentions professor", /professor|teacher|sir|ma'?am/i],
      ["Mentions extension of 2 days", /extension|extend/i],
      ["Tone (friendly/polite)", /friendly|polite|respectful|formal/i],
    ] },
  { target: "A comparison TABLE of Python vs C++ with columns Speed, Syntax, Use-cases.",
    checks: [
      ["Asks for a table", /table/i],
      ["Mentions both languages", /(python.*c\+\+|c\+\+.*python)/is],
      ["Mentions Speed column", /speed/i],
      ["Mentions Syntax column", /syntax/i],
      ["Mentions Use-cases column", /use[\s-]?cases?/i],
    ] },
  { target: "A step-by-step (chain-of-thought) solution to: 'A train travels 120 km in 2 hours. What is its speed in m/s?'",
    checks: [
      ["Asks for step-by-step", /step[\s-]?by[\s-]?step|think step|show (your )?(work|steps)/i],
      ["Includes the actual problem (120 km, 2 hours)", /120/i],
      ["Mentions m/s conversion", /m\/s|meters? per second/i],
      ["Gives a role (teacher/tutor)", /you are|act as/i],
    ] },
  { target: "JSON output only: a list of 3 startup ideas, each with 'name', 'problem' and 'audience' keys. No extra text.",
    checks: [
      ["Asks for JSON", /json/i],
      ["Asks for 3 ideas", /\b(3|three)\b/i],
      ["Lists the keys (name, problem, audience)", /name.*problem.*audience/is],
      ["Says no extra text", /(no|without|do not (add|include)|don't (add|include))\s+(any\s+)?(extra|other|additional|explanation)|only (json|output)/i],
    ] },
];

/** Runs a level's checklist against the user's prompt. */
export function checkLevel(level, text) {
  const items = level.checks.map(([label, re]) => ({ label, ok: re.test(text) }));
  const passed = items.filter((i) => i.ok).length;
  return { items, passed, total: items.length, ratio: passed / items.length };
}

/** Points for a round: the score itself, plus a streak bonus for a perfect round. */
export function battlePoints(score, streak) {
  return Math.round(score) + (score >= 100 ? streak * 10 : 0);
}

/* ---------------- Helpers ---------------- */
export function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Pulls a JSON object out of an AI reply, even if it is wrapped in ``` fences or extra text. */
export function parseJSON(text) {
  const s = String(text || "").replace(/```(?:json)?/gi, "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("AI did not return JSON");
  return JSON.parse(s.slice(a, b + 1));
}
