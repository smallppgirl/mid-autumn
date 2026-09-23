import { guessCandidates, hashKey } from "./normalize.js";
import { sha256Hex } from "./sha256.js";
import { loadState, saveState } from "./storage.js";

const GUESSES_PER_TURN = 5; // per riddle, fresh each time a riddle is shown
const MAX_WINS = 10;        // the counter stops here; playing on is still allowed
const RECENT = 10;          // don't repeat the last few riddles shown, when possible

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
    winsLabel: "已猜中",
    empty: "请先输入答案哦",
    wrong: (n) => `没猜中，再想想～ 还剩 ${n} 次机会`,
    turnOver: `${GUESSES_PER_TURN} 次都没猜中～ 点「换一题」试试别的灯谜吧 🏮`,
    maxed: (n) => `太厉害了！你已猜中${zhNum(n)}个灯谜，还可以继续玩 🌕`,
    allDone: "所有灯谜都猜完啦！中秋快乐 🌕",
    wonBanner: (n) => `🏆 你已猜中${zhNum(n)}个灯谜`,
    congratsCount: (n) => `已猜中${zhNum(n)}个灯谜`,
    footer: "花好月圆 · 中秋快乐",
    congratsTitle: "恭喜你，猜中啦！",
    congratsSub: "花好月圆，阖家团圆",
    congratsGreet: "祝你中秋快乐！",
    congratsTime: (t) => `猜中时间：${t}`,
    close: "好的",
    retry: "再试一次",
    failedTitle: "很遗憾，没猜中～",
    failedLeft: (n) => `本题还剩 ${n} 次机会`,
    failedHint: "换个思路再想想，答案也许就在眼前",
    failedOut: `${GUESSES_PER_TURN} 次机会都用完了`,
    failedOutHint: "换一题，试试别的灯谜吧 🏮",
    loadError: "灯谜加载失败，请刷新重试",
  },
  en: {
    title: "Mid-Autumn Riddles",
    random: "Another riddle",
    answerLabel: "Your answer",
    placeholder: "Type your answer…",
    submit: "Submit",
    attemptsLabel: "Chances",
    winsLabel: "Solved",
    empty: "Please type an answer first",
    wrong: (n) => `Not quite — ${n} ${n === 1 ? "chance" : "chances"} left`,
    turnOver: `${GUESSES_PER_TURN} misses — tap “Another riddle” 🏮`,
    maxed: (n) => `Amazing — ${n} riddles solved! Keep playing 🌕`,
    allDone: "You've solved every riddle! Happy Mid-Autumn 🌕",
    wonBanner: (n) => `🏆 You've solved ${n} ${n === 1 ? "riddle" : "riddles"}`,
    congratsCount: (n) => `Riddles solved: ${n} of ${MAX_WINS}`,
    footer: "Happy Mid-Autumn Festival",
    congratsTitle: "Congratulations!",
    congratsSub: "You solved the lantern riddle",
    congratsGreet: "Happy Mid-Autumn Festival!",
    congratsTime: (t) => `Solved at ${t}`,
    close: "OK",
    retry: "Try again",
    failedTitle: "So close — not quite!",
    failedLeft: (n) => `${n} ${n === 1 ? "chance" : "chances"} left for this riddle`,
    failedHint: "Try another angle — the answer may be right in front of you",
    failedOut: `All ${GUESSES_PER_TURN} chances used`,
    failedOutHint: "Tap “Another riddle” to try a different one 🏮",
    loadError: "Could not load riddles. Please refresh.",
  },
};

const zhNum = (n) => "零一两三四五六七八九十"[n] ?? String(n);

const $ = (id) => document.getElementById(id);
const els = {
  scene: $("scene"),
  riddle: $("riddle"),
  riddleText: $("riddleText"),
  riddleCode: $("riddleCode"),
  langToggle: $("langToggle"),
  randomBtn: $("randomBtn"),
  form: $("answerForm"),
  input: $("answerInput"),
  submitBtn: $("submitBtn"),
  attemptIcons: $("attemptIcons"),
  winCount: $("winCount"),
  message: $("message"),
  wonBtn: $("wonBtn"),
  congrats: $("congrats"),
  congratsTime: $("congratsTime"),
  congratsCount: $("congratsCount"),
  closeCongrats: $("closeCongrats"),
  petals: $("petals"),
  failed: $("failed"),
  failedPetals: $("failedPetals"),
  failedSub: $("failedSub"),
  failedHint: $("failedHint"),
  failedNext: $("failedNext"),
  failedRetry: $("failedRetry"),
  failedOk: $("failedOk"),
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

// Ink bounds of a glyph as fractions of its advance, found by drawing it once and
// scanning pixels. Chinese punctuation is full-width with ink in one half only
// ("。" is blank on the right), so centring by advance alone looks shifted.
const inkCanvas = document.createElement("canvas");
const inkCtx = inkCanvas.getContext("2d", { willReadFrequently: true });
let inkCache = new Map();

function inkRatio(ch) {
  let hit = inkCache.get(ch);
  if (hit) return hit;
  const S = 100, pad = 30, w = S * 2 + pad * 2, h = S * 2;
  inkCanvas.width = w;
  inkCanvas.height = h;
  inkCtx.clearRect(0, 0, w, h);
  inkCtx.font = `700 ${S}px ${FONT_STACK}`;
  inkCtx.textBaseline = "alphabetic";
  inkCtx.fillStyle = "#000";
  inkCtx.fillText(ch, pad, h * 0.75);
  const { data } = inkCtx.getImageData(0, 0, w, h);
  let min = w, max = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 12) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  const advance = measure(ch, S);
  hit = max < min || !advance
    ? { l: 0, r: 1 }
    : { l: (min - pad) / advance, r: (max + 1 - pad) / advance };
  inkCache.set(ch, hit);
  return hit;
}

