import { guessCandidates, hashKey } from "./normalize.js";
import { sha256Hex } from "./sha256.js";
import { loadState, saveState } from "./storage.js";

const MAX_ATTEMPTS = 3;

// Moon geometry in the source artwork (2000x1000). The scene shows a 1000-wide
// crop starting at x = 486 (see .scene in style.css).
const CROP_X = 486;
const CROP_W = 1000;
const MOON = { cx: 986, cy: 552, r: 452, clipY: 769 }; // clipY: where the stage hides the moon

const FONT_STACK = getComputedStyle(document.documentElement).getPropertyValue("--font").trim();

const I18N = {
  zh: {
    title: "中秋猜灯谜",
    counter: (i, n) => `第 ${i} 题 · 共 ${n} 题`,
    random: "换一题",
    answerLabel: "你的答案",
    placeholder: "输入谜底…",
    submit: "提交",
    attemptsLabel: "剩余机会",
    empty: "请先输入答案哦",
    wrong: (n) => `没猜中，再想想～ 还剩 ${n} 次机会`,
    out: "机会已用完，感谢参与！中秋快乐 🌕",
    wonBanner: "🏆 你已猜中！点此查看",
    footer: "花好月圆 · 中秋快乐",
    congratsTitle: "恭喜你，猜中啦！",
    congratsSub: "花好月圆，阖家团圆",
    congratsGreet: "祝你中秋快乐！",
    congratsTime: (t) => `猜中时间：${t}`,
    close: "好的",
    loadError: "灯谜加载失败，请刷新重试",
  },
  en: {
    title: "Mid-Autumn Riddles",
    counter: (i, n) => `Riddle ${i} of ${n}`,
    random: "Another riddle",
    answerLabel: "Your answer",
    placeholder: "Type your answer…",
    submit: "Submit",
    attemptsLabel: "Chances left",
    empty: "Please type an answer first",
    wrong: (n) => `Not quite — ${n} ${n === 1 ? "chance" : "chances"} left`,
    out: "No chances left. Thanks for playing — Happy Mid-Autumn! 🌕",
    wonBanner: "🏆 You got it! Tap to view",
    footer: "Happy Mid-Autumn Festival",
    congratsTitle: "Congratulations!",
    congratsSub: "You solved the lantern riddle",
    congratsGreet: "Happy Mid-Autumn Festival!",
    congratsTime: (t) => `Solved at ${t}`,
    close: "OK",
    loadError: "Could not load riddles. Please refresh.",
  },
};

const $ = (id) => document.getElementById(id);
const els = {
  scene: $("scene"),
  riddle: $("riddle"),
  riddleText: $("riddleText"),
  counter: $("counter"),
  randomBtn: $("randomBtn"),
  form: $("answerForm"),
  input: $("answerInput"),
  submitBtn: $("submitBtn"),
  attemptIcons: $("attemptIcons"),
  message: $("message"),
  wonBtn: $("wonBtn"),
  congrats: $("congrats"),
  congratsTime: $("congratsTime"),
  closeCongrats: $("closeCongrats"),
  petals: $("petals"),
};

let data = null;
let current = 0;
let lang = "zh";
let state = null;
let messageKey = null; // [key, ...args] so the message follows language switches

const t = (key, ...args) => {
  const v = I18N[lang][key];
  return typeof v === "function" ? v(...args) : v;
};

/* ------------------------------------------------------------------ */
/* Riddle layout: fit the text inside the moon, line by line.          */
/* ------------------------------------------------------------------ */

const measureCtx = document.createElement("canvas").getContext("2d");
// Width scales linearly with font size, so measure once at 100px and scale.
let measureCache = new Map();
const measure = (text, size) => {
  let w = measureCache.get(text);
  if (w === undefined) {
    measureCtx.font = `700 100px ${FONT_STACK}`;
    w = measureCtx.measureText(text).width / 100;
    measureCache.set(text, w);
  }
  return w * size;
};

const PUNCT = /[／，。！？；：、,.!?;:）)」』”’…～]/;
const BREAK_AFTER = /[／，。！？；]/;

