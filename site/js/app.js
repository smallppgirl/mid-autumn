import { guessCandidates, hashKey } from "./normalize.js";
import { sha256Hex } from "./sha256.js";
import { loadState, saveState } from "./storage.js";

const GUESSES_PER_RIDDLE = 3;
const MAX_RIDDLES = 3; // riddles a device may start (a riddle is started by its first guess)

// Moon geometry in the source artwork (2000x1000). The scene shows a 1000-wide
// crop starting at x = 486 (see .scene in style.css).
const CROP_X = 486;
const CROP_W = 1000;
const MOON = { cx: 986, cy: 552, r: 452, clipY: 769 }; // clipY: where the stage hides the moon

// Keep in sync with --font in style.css. Not read from CSS: if this module runs before the
// stylesheet applies, the value is empty and canvas silently measures with its 10px default.
const FONT_STACK = '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", "Noto Serif SC", "Songti SC", "SimSun", serif';

const I18N = {
  zh: {
    title: "中秋猜灯谜",
    random: "换一题",
    answerLabel: "你的答案",
    placeholder: "输入谜底…",
    submit: "提交",
    attemptsLabel: "本题机会",
    slotsLabel: "剩余灯谜",
    empty: "请先输入答案哦",
    wrong: (n) => `没猜中，再想想～ 本题还剩 ${n} 次机会`,
    usedUp: "这题的机会用完了，换一题试试吧",
    gameOver: (n) => n
      ? `三个灯谜都完成啦，共猜中${zhNum(n)}个！中秋快乐 🌕`
      : "三个灯谜都完成啦，感谢参与！中秋快乐 🌕",
    wonBanner: (n) => `🏆 你已猜中${zhNum(n)}个灯谜`,
    congratsCount: (n) => `已猜中${zhNum(n)}个灯谜`,
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
    random: "Another riddle",
    answerLabel: "Your answer",
    placeholder: "Type your answer…",
    submit: "Submit",
    attemptsLabel: "Chances for this riddle",
    slotsLabel: "Riddles left",
    empty: "Please type an answer first",
    wrong: (n) => `Not quite — ${n} ${n === 1 ? "chance" : "chances"} left for this riddle`,
    usedUp: "No chances left for this riddle. Try another one!",
    gameOver: (n) => `All three riddles done — you solved ${n}. Happy Mid-Autumn! 🌕`,
    wonBanner: (n) => `🏆 You've solved ${n} ${n === 1 ? "riddle" : "riddles"}`,
    congratsCount: (n) => `Riddles solved: ${n} of ${MAX_RIDDLES}`,
    footer: "Happy Mid-Autumn Festival",
    congratsTitle: "Congratulations!",
    congratsSub: "You solved the lantern riddle",
    congratsGreet: "Happy Mid-Autumn Festival!",
    congratsTime: (t) => `Solved at ${t}`,
    close: "OK",
    loadError: "Could not load riddles. Please refresh.",
  },
};

const zhNum = (n) => "零一两三四五六七八九"[n] ?? String(n);

const $ = (id) => document.getElementById(id);
const els = {
  scene: $("scene"),
  riddle: $("riddle"),
  riddleText: $("riddleText"),
  randomBtn: $("randomBtn"),
  form: $("answerForm"),
  input: $("answerInput"),
  submitBtn: $("submitBtn"),
  attemptIcons: $("attemptIcons"),
  slotIcons: $("slotIcons"),
  message: $("message"),
  wonBtn: $("wonBtn"),
  congrats: $("congrats"),
  congratsTime: $("congratsTime"),
  congratsCount: $("congratsCount"),
  closeCongrats: $("closeCongrats"),
  petals: $("petals"),
};