// Optical centring offset for a line: half the difference between the blank space
// before its first glyph and after its last one.
function opticalShift(units, size) {
  const first = [...units[0]][0];
  const lastUnit = units[units.length - 1];
  const last = [...lastUnit][lastUnit.length - 1] ?? first;
  const lead = inkRatio(first).l * measure(first, size);
  const trail = (1 - inkRatio(last).r) * measure(last, size);
  return Math.max(-size / 2, Math.min(size / 2, (trail - lead) / 2));
}

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
    let x = g.moon.cx - line.width / 2 + opticalShift(line.units, size);
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
  els.riddleCode.textContent = riddle.code ?? "";
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
  els.langToggle.setAttribute("aria-checked", String(lang === "en"));
  showMessage(message.key, message.isError);
  if (!els.failed.hidden) renderFailed();
  renderRiddle();
  if (state && data) renderStatus();
}

function showMessage(key, isError = false) {
  message = { key, isError };
  els.message.textContent = key ? t(...key) : "";
  els.message.classList.toggle("is-error", isError);
}

/* ---- game rules: 5 guesses per turn, play until 10 riddles are solved ---- */

// Guesses on the riddle on screen. Not saved: a new turn (换一题 or reload) starts fresh,
// and an unsolved riddle may come back later with fresh guesses.
let turnGuesses = 0;
const recent = []; // indexes of recently shown riddles

const idOf = (i) => data.riddles[i].id;
const solved = (i) => Boolean(state.riddles[idOf(i)]?.solved);
const wins = () => data.riddles.filter((_, i) => solved(i)).length;
const pool = () => data.riddles.map((_, i) => i).filter((i) => !solved(i));
const allSolved = () => pool().length === 0;
const turnOver = () => turnGuesses >= GUESSES_PER_TURN;
const canGuess = () => !allSolved() && !solved(current) && !turnOver();
const shownWins = () => Math.min(wins(), MAX_WINS);
const latestSolvedAt = () =>
  Object.values(state.riddles).map((r) => r.solvedAt).filter(Boolean).sort().at(-1) ?? null;

// A random unsolved riddle other than the current one, avoiding recently shown ones.
function pickRiddle() {
  const options = pool().filter((i) => i !== current);
  const fresh = options.filter((i) => !recent.includes(i));
  const from = fresh.length ? fresh : options;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
}

function showRiddle(i) {
  current = i;
  turnGuesses = 0;
  recent.push(i);
  if (recent.length > RECENT) recent.shift();
}

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
  const n = shownWins();
  icons(els.attemptIcons, GUESSES_PER_TURN, solved(current) ? 0 : GUESSES_PER_TURN - turnGuesses, "🏮");
  els.winCount.textContent = `${n} / ${MAX_WINS}`;
  const guessable = canGuess();
  els.input.disabled = !guessable;
  els.submitBtn.disabled = !guessable;
  els.randomBtn.disabled = pickRiddle() === null;
  // Draw the eye to 换一题 once this riddle's guesses are used up.
  els.randomBtn.classList.toggle("nudge", turnOver() && !allSolved());
  els.wonBtn.hidden = n === 0;
  els.wonBtn.textContent = t("wonBanner", n);
  // Past the cap the game keeps going; the note only fills an empty message line.
  if (allSolved()) showMessage(["allDone"], false);
  else if (wins() >= MAX_WINS && !message.key) showMessage(["maxed", n], false);
}

let switching = false;