// Units are the pieces a line may not split: a Chinese character (with any
// trailing punctuation glued on) or an English word. Phrases are groups that
// read best on their own line (Chinese clauses ending in ，。).
function tokenize(text, isZh) {
  if (!isZh) {
    return [text.split(/\s+/).filter(Boolean)];
  }
  const phrases = [];
  let phrase = [];
  for (const ch of text.replace(/\s+/g, "")) {
    if (PUNCT.test(ch) && phrase.length) phrase[phrase.length - 1] += ch;
    else phrase.push(ch);
    if (BREAK_AFTER.test(ch)) { phrases.push(phrase); phrase = []; }
  }
  if (phrase.length) phrases.push(phrase);
  return phrases;
}

function sceneGeometry() {
  const w = els.scene.clientWidth;
  const s = w / CROP_W;
  const moon = {
    cx: (MOON.cx - CROP_X) * s,
    cy: MOON.cy * s,
    r: MOON.r * s,
    clipY: MOON.clipY * s,
  };
  const inner = moon.r * 0.84;                 // keep text off the glowing rim
  return {
    width: w,
    moon,
    inner,
    top: moon.cy - inner,
    bottom: moon.clipY - moon.r * 0.07,
  };
}

// Width of the moon available between y0 and y1 (0 if outside).
function chord(g, y0, y1) {
  if (y0 < g.top || y1 > g.bottom) return 0;
  const half = (y) => {
    const dy = y - g.moon.cy;
    return dy * dy >= g.inner * g.inner ? 0 : Math.sqrt(g.inner * g.inner - dy * dy);
  };
  return 2 * Math.min(half(y0), half(y1));
}

// Greedily fills lines whose widths come from widthAt(lineIndex).
// perPhrase: false = free flow, "soft" = each clause starts a new line,
// "strict" = each clause must sit on exactly one line.
// Returns lines or null if something does not fit within maxLines.
function fillLines(phrases, perPhrase, size, gap, widthAt, maxLines) {
  const lines = [];
  let line = null;
  const newLine = () => {
    if (lines.length >= maxLines) return false;
    line = { units: [], width: 0 };
    lines.push(line);
    return true;
  };
  for (const phrase of phrases) {
    if (perPhrase || !line) { if (!newLine()) return null; }
    for (const unit of phrase) {
      const w = measure(unit, size);
      const extra = line.units.length ? gap : 0;
      if (line.units.length && line.width + extra + w > widthAt(lines.length - 1)) {
        if (perPhrase === "strict" || !newLine()) return null;
        line.units.push(unit); line.width = w;
      } else {
        line.units.push(unit); line.width += extra + w;
      }
      if (line.width > widthAt(lines.length - 1)) return null;
    }
  }
  return lines;
}

function tryFit(g, phrases, isZh, size, perPhrase) {
  const lh = size * (isZh ? 1.5 : 1.3);
  const gap = isZh ? 0 : measure(" ", size);
  const center = (g.top + g.bottom) / 2;
  const maxLines = Math.floor((g.bottom - g.top) / lh);
  for (let k = 1; k <= maxLines; k++) {
    const top = Math.max(g.top, Math.min(center - (k * lh) / 2, g.bottom - k * lh));
    const glyphTop = (i) => top + i * lh + (lh - size) / 2;
    const widthAt = (i) => chord(g, glyphTop(i), glyphTop(i) + size);
    const lines = fillLines(phrases, perPhrase, size, gap, widthAt, k);
    // Reject a lonely word/char stranded on the narrow top of the moon.
    if (lines && lines.length > 1 && lines[0].units.length < (isZh ? 3 : 2)) continue;
    if (lines) return { lines, size, lh, gap, top };
  }
  return null;
}

// Last resort for very long text on tiny screens: keep the minimum size and let
// lines continue past the moon, using the full scene width there.
function overflowLayout(g, phrases, isZh, size) {
  const lh = size * (isZh ? 1.5 : 1.3);
  const gap = isZh ? 0 : measure(" ", size);
  const top = g.top;
  const widthAt = (i) => {
    const y = top + i * lh + (lh - size) / 2;
    const c = chord(g, y, y + size);
    return c >= size * 4 ? c : g.width * 0.92;
  };
  const lines = fillLines(phrases, false, size, gap, widthAt, 999);
  return { lines, size, lh, gap, top };
}

const MIN_SIZE = 15;

function largestFit(g, phrases, isZh, perPhrase) {
  const maxSize = Math.round(g.moon.r * (isZh ? 0.2 : 0.16));
  for (let size = maxSize; size >= MIN_SIZE; size--) {
    const fit = tryFit(g, phrases, isZh, size, perPhrase);
    if (fit) return fit;
  }
  return null;
}

