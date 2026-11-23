/* =====================================================
   PromptForge - frontend logic (ES module)
   Sections: helpers, theme/lang, voice, X-Ray (+AI Judge, diff, share, export),
             History, Battle (+AI mode), Hinglish, Technique Lab (live), Chatbot (streaming)
   ===================================================== */
import { PARTS, PART_NAMES, scorePrompt, totalPct, verdict, buildRewrite, LEVELS, checkLevel, battlePoints, clamp, parseJSON } from "./lib/scoring.js";
import { wordDiff } from "./lib/diff.js";

const $ = (id) => document.getElementById(id);

/* ---------- Safe localStorage ---------- */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage blocked: ignore */ } },
};

/* ---------- Small UI helpers ---------- */
let toastTimer;
function toast(msg) {
  const t = $("toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}
function skeleton(el) { el.innerHTML = '<div class="sk"></div><div class="sk"></div><div class="sk"></div>'; }
function copyText(text) {
  if (!navigator.clipboard) { toast("Copy not supported in this browser."); return; }
  navigator.clipboard.writeText(text).then(() => toast("Copied ✅"), () => toast("Could not copy."));
}
function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/* ---------- API helpers (talk to /api/chat) ---------- */
async function callAI(mode, messages) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, messages }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Server error (" + res.status + ")");
  return data.reply;
}

// Streaming version: calls onToken(fullTextSoFar) as chunks arrive, returns the full text.
async function callAIStream(mode, messages, onToken) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode, messages, stream: true }),
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || "Server error (" + res.status + ")");
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "", full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (payload === "[DONE]") return full;
      try {
        const j = JSON.parse(payload);
        if (j.error) throw new Error(j.error);
        if (j.t) { full += j.t; onToken(full); }
      } catch (e) { if (e.message && !(e instanceof SyntaxError)) throw e; }
    }
  }
  return full;
}

/* =====================================================
   THEME + INTERFACE LANGUAGE (English / Hinglish)
   ===================================================== */
const I18N = {
  en: {
    nav_xray: "X-Ray", nav_battle: "Battle", nav_lab: "Lab", nav_history: "History",
    hero_a: "Forge", hero_b: "better prompts.",
    hero_p: "Paste your prompt. Get a score on the 5 parts of a good prompt, see what's missing, and fix it like a pro.",
    hero_cta: "Start X-Ray ⚡",
    xray_sub: "Checks Role, Task, Context, Constraints and Output Format. Use Instant (rules) or AI Judge (Gemini).",
    xray_ph: "Paste your prompt here...\ne.g. Write about AI",
    btn_analyze: "Analyze", btn_sample: "Load sample",
    battle_sub: "Write a prompt that would produce the target output. 5 levels.",
  },
  hi: {
    nav_xray: "X-Ray", nav_battle: "Battle", nav_lab: "Lab", nav_history: "Progress",
    hero_a: "Apne prompts ko", hero_b: "behtar banao.",
    hero_p: "Apna prompt paste karo. Achhe prompt ke 5 parts pe score pao, dekho kya missing hai, aur pro ki tarah fix karo.",
    hero_cta: "X-Ray shuru karo ⚡",
    xray_sub: "Role, Task, Context, Constraints aur Output Format check hota hai. Instant (rules) ya AI Judge (Gemini) chuno.",
    xray_ph: "Apna prompt yahan paste karo...\njaise: Write about AI",
    btn_analyze: "Check karo", btn_sample: "Sample lo",
    battle_sub: "Aisa prompt likho jo target output de. 5 levels.",
  },
};
let lang = store.get("pf_lang", "en");
function applyLang(l) {
  lang = l; store.set("pf_lang", l);
  document.documentElement.lang = l === "hi" ? "hi" : "en";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = I18N[l][el.dataset.i18n] ?? I18N.en[el.dataset.i18n]; });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = I18N[l][el.dataset.i18nPh] ?? I18N.en[el.dataset.i18nPh]; });
  $("langBtn").textContent = l === "hi" ? "EN" : "हिं";
}
$("langBtn").onclick = () => applyLang(lang === "hi" ? "en" : "hi");

let theme = store.get("pf_theme", "dark");
function applyTheme(t) {
  theme = t; store.set("pf_theme", t);
  document.documentElement.dataset.theme = t;
  $("themeBtn").textContent = t === "light" ? "🌙" : "☀️";
  if (last) renderRadar(last.scores);
  renderHistory();
}
$("themeBtn").onclick = () => applyTheme(theme === "light" ? "dark" : "light");