let data = null;
let current = 0;
let lang = "zh";
let state = null;
let message = { key: null, isError: false }; // key = [name, ...args]; re-rendered on language switch

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
  // The category hint "（打一…）" always starts its own line.
  for (const ch of text.replace(/\s+/g, "").replace(/[（(](?=打|猜)/g, "\n$&")) {
    if (ch === "\n") { if (phrase.length) phrases.push(phrase); phrase = []; continue; }
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
  showMessage(message.key, message.isError);
  renderRiddle();
  if (state && data) renderStatus();
}

function showMessage(key, isError = false) {
  message = { key, isError };
  els.message.textContent = key ? t(...key) : "";
  els.message.classList.toggle("is-error", isError);
}

/* ---- game rules: 3 guesses per riddle, 3 riddles per device ---- */

const idOf = (i) => data.riddles[i].id;
const rec = (i) => state.riddles[idOf(i)] ?? { attempts: 0, solved: false, solvedAt: null };
const finished = (i) => rec(i).solved || rec(i).attempts >= GUESSES_PER_RIDDLE;
const startedIdx = () => data.riddles.map((_, i) => i).filter((i) => rec(i).attempts > 0);
const wins = () => data.riddles.filter((_, i) => rec(i).solved).length;
const slotsLeft = () => Math.max(0, MAX_RIDDLES - startedIdx().length);
const canGuess = (i) => !finished(i) && (rec(i).attempts > 0 || slotsLeft() > 0);
// Riddles 换一题 may show: anything unfinished while slots remain, then only started ones.
const pool = () => data.riddles.map((_, i) => i).filter((i) =>
  !finished(i) && (slotsLeft() > 0 || rec(i).attempts > 0));
const gameOver = () => pool().length === 0;
const latestSolvedAt = () =>
  Object.values(state.riddles).map((r) => r.solvedAt).filter(Boolean).sort().at(-1) ?? null;

function icons(el, total, left, glyph) {
  el.replaceChildren(
    ...Array.from({ length: total }, (_, i) => {
      const s = document.createElement("span");
      s.textContent = glyph;
      if (i >= left) s.className = "used";
      return s;
    }),
  );
}

function renderStatus() {
  if (!data) return;
  const r = rec(current);
  icons(els.attemptIcons, GUESSES_PER_RIDDLE, r.solved ? 0 : GUESSES_PER_RIDDLE - r.attempts, "🏮");
  icons(els.slotIcons, MAX_RIDDLES, slotsLeft(), "🥮");
  const guessable = canGuess(current);
  els.input.disabled = !guessable;
  els.submitBtn.disabled = !guessable;
  els.randomBtn.disabled = !pool().some((i) => i !== current);
  const n = wins();
  els.wonBtn.hidden = n === 0;
  els.wonBtn.textContent = t("wonBanner", n);
  if (gameOver()) showMessage(["gameOver", n], false);
}

let switching = false;

function nextRiddle() {
  if (!data || switching) return;
  const options = pool().filter((i) => i !== current);
  if (!options.length) { renderStatus(); return; }
  const next = options[Math.floor(Math.random() * options.length)];
  els.input.value = "";
  showMessage(null);
  // Guesses are checked against `current`, so only switch it once the new riddle is shown.
  switching = true;
  els.riddle.classList.add("is-switching");
  setTimeout(() => {
    current = next;
    renderRiddle();
    renderStatus();
    els.riddle.classList.remove("is-switching");
    switching = false;
  }, 260);
}

async function isCorrect(guess) {
  const riddle = data.riddles[current];
  const answers = new Set(riddle.answers);
  const near = new Set(riddle.near ?? []);
  const hash = (c) => sha256Hex(hashKey(data.salt, riddle.id, c));
  const { exact, typo } = guessCandidates(guess);
  for (const c of exact) if (answers.has(await hash(c))) return true;
  for (const c of typo) if (near.has(await hash(c))) return true;
  return false;
}

async function onSubmit(event) {
  event.preventDefault();
  if (!data || switching || !canGuess(current)) return;
  const guess = els.input.value.trim();
  if (!guessCandidates(guess).exact.length) {
    showMessage(["empty"], true);
    shake();
    return;
  }
  els.submitBtn.disabled = true;
  const riddleIdx = current;
  const correct = await isCorrect(guess);
  const r = (state.riddles[idOf(riddleIdx)] ??= { attempts: 0, solved: false, solvedAt: null });
  r.attempts += 1;
  if (correct) {
    r.solved = true;
    r.solvedAt = new Date().toISOString();
  }
  await saveState(state);

  if (correct) {
    els.input.value = "";
    showMessage(null);
    renderStatus();
    openCongrats();
  } else {
    const left = GUESSES_PER_RIDDLE - r.attempts;
    showMessage(left > 0 ? ["wrong", left] : ["usedUp"], true);
    shake();
    renderStatus();
    if (left > 0) els.input.select();
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
  const at = latestSolvedAt();
  els.congratsTime.textContent = at ? t("congratsTime", formatTime(at)) : "";
  els.congratsCount.textContent = t("congratsCount", wins());
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
  // Just solved the riddle on screen: move on to the next one.
  if (data && finished(current) && !gameOver()) nextRiddle();
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
    const open = pool();
    const choices = open.length ? open : startedIdx();
    current = choices.length ? choices[Math.floor(Math.random() * choices.length)] : 0;
  } catch {
    showMessage(["loadError"], true);
  }

  applyLanguage();

  // Canvas measuring needs the web font; re-layout once the glyphs we need are in.
  if (data && document.fonts?.load) {
    const all = data.riddles.map((r) => r.zh + r.en).join("");
    document.fonts.load(`700 32px "LXGW WenKai"`, all).then(refont, () => {});
  }

}

init();