function layout(text, isZh) {
  const g = sceneGeometry();
  const phrases = tokenize(text, isZh);
  let fit = null;
  if (isZh) {
    // Clause-per-line reads like a poem; only wrap inside a clause when that buys real size.
    const strict = largestFit(g, phrases, isZh, "strict");
    const soft = largestFit(g, phrases, isZh, "soft");
    fit = strict && (!soft || strict.size >= soft.size * 0.8) ? strict : soft;
  }
  fit ??= largestFit(g, phrases, isZh, false);
  return { g, fit: fit ?? overflowLayout(g, phrases, isZh, MIN_SIZE) };
}

// A glyph box counts as "on the moon" only if all four corners are on it.
function onMoon(g, x0, y0, x1, y1) {
  const r = g.moon.r * 0.97;
  return [[x0, y0], [x1, y0], [x0, y1], [x1, y1]].every(([x, y]) =>
    y < g.moon.clipY && (x - g.moon.cx) ** 2 + (y - g.moon.cy) ** 2 < r * r);
}

function renderRiddle() {
  if (!data) return;
  const riddle = data.riddles[current];
  const isZh = lang === "zh";
  const text = isZh ? riddle.zh : riddle.en;
  const { g, fit } = layout(text, isZh);
  const { lines, size, lh, gap, top } = fit;

  const frag = document.createDocumentFragment();
  lines.forEach((line, i) => {
    const y = top + i * lh;
    const glyphTop = y + (lh - size) / 2;
    let x = g.moon.cx - line.width / 2;
    for (const unit of line.units) {
      const span = document.createElement("span");
      span.className = "unit";
      span.style.cssText = `left:${x}px;top:${y}px;font-size:${size}px;line-height:${lh}px`;
      let cx = x;
      for (const ch of unit) {
        const w = measure(ch, size);
        const c = document.createElement("span");
        c.textContent = ch;
        c.className = onMoon(g, cx, glyphTop, cx + w, glyphTop + size) ? "ink" : "glow";
        span.append(c);
        cx += w;
      }
      frag.append(span);
      x += measure(unit, size) + gap;
    }
  });
  els.riddle.replaceChildren(frag);
  // Overflowing text may run past the artwork; stretch the scene so it never hides under the buttons.
  const textBottom = top + lines.length * lh + 8;
  els.scene.style.height = textBottom > g.width * (880 / CROP_W) ? `${textBottom}px` : "";
  els.riddleText.textContent = text;
  els.counter.textContent = t("counter", current + 1, data.riddles.length);
}

/* ------------------------------------------------------------------ */
/* UI state                                                            */
/* ------------------------------------------------------------------ */

function applyLanguage() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  document.title = lang === "zh" ? "中秋猜灯谜 · Mid-Autumn Riddles" : "Mid-Autumn Riddles · 中秋猜灯谜";
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });
  document.querySelectorAll(".lang-toggle button").forEach((b) => {
    b.setAttribute("aria-pressed", String(b.dataset.lang === lang));
  });
  if (state?.wonAt) els.congratsTime.textContent = t("congratsTime", formatTime(state.wonAt));
  showMessage(messageKey);
  renderRiddle();
}

function showMessage(key, isError = false) {
  messageKey = key;
  els.message.textContent = key ? t(...key) : "";
  if (key) els.message.classList.toggle("is-error", isError);
}

function renderAttempts() {
  const left = Math.max(0, MAX_ATTEMPTS - state.attempts);
  els.attemptIcons.replaceChildren(
    ...Array.from({ length: MAX_ATTEMPTS }, (_, i) => {
      const s = document.createElement("span");
      s.textContent = "🏮";
      if (i >= left) s.className = "used";
      return s;
    }),
  );
  const locked = state.won || left === 0;
  els.input.disabled = locked;
  els.submitBtn.disabled = locked;
  els.wonBtn.hidden = !state.won;
  if (!state.won && left === 0) showMessage(["out"], true);
}

let switching = false;

