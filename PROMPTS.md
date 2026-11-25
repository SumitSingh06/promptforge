# Prompt Documentation

## 1. Initial project-building prompt (Five Parts)

**ROLE:**
You are a senior full-stack web developer and UI/UX designer who builds educational AI web apps for students, using clean, beginner-readable code.

**TASK:**
Build a complete, deployable website called "PromptForge", a platform where students learn prompt engineering by scoring, improving and practicing their prompts, with a working AI chatbot called "Prompt Coach".

**CONTEXT:**
- Problem: Students write weak prompts but get no feedback on why they are weak, so they repeat the same mistakes.
- Target audience: Engineering and school students learning prompt engineering, including Hindi/Hinglish speakers.
- Solution: analyze a prompt against the five parts, score it, highlight missing parts, rewrite it, and let students practice and ask questions.

**CONSTRAINTS:**
- HTML, CSS, vanilla JavaScript frontend; Vercel serverless function (`/api/chat.js`) backend.
- Chatbot calls a real LLM API (Gemini). Key from `process.env.GEMINI_API_KEY`, never in frontend code.
- Chatbot handles empty input, long input, network failure, API errors; shows loading indicator.
- Chatbot acts as "Prompt Coach", answers only prompt engineering questions, can reply in Hinglish.
- Features: Prompt X-Ray, Prompt Battle, Hinglish Mode, Technique Lab, Coach chatbot.
- Dark theme, orange/amber accent, glassmorphism, responsive. Clear comments, no secrets in repo.

**OUTPUT FORMAT:**
Folder structure, then full source code per file with paths, README.md, deployment steps.

**Tool used:** `ADD (e.g. Claude)`  |  **Output screenshot:** `ADD`

**How each part shaped the output:**
- Role → `ADD your explanation (e.g. "senior developer" made the code commented and beginner-readable)`
- Task → `ADD`
- Context → `ADD (e.g. Hinglish audience is why Hinglish Mode exists)`
- Constraints → `ADD (e.g. why the key is in an environment variable, why no frameworks)`
- Output Format → `ADD (e.g. why files came with paths and a README)`

## 2. System prompts inside the app (one per mode in `api/chat.js`)

| Mode | Used by | Prompt-engineering techniques | Why it is written this way |
|---|---|---|---|
| `coach` | Chatbot | Role prompting, constraints (scope + length), refusal rule, language-matching | Keeps the bot on-topic, short, and able to answer in Hinglish |
| `hinglish` | Hinglish Mode | Structured output (fixed 5-line layout), low temperature (0.3) | Output is always Role/Task/Context/Constraints/Output Format |
| `rewrite` | "Improve with AI" | Role prompting + output format + "[brackets] for unknown details" | Avoids the AI inventing facts; adds a short "Why it's better" |
| `judge` | AI Judge | Rubric prompting (0/5/10 anchors), JSON-only output, temperature 0.1, `responseMimeType: application/json` | Consistent, parseable scores |
| `run` | Battle (AI mode), Technique Lab | Minimal "follow the prompt exactly" system prompt | Tests the **user's** prompt without adding help |
| `battlejudge` | Battle (AI mode) | LLM-as-judge, JSON-only, compares OUTPUT with TARGET | Rewards prompts that really produce the target output |

Prompt techniques applied during development: role-based prompting, structured prompting, context-based prompting, chain prompting (built the project step by step), prompt refinement, reverse prompting (asked AI to review its own output), LLM-as-judge.

## 3. Technique Lab templates (the 4 techniques compared live)

| Technique | Template used |
|---|---|
| Zero-shot | `<task>` |
| Few-shot | 2 worked examples, then `Q: <task> A:` |
| Chain-of-Thought | `<task>` + "Think step by step and show your reasoning" |
| Role prompting | "You are an expert teacher..." + `<task>` + "under 120 words" |

## 4. Prompt evolution (before → after) — fill with your real prompts and screenshots

| # | Tool | Prompt (v1) | Problem in output | Improved prompt (v2) | Result |
|---|---|---|---|---|---|
| 1 | | "Add chatbot" | Static, hard-coded replies | "Chatbot must call Gemini via /api/chat with a system prompt, handle empty/long input, offline, 429" | Real AI replies with error handling |
| 2 | | "Make chatbot better" | Whole reply appears at once | "Use Server-Sent Events so text streams as it is generated" | Typing effect |
| 3 | | "Improve scoring" | Keyword scoring misses meaning | "Add an AI Judge mode that returns JSON scores 0-10 per part with a tip" | Context-aware scoring |
| 4 | | "Make battle better" | Checklist can be gamed with keywords | "Run the player's prompt with Gemini and judge the output against the target" | Real prompt testing |
| 5 | | "Add progress" | | "Save each score in localStorage and plot a line chart" | Visible improvement |
| 6 | | | | | |

## 5. Errors faced and fixes (examples to replace with your own)

| Error | Cause | Fix |
|---|---|---|
| Chatbot returned 500 on Vercel | `GEMINI_API_KEY` not set in Vercel env | Added it in Project Settings → Environment Variables and redeployed |
| `429 Too many requests` | Free API quota / rate limit | Friendly message + retry hint |
## Initial project-building prompt (five parts)
Saved in prompts/initial_prompt.txt. Role: senior full-stack developer and prompt teacher. Task: build PromptForge with a real AI chatbot. Context: students write weak prompts and get no feedback. Constraints: HTML/CSS/JS, Vercel serverless, Groq + Gemini, error handling. Output format: folder tree, full code, README, PROMPTS.md.

## Prompt evolution
| Version | Prompt | Problem / Improvement |
|---|---|---|
| V1 | Make a chatbot for my website. | Too vague: no tech, no purpose, generic code |
| V2 | + Role and tech stack | Better code, but no error handling or streaming |
| V3 | Full five-part prompt | Complete chatbot with streaming, validation, safe keys |

## Chain prompting used
1. Five-part prompt → website generated
2. Follow-up 1 → chatbot improved (typing indicator, clear button, history)
3. Follow-up 2 → bug review and error handling fixes
4. Cursor review → test cases

## Techniques used
- Role-based prompting: "Act as a senior web developer / code reviewer / research assistant"
- Structured prompting: Role-Task-Context-Constraints-Output Format
- Context-based prompting: problem, audience and purpose in every prompt
- Prompt refinement: V1 → V2 → V3
- Reverse prompting and evaluation: AI Judge and Battle judge score outputs; outputs checked against test cases
- Clear constraints: JSON-only output, word limits, refusal rules

## Errors faced and how we fixed them
| Error | Cause | Fix |
|---|---|---|
| Vercel 404 NOT_FOUND | Project files were in a nested folder | Pushed files at repo root / set Root Directory |
| Gemini model no longer available | Model was retired | Changed model name and made it configurable via env variable |
| 503 "high demand" from Gemini | Free tier overloaded | Retry once, then automatic fallback to Groq as primary |
| "Load failed" in chatbot | Request timed out / network error | Added maxDuration in vercel.json, shorter retries, friendly error message |