/* =====================================================
   VOICE INPUT (Web Speech API - works in Chrome/Edge)
   ===================================================== */
function attachMic(btn, target) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { btn.hidden = true; return; } // browser does not support it
  let rec = null, on = false;
  btn.onclick = () => {
    if (on && rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = lang === "hi" ? "hi-IN" : "en-IN";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const said = e.results[0][0].transcript;
      target.value = (target.value + " " + said).trim();
    };
    rec.onerror = (e) => toast("Mic error: " + (e.error || "unknown"));
    rec.onend = () => { on = false; btn.classList.remove("rec"); };
    try { rec.start(); on = true; btn.classList.add("rec"); toast("Listening... speak now 🎤"); }
    catch { toast("Could not start the microphone."); }
  };
}
attachMic($("micXray"), $("xrayInput"));
attachMic($("micHing"), $("hingInput"));
attachMic($("micChat"), $("chatInput"));

/* =====================================================
   1. PROMPT X-RAY  (Instant rules + AI Judge)
   ===================================================== */
let radarChart;
let last = null; // last analysis: { prompt, scores, tips, summary, source, pct, total, improved }

function renderRadar(scores) {
  if (typeof Chart === "undefined") return; // CDN blocked: the rest of the page still works
  const ctx = $("radar").getContext("2d");
  if (radarChart) radarChart.destroy();
  const grid = theme === "light" ? "rgba(0,0,0,.15)" : "rgba(255,255,255,.12)";
  radarChart = new Chart(ctx, {
    type: "radar",
    data: {
      labels: Object.keys(scores),
      datasets: [{ label: "Score", data: Object.values(scores), backgroundColor: "rgba(255,138,31,.25)", borderColor: "#ff8a1f", pointBackgroundColor: "#ffc247" }],
    },
    options: {
      scales: { r: { min: 0, max: 10, ticks: { display: false }, grid: { color: grid }, angleLines: { color: grid }, pointLabels: { color: cssVar("--text") } } },
      plugins: { legend: { display: false } },
    },
  });
}

function showResult({ prompt, scores, tips = {}, summary = "", source }) {
  const { total, pct } = totalPct(scores);
  const sameAsBefore = last && last.prompt === prompt;
  last = { prompt, scores, tips, summary, source, pct, total, improved: sameAsBefore ? last.improved : null };

  $("xrayResult").hidden = false;
  $("rewriteCard").hidden = false;
  $("aiRewriteOut").hidden = true;
  if (!sameAsBefore) $("diffCard").hidden = true;
  $("scoreRing").style.setProperty("--p", pct);
  $("scoreNum").textContent = pct;
  $("scoreLabel").textContent = verdict(pct);
  $("scoreHint").textContent = (source === "ai" ? "🤖 AI Judge: " : "⚡ Instant: ") + (summary || "score out of 100 (" + total + "/50 raw).");

  const list = $("partsList");
  list.innerHTML = "";
  for (const name of PART_NAMES) {
    const s = scores[name];
    const li = document.createElement("li");
    li.className = s >= 6 ? "ok" : "miss";
    const tip = tips[name] || (s < 10 ? PARTS[name].tip : "");
    li.textContent = (s >= 6 ? "✅ " : "❌ ") + name + " (" + s + "/10)" + (tip ? " - " + tip : "");
    list.appendChild(li);
  }
  renderRadar(scores);
  $("rewriteOut").textContent = buildRewrite(prompt, scores);
  $("xrayResult").scrollIntoView({ behavior: "smooth", block: "nearest" });
  pushHistory({ t: Date.now(), pct, src: source, snippet: prompt.slice(0, 60) });
}

$("sampleBtn").onclick = () => { $("xrayInput").value = "Write about AI"; };

$("analyzeBtn").onclick = () => {
  const prompt = $("xrayInput").value.trim();
  if (!prompt) { toast("Please paste a prompt first."); return; }
  showResult({ prompt, scores: scorePrompt(prompt), source: "instant" });
};