function nextRiddle() {
  if (!data || switching || allSolved()) return;
  const next = pickRiddle();
  if (next === null) { renderStatus(); return; }
  els.input.value = "";
  showMessage(null);
  els.randomBtn.classList.remove("nudge");
  // Guesses are checked against `current`, so only switch it once the new riddle is shown.
  switching = true;
  els.riddle.classList.add("is-switching");
  setTimeout(() => {
    showRiddle(next);
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
  if (!data || switching || !canGuess()) return;
  const guess = els.input.value.trim();
  if (!guessCandidates(guess).exact.length) {
    showMessage(["empty"], true);
    shake();
    return;
  }
  els.submitBtn.disabled = true;
  const riddleIdx = current;
  const correct = await isCorrect(guess);
  turnGuesses += 1;
  if (correct) {
    state.riddles[idOf(riddleIdx)] = { solved: true, solvedAt: new Date().toISOString() };
    await saveState(state);
  }

  if (correct) {
    els.input.value = "";
    showMessage(null);
    renderStatus();
    openCongrats();
  } else {
    const left = GUESSES_PER_TURN - turnGuesses;
    showMessage(left > 0 ? ["wrong", left] : ["turnOver"], true);
    shake();
    renderStatus();
    if (left === 0) els.input.value = "";
    openFailed(left);
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
  els.congratsCount.textContent = t("congratsCount", shownWins());
  // Gold osmanthus petals falling, with a few lanterns rising.
  fillPetals(els.petals, 36, (i) => (i % 6 === 0
    ? { cls: "petal lantern", text: "🏮", duration: 9 }
    : { cls: "petal", duration: 5 }));
  els.congrats.hidden = false;
  els.closeCongrats.focus();
}

function fillPetals(container, count, kind) {
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const { cls, text, duration } = kind(i);
    const p = document.createElement("span");
    p.className = cls;
    if (text) p.textContent = text;
    p.style.left = `${Math.random() * 100}%`;
    p.style.animationDuration = `${duration + Math.random() * 5}s`;
    p.style.animationDelay = `${-Math.random() * 8}s`;
    p.style.setProperty("--drift", `${(Math.random() - 0.5) * 120}px`);
    pieces.push(p);
  }
  container.replaceChildren(...pieces);
}

// "遗憾" popup after a wrong guess. Never mentions the answer.
let failedLeft = 0;

function renderFailed() {
  const out = failedLeft === 0;
  els.failedSub.textContent = out ? t("failedOut") : t("failedLeft", failedLeft);
  els.failedHint.textContent = out ? t("failedOutHint") : t("failedHint");
  els.failedNext.hidden = !out;
  els.failedOk.hidden = !out;
  els.failedRetry.hidden = out;
}

function openFailed(left) {
  failedLeft = left;
  renderFailed();
  // Slow drifting leaves and a light drizzle.
  fillPetals(els.failedPetals, 22, (i) => (i % 3 === 0
    ? { cls: "petal leaf", text: "🍂", duration: 8 }
    : { cls: "petal drop", duration: 3 }));
  els.failed.hidden = false;
  (left === 0 ? els.failedNext : els.failedRetry).focus();
}

function closeFailed() {
  els.failed.hidden = true;
  els.failedPetals.replaceChildren();
}

function closeCongrats() {
  els.congrats.hidden = true;
  els.petals.replaceChildren();
  // Just solved the riddle on screen: move on to the next one.
  if (data && solved(current) && !allSolved()) nextRiddle();
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

async function init() {
  const savedLang = localStorage.getItem("mid-autumn-lang");
  if (savedLang === "en" || savedLang === "zh") lang = savedLang;

  state = await loadState();

  els.langToggle.addEventListener("click", () => {
    lang = lang === "zh" ? "en" : "zh";
    try { localStorage.setItem("mid-autumn-lang", lang); } catch { /* ignore */ }
    applyLanguage();
  });
  els.randomBtn.addEventListener("click", nextRiddle);
  els.form.addEventListener("submit", onSubmit);
  els.wonBtn.addEventListener("click", openCongrats);
  els.closeCongrats.addEventListener("click", closeCongrats);
  els.failedRetry.addEventListener("click", () => { closeFailed(); els.input.select(); });
  els.failedOk.addEventListener("click", closeFailed);
  els.failedNext.addEventListener("click", () => { closeFailed(); nextRiddle(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.congrats.hidden) closeCongrats();
    if (e.key === "Escape" && !els.failed.hidden) closeFailed();
  });

  let raf = 0;
  const relayout = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(renderRiddle); };
  const refont = () => { measureCache = new Map(); inkCache = new Map(); relayout(); };
  new ResizeObserver(relayout).observe(els.scene);
  document.fonts?.addEventListener?.("loadingdone", refont);

  try {
    const res = await fetch("data/riddles.json", { cache: "no-cache" });
    data = await res.json();
    const open = pool();
    showRiddle(open.length ? open[Math.floor(Math.random() * open.length)] : 0);
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
