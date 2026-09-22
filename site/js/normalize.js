// Shared by the browser app and tools/build-riddles.mjs so answer hashes match.

const CJK = /[㐀-鿿豈-﫿]/;

export function hasCJK(s) {
  return CJK.test(s);
}

// Typo tolerance (one missing or extra letter) only for long Latin answers, where a
// near miss is almost always a typo rather than a different word ("monkey"/"money").
export const TYPO_MIN_LENGTH = 7;

// Chatty wrappers around a guess: "我猜是镜子吧", "I think it's a mirror".
const EN_LEAD = /^(?:(?:i\s+think|i\s+guess|maybe|perhaps|the\s+answer\s+is|answer\s*:?|it\s+is|it's|its|is\s+it)\s+)+/;
const ZH_LEAD = /^(?:我猜是|我猜|我觉得是|我觉得|应该是|谜底是|答案是|谜底|答案|就是|是)/;
const ZH_TAIL = /(?:吧|呢|啊|呀|嘛|吗|了|哦|喔)+$/;

// Repeatedly strips leading (and optionally trailing) Chinese filler, never to nothing.
function stripZhFiller(s, tail) {
  for (let prev = ""; prev !== s; ) {
    prev = s;
    let t = s.replace(ZH_LEAD, "");
    if (tail) t = t.replace(ZH_TAIL, "");
    if (t) s = t;
  }
  return s;
}

// Canonical form of an answer or a guess:
// full-width -> half-width, lower case, tone marks removed (jiě -> jie), English
// articles dropped, everything that is not a letter or digit stripped, simple English
// plurals singularised. With `guess`, chatty filler words are dropped too — never for
// answers, where they are real characters (知了 must not become 知).
export function normalize(input, { guess = false } = {}) {
  let s = String(input ?? "").normalize("NFKC").toLowerCase().trim();
  s = s.normalize("NFD").replace(/\p{M}+/gu, "").normalize("NFC");
  if (guess) s = s.replace(EN_LEAD, "");
  s = s.replace(/^(?:the|a|an)\s+/, "");
  s = s.replace(/[^\p{L}\p{N}]+/gu, "");
  if (guess && hasCJK(s)) s = stripZhFiller(s, true);
  if (/^[a-z]+$/.test(s) && s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) {
    s = s.slice(0, -1);
  }
  return s;
}

// All strings with one letter removed.
export function deletions(s) {
  const out = new Set();
  for (let i = 0; i < s.length; i++) out.add(s.slice(0, i) + s.slice(i + 1));
  return [...out];
}

// What to compare for a guess.
//  exact: checked against the riddle's exact answer hashes.
//         Chinese guesses may carry up to two extra characters ("电冰箱", "小猴子"), but a
//         substring is never shorter than two characters, so "大小" can't match 小 and
//         "雪人" can't match 雪 — one-character answers must be typed alone.
//  typo:  for long Latin guesses, the guess itself is also checked against the answers'
//         one-letter-missing variants, and the guess's own deletions against the exact
//         answers — together: one letter missing or one extra letter.
export function guessCandidates(input) {
  const plain = normalize(input);
  const full = normalize(input, { guess: true });
  if (!full) return { exact: [], typo: [] };
  // Filler stripping can eat real characters (我猜是知了吧 -> 知), so also keep the guess
  // with only the leading filler removed (知了吧) and take substrings of every form.
  const forms = new Set([plain, full, hasCJK(plain) ? stripZhFiller(plain, false) : plain]);
  const exact = new Set([...forms].filter(Boolean));
  for (const form of forms) {
    const chars = [...form];
    if (!hasCJK(form) || chars.length > 12) continue;
    for (let len = Math.max(2, chars.length - 2); len < chars.length; len++) {
      for (let i = 0; i + len <= chars.length; i++) exact.add(chars.slice(i, i + len).join(""));
    }
  }
  const typo = new Set();
  if (/^[a-z]+$/.test(full) && full.length >= TYPO_MIN_LENGTH - 1) {
    typo.add(full);
    if (full.length >= TYPO_MIN_LENGTH + 1) for (const d of deletions(full)) exact.add(d);
  }
  return { exact: [...exact], typo: [...typo] };
}

export function hashKey(salt, id, normalized) {
  return `${salt}:${id}:${normalized}`;
}