$("judgeBtn").onclick = async () => {
  const prompt = $("xrayInput").value.trim();
  if (!prompt) { toast("Please paste a prompt first."); return; }
  const btn = $("judgeBtn");
  btn.disabled = true; btn.textContent = "Judging...";
  try {
    const j = parseJSON(await callAI("judge", [{ role: "user", content: prompt }]));
    const scores = {};
    for (const n of PART_NAMES) scores[n] = Math.round(clamp(j.scores && j.scores[n], 0, 10));
    showResult({ prompt, scores, tips: j.feedback || {}, summary: String(j.summary || ""), source: "ai" });
  } catch (e) {
    toast("AI Judge unavailable (" + e.message + "). Showing instant score.");
    showResult({ prompt, scores: scorePrompt(prompt), source: "instant" });
  } finally {
    btn.disabled = false; btn.textContent = "🤖 AI Judge";
  }
};

$("copyRewrite").onclick = () => copyText($("rewriteOut").textContent);

function renderDiff(before, after) {
  const box = $("diffBody");
  box.innerHTML = "";
  wordDiff(before, after).forEach((part) => {
    const el = document.createElement(part.type === "add" ? "ins" : part.type === "del" ? "del" : "span");
    el.textContent = part.text + " ";
    box.appendChild(el);
  });
  $("diffCard").hidden = false;
}