function nextRiddle() {
  if (!data || switching) return;
  const n = data.riddles.length;
  let next = Math.floor(Math.random() * n);
  if (n > 1 && next === current) next = (next + 1 + Math.floor(Math.random() * (n - 1))) % n;
  els.input.value = "";
  if (!state.won && state.attempts < MAX_ATTEMPTS) showMessage(null);
  // Guesses are checked against `current`, so only switch it once the new riddle is shown.
  switching = true;
  els.riddle.classList.add("is-switching");
  setTimeout(() => {
    current = next;
    renderRiddle();
    els.riddle.classList.remove("is-switching");
    switching = false;
  }, 260);
}

async function isCorrect(guess) {
  const riddle = data.riddles[current];
  const answers = new Set(riddle.answers);
  for (const candidate of guessCandidates(guess)) {
    if (answers.has(await sha256Hex(hashKey(data.salt, riddle.id, candidate)))) return true;
  }
  return false;
}

async function onSubmit(event) {
  event.preventDefault();
  if (!data || switching || state.won || state.attempts >= MAX_ATTEMPTS) return;
  const guess = els.input.value.trim();
  if (!guessCandidates(guess).length) {
    showMessage(["empty"], true);
    shake();
    return;
  }
  els.submitBtn.disabled = true;
  const correct = await isCorrect(guess);
  state.attempts += 1;
  if (correct) {
    state.won = true;
    state.wonAt = new Date().toISOString();
  }
  await saveState(state);

  if (correct) {
    els.input.value = "";
    showMessage(null);
    renderAttempts();
    openCongrats();
  } else {
    const left = MAX_ATTEMPTS - state.attempts;
    showMessage(left > 0 ? ["wrong", left] : ["out"], true);
    shake();
    renderAttempts();
    if (left > 0) els.submitBtn.disabled = false;
    els.input.select();
  }
}

function shake() {
  els.form.classList.remove("shake");
  void els.form.offsetWidth;
  els.form.classList.add("shake");
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(lang === "zh" ? "zh-CN" : "en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function openCongrats() {
  els.congratsTime.textContent = t("congratsTime", formatTime(state.wonAt));
  const pieces = [];
  for (let i = 0; i < 36; i++) {
    const p = document.createElement("span");
    const lantern = i % 6 === 0;
    p.className = lantern ? "petal lantern" : "petal";
    if (lantern) p.textContent = "🏮";
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDuration = `${(lantern ? 9 : 5) + Math.random() * 5}s`;
    p.style.animationDelay = `${-Math.random() * 8}s`;
    p.style.setProperty("--drift", `${(Math.random() - 0.5) * 120}px`);
    pieces.push(p);
  }
  els.petals.replaceChildren(...pieces);
  els.congrats.hidden = false;
  els.closeCongrats.focus();
}

function closeCongrats() {
  els.congrats.hidden = true;
  els.petals.replaceChildren();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  const savedLang = localStorage.getItem("mid-autumn-lang");
  if (savedLang === "en" || savedLang === "zh") lang = savedLang;

  state = await loadState();

  document.querySelectorAll(".lang-toggle button").forEach((b) =>
    b.addEventListener("click", () => {
      if (b.dataset.lang === lang) return;
      lang = b.dataset.lang;
      try { localStorage.setItem("mid-autumn-lang", lang); } catch { /* ignore */ }
      applyLanguage();
    }));
  els.randomBtn.addEventListener("click", nextRiddle);
  els.form.addEventListener("submit", onSubmit);
  els.wonBtn.addEventListener("click", openCongrats);
  els.closeCongrats.addEventListener("click", closeCongrats);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.congrats.hidden) closeCongrats();
  });

  let raf = 0;
  const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderRiddle); };
  const refont = () => { measureCache = new Map(); relayout(); };
  new ResizeObserver(relayout).observe(els.scene);
  document.fonts?.addEventListener?.("loadingdone", refont);

  try {
    const res = await fetch("data/riddles.json", { cache: "no-cache" });
    data = await res.json();
    current = Math.floor(Math.random() * data.riddles.length);
  } catch {
    showMessage(["loadError"], true);
  }

  applyLanguage();
  renderAttempts();

  // Canvas measuring needs the web font; re-layout once the glyphs we need are in.
  if (data && document.fonts?.load) {
    const all = data.riddles.map((r) => r.zh + r.en).join("");
    document.fonts.load(`700 32px "LXGW WenKai"`, all).then(refont, () => {});
  }

  if (state.won) openCongrats();
}

init();