$("aiRewrite").onclick = async () => {
  const text = $("xrayInput").value.trim();
  if (!text) { toast("Paste a prompt first."); return; }
  const btn = $("aiRewrite");
  btn.disabled = true; btn.textContent = "Improving...";
  const out = $("aiRewriteOut");
  out.hidden = false; skeleton(out);
  try {
    const full = await callAIStream("rewrite", [{ role: "user", content: text }], (t) => { out.textContent = t; });
    const improved = full.split(/why it'?s better:/i)[0].trim();
    if (last) last.improved = improved;
    if (improved) renderDiff(text, improved);
  } catch (e) {
    out.textContent = "⚠️ " + e.message;
  } finally {
    btn.disabled = false; btn.textContent = "Improve with AI";
  }
};

/* ---------- Share card (PNG made with <canvas>) ---------- */
$("shareBtn").onclick = () => {
  if (!last) return;
  const c = document.createElement("canvas");
  c.width = 1200; c.height = 630;
  const g = c.getContext("2d");
  const bg = g.createLinearGradient(0, 0, 1200, 630);
  bg.addColorStop(0, "#0b0b10"); bg.addColorStop(1, "#3a1a05");
  g.fillStyle = bg; g.fillRect(0, 0, 1200, 630);

  g.fillStyle = "#ffc247"; g.font = "bold 44px system-ui, sans-serif"; g.fillText("🔥 PromptForge", 60, 90);
  g.fillStyle = "#f2f2f5"; g.font = "bold 190px system-ui, sans-serif"; g.fillText(String(last.pct), 60, 330);
  g.fillStyle = "#9a9aa8"; g.font = "40px system-ui, sans-serif"; g.fillText("/ 100", 60, 390);
  g.fillStyle = "#ffc247"; g.fillText(verdict(last.pct), 220, 390);

  PART_NAMES.forEach((n, i) => {
    const y = 130 + i * 62;
    g.fillStyle = "#f2f2f5"; g.font = "28px system-ui, sans-serif"; g.fillText(n, 700, y + 24);
    g.fillStyle = "rgba(255,255,255,.12)"; g.fillRect(940, y, 200, 30);
    g.fillStyle = "#ff8a1f"; g.fillRect(940, y, (last.scores[n] / 10) * 200, 30);
  });

  g.fillStyle = "#9a9aa8"; g.font = "italic 30px system-ui, sans-serif";
  const snip = '"' + last.prompt.replace(/\s+/g, " ").slice(0, 70) + (last.prompt.length > 70 ? "..." : "") + '"';
  g.fillText(snip, 60, 470);
  g.fillStyle = "#ffc247"; g.font = "26px system-ui, sans-serif";
  g.fillText("Scored with the 5 parts of a good prompt: Role • Task • Context • Constraints • Output Format", 60, 560);

  c.toBlob((b) => { if (b) { downloadBlob(b, "promptforge-score.png"); toast("Share card downloaded 📸"); } }, "image/png");
};

/* ---------- Export: .txt and PDF (print dialog) ---------- */
function reportText() {
  const lines = [
    "PromptForge report",
    "==================",
    "Scored by: " + (last.source === "ai" ? "AI Judge (Gemini)" : "Instant rules"),
    "Overall: " + last.pct + "/100 - " + verdict(last.pct),
    "",
    "YOUR PROMPT:", last.prompt, "",
    "PART SCORES:",
    ...PART_NAMES.map((n) => " - " + n + ": " + last.scores[n] + "/10" + (last.tips[n] ? "  (" + last.tips[n] + ")" : "")),
    "",
    "IMPROVED PROMPT" + (last.improved ? " (AI)" : " (template)") + ":",
    last.improved || $("rewriteOut").textContent,
  ];
  return lines.join("\n");
}
$("txtBtn").onclick = () => {
  if (!last) return;
  downloadBlob(new Blob([reportText()], { type: "text/plain;charset=utf-8" }), "promptforge-report.txt");
};
$("pdfBtn").onclick = () => {
  if (!last) return;
  const w = window.open("", "_blank");
  if (!w) { toast("Allow pop-ups to export PDF, or use the .txt button."); return; }
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  w.document.write("<!doctype html><title>PromptForge report</title><body style=\"font-family:system-ui;max-width:720px;margin:30px auto;padding:0 16px\"><pre style=\"white-space:pre-wrap;font:14px/1.6 ui-monospace,Menlo,monospace\">" + esc(reportText()) + "</pre></body>");
  w.document.close(); w.focus();
  setTimeout(() => w.print(), 300); // choose "Save as PDF" in the print dialog
};

/* =====================================================
   2. HISTORY (progress graph)
   ===================================================== */
let hist = store.get("pf_hist", []);
let histChart;
function pushHistory(entry) {
  hist.push(entry); hist = hist.slice(-30);
  store.set("pf_hist", hist);
  renderHistory();
}
function renderHistory() {
  const has = hist.length > 0;
  $("histEmpty").hidden = has;
  $("histChart").hidden = !has;
  $("histClear").hidden = !has;
  const list = $("histList");
  list.innerHTML = "";
  hist.slice(-5).reverse().forEach((h) => {
    const li = document.createElement("li");
    li.className = h.pct >= 50 ? "ok" : "miss";
    li.textContent = new Date(h.t).toLocaleString() + " • " + (h.src === "ai" ? "🤖" : "⚡") + " " + h.pct + "/100 • " + h.snippet;
    list.appendChild(li);
  });
  if (!has || typeof Chart === "undefined") return;
  if (histChart) histChart.destroy();
  const grid = theme === "light" ? "rgba(0,0,0,.12)" : "rgba(255,255,255,.1)";
  histChart = new Chart($("histChart").getContext("2d"), {
    type: "line",
    data: { labels: hist.map((_, i) => "#" + (i + 1)), datasets: [{ label: "Score", data: hist.map((h) => h.pct), borderColor: "#ff8a1f", backgroundColor: "rgba(255,138,31,.2)", fill: true, tension: 0.3, pointBackgroundColor: "#ffc247" }] },
    options: {
      scales: { y: { min: 0, max: 100, ticks: { color: cssVar("--muted") }, grid: { color: grid } }, x: { ticks: { color: cssVar("--muted") }, grid: { color: grid } } },
      plugins: { legend: { display: false } },
    },
  });
}
$("histClear").onclick = () => { hist = []; store.set("pf_hist", hist); renderHistory(); toast("History cleared."); };
renderHistory();

/* =====================================================
   3. PROMPT BATTLE (checklist mode + AI mode)
   ===================================================== */
let game = store.get("pf_game", { level: 0, points: 0, streak: 0 });
function renderGame() {
  const done = game.level >= LEVELS.length;
  $("lvl").textContent = Math.min(game.level + 1, LEVELS.length);
  $("pts").textContent = game.points;
  $("streak").textContent = game.streak;
  $("targetText").textContent = done ? "🏆 All levels completed! Total points: " + game.points : LEVELS[game.level].target;
  $("battleBtn").disabled = done;
  $("nextBtn").hidden = true;
}
renderGame();

$("battleBtn").onclick = async () => {
  const text = $("battleInput").value.trim();
  if (!text) { toast("Write a prompt first."); return; }
  const lvl = LEVELS[game.level];
  const fb = $("battleFeedback");
  fb.innerHTML = "";

  // 1) checklist (always shown, it teaches what a good prompt contains)
  const res = checkLevel(lvl, text);
  res.items.forEach((it) => {
    const li = document.createElement("li");
    li.className = it.ok ? "ok" : "miss";
    li.textContent = (it.ok ? "✅ " : "❌ ") + it.label;
    fb.appendChild(li);
  });
  let score = Math.round(res.ratio * 100);
  let pass = res.ratio >= 0.8;
  const note = document.createElement("li");

  // 2) AI mode: run the prompt for real, then let an AI judge compare with the target
  $("battleOutWrap").hidden = true;
  const btn = $("battleBtn");
  if ($("battleAi").checked) {
    btn.disabled = true; btn.textContent = "Running AI...";
    $("battleOutWrap").hidden = false; skeleton($("battleOut"));
    try {
      const output = await callAI("run", [{ role: "user", content: text }]);
      $("battleOut").textContent = output;
      const j = parseJSON(await callAI("battlejudge", [{ role: "user", content: "TARGET:\n" + lvl.target + "\n\nPROMPT:\n" + text + "\n\nOUTPUT:\n" + output }]));
      score = Math.round(clamp(j.score, 0, 100));
      pass = score >= 70;
      note.textContent = "🤖 AI judge: " + score + "/100 - " + String(j.reason || "");
      note.className = pass ? "ok" : "miss";
      fb.appendChild(note);
    } catch (e) {
      $("battleOut").textContent = "(AI output unavailable)";
      const warn = document.createElement("li");
      warn.textContent = "⚠️ AI unavailable (" + e.message + "). Used the checklist score instead.";
      fb.appendChild(warn);
    } finally {
      btn.textContent = "Submit";
    }
  }

  // 3) points / streak
  const summary = document.createElement("li");
  if (pass) {
    const gained = battlePoints(score, game.streak);
    game.points += gained; game.streak += 1; game.level += 1;
    summary.textContent = "🎉 Level cleared! +" + gained + " points.";
    summary.className = "ok";
    store.set("pf_game", game);
    $("nextBtn").hidden = game.level >= LEVELS.length;
    btn.disabled = true; // stop double-scoring the same level
    if (game.level >= LEVELS.length) setTimeout(renderGame, 1200);
  } else {
    game.streak = 0; store.set("pf_game", game);
    btn.disabled = false;
    summary.textContent = "Not quite (" + score + "/100). Improve your prompt and retry.";
    summary.className = "miss";
  }
  fb.appendChild(summary);
  $("pts").textContent = game.points; $("streak").textContent = game.streak;
};
$("nextBtn").onclick = () => { $("battleInput").value = ""; $("battleFeedback").innerHTML = ""; $("battleOutWrap").hidden = true; renderGame(); };
$("resetBtn").onclick = () => {
  game = { level: 0, points: 0, streak: 0 }; store.set("pf_game", game);
  $("battleInput").value = ""; $("battleFeedback").innerHTML = ""; $("battleOutWrap").hidden = true; renderGame();
};

/* =====================================================
   4. HINGLISH MODE (AI first, local template as fallback)
   ===================================================== */
function localHinglish(text) {
  return [
    "Role: You are an expert and friendly teacher/assistant.",
    "Task: " + text + "  (translate this intent into clear English)",
    "Context: [Add who the audience is and why they need this]",
    "Constraints: Use simple language. Keep it concise. Avoid jargon.",
    "Output Format: Step-by-step points with a short example.",
  ].join("\n");
}
$("hingBtn").onclick = async () => {
  const text = $("hingInput").value.trim();
  if (!text) { toast("Write something in Hinglish first."); return; }
  const btn = $("hingBtn");
  btn.disabled = true; btn.textContent = "Converting...";
  skeleton($("hingOut"));
  try {
    $("hingOut").textContent = await callAI("hinglish", [{ role: "user", content: text }]);
  } catch (e) {
    $("hingOut").textContent = localHinglish(text) + "\n\n(AI unavailable: showing offline template. " + e.message + ")";
  } finally {
    btn.disabled = false; btn.textContent = "Convert ➜";
  }
};
$("copyHing").onclick = () => copyText($("hingOut").textContent);

/* =====================================================
   5. TECHNIQUE LAB (live: runs the same task 4 ways)
   ===================================================== */
const TECHNIQUES = [
  { name: "Zero-shot", desc: "Ask directly with no examples.",
    when: "Simple, well-known tasks (translation, classification, quick facts).",
    build: (task) => task },
  { name: "Few-shot", desc: "Give 2 examples so the AI copies the pattern.",
    when: "When you need a specific style or custom format.",
    build: (task) => "Example 1:\nQ: What is 2+2?\nA: 4 - adding two and two gives four.\n\nExample 2:\nQ: Name a primary colour.\nA: Red - it cannot be made by mixing other colours.\n\nAnswer in the same style (short answer, a dash, then a one-line reason).\nQ: " + task + "\nA:" },
  { name: "Chain-of-Thought", desc: "Ask the AI to reason step by step.",
    when: "Maths, logic, multi-step reasoning.",
    build: (task) => task + "\n\nThink step by step and show your reasoning before the final answer." },
  { name: "Role prompting", desc: "Assign an identity and expertise.",
    when: "To control tone, depth and perspective.",
    build: (task) => "You are an expert teacher who explains clearly to beginners.\n" + task + "\nKeep it under 120 words." },
];
const labOut = [];
TECHNIQUES.forEach((t) => {
  const d = document.createElement("div");
  d.className = "card tech";
  const h = document.createElement("h3"); h.textContent = t.name;
  const p = document.createElement("p"); p.textContent = t.desc;
  const pre = document.createElement("pre"); pre.textContent = t.build("<your task>");
  const w = document.createElement("p"); w.className = "when"; w.textContent = "✅ Use when: " + t.when;
  const lab = document.createElement("p"); lab.className = "live-label"; lab.textContent = "Live output";
  const live = document.createElement("div"); live.className = "live muted"; live.textContent = "Press “Run all 4 techniques”.";
  d.append(h, p, pre, w, lab, live);
  $("labGrid").appendChild(d);
  labOut.push(live);
});
$("labRun").onclick = async () => {
  const task = $("labTask").value.trim();
  if (!task) { toast("Type a task first."); return; }
  const btn = $("labRun");
  btn.disabled = true; btn.textContent = "Running...";
  await Promise.all(TECHNIQUES.map(async (t, i) => {
    skeleton(labOut[i]);
    try {
      const out = await callAI("run", [{ role: "user", content: t.build(task) }]);
      labOut[i].className = "live"; labOut[i].textContent = out;
    } catch (e) {
      labOut[i].className = "live muted"; labOut[i].textContent = "⚠️ " + e.message;
    }
  }));
  btn.disabled = false; btn.textContent = "Run all 4 techniques ▶";
};

/* =====================================================
   6. PROMPT COACH CHATBOT (streaming + saved history)
   ===================================================== */
const GREETING = "Hi! Main Prompt Coach hoon. Prompt engineering ka koi bhi sawal poochho. 🙂";
const MAX_LEN = 1000;
let chat = store.get("pf_chat", []); // [{role:"user"|"assistant", content}]

function addMsg(text, cls) {
  const m = document.createElement("div");
  m.className = "msg " + cls;
  m.textContent = text;
  $("chatLog").appendChild(m);
  $("chatLog").scrollTop = $("chatLog").scrollHeight;
  return m;
}
function renderChat() {
  $("chatLog").innerHTML = "";
  addMsg(GREETING, "bot");
  chat.forEach((m) => addMsg(m.content, m.role === "user" ? "user" : "bot"));
}
renderChat();

$("chatFab").onclick = () => { $("chatBox").hidden = !$("chatBox").hidden; if (!$("chatBox").hidden) $("chatInput").focus(); };
$("chatClose").onclick = () => { $("chatBox").hidden = true; };
$("chatClear").onclick = () => { chat = []; store.set("pf_chat", chat); renderChat(); toast("Chat cleared."); };

$("chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("chatInput").value.trim();
  if (!text) { addMsg("Please type a question first.", "err"); return; }                                  // invalid: empty
  if (text.length > MAX_LEN) { addMsg("Message too long (max " + MAX_LEN + " characters).", "err"); return; } // invalid: too long

  addMsg(text, "user");
  $("chatInput").value = "";
  chat.push({ role: "user", content: text });

  const bubble = addMsg("Typing...", "bot");
  const send = $("chatSend");
  send.disabled = true;
  try {
    const reply = await callAIStream("coach", chat.slice(-10), (t) => {
      bubble.textContent = t; $("chatLog").scrollTop = $("chatLog").scrollHeight;
    });
    if (!reply.trim()) throw new Error("Empty reply");
    chat.push({ role: "assistant", content: reply });
    chat = chat.slice(-40);
    store.set("pf_chat", chat);
  } catch (err) {
    bubble.className = "msg err";
    bubble.textContent = navigator.onLine
      ? "⚠️ Coach is unavailable right now: " + err.message
      : "⚠️ You seem to be offline. Check your internet and try again.";
    chat.pop(); // drop the failed user message so history stays valid
  } finally {
    send.disabled = false;
    $("chatLog").scrollTop = $("chatLog").scrollHeight;
  }
};

/* ---------- init ---------- */
applyTheme(theme);
applyLang(lang);
