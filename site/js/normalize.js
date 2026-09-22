// Shared by the browser app and tools/build-riddles.mjs so answer hashes match.

const CJK = /[㐀-鿿豈-﫿]/;

export function hasCJK(s) {
  return CJK.test(s);
}

// Canonical form of an answer or a guess:
// full-width -> half-width, lower case, drop leading English articles,
// strip everything that is not a letter or digit, singularise simple English plurals.
export function normalize(input) {
  let s = String(input ?? "").normalize("NFKC").toLowerCase().trim();
  s = s.replace(/^(the|a|an)\s+/, "");
  s = s.replace(/[^\p{L}\p{N}]+/gu, "");
  if (/^[a-z]+$/.test(s) && s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) {
    s = s.slice(0, -1);
  }
  return s;
}

// Every string worth hashing for a guess. Chinese guesses may carry a little
// extra wording ("是镜子", "电冰箱"), so near-full-length substrings are tried too.
export function guessCandidates(input) {
  const full = normalize(input);
  const out = new Set();
  if (!full) return [];
  out.add(full);
  if (hasCJK(full)) {
    const chars = [...full];
    const n = chars.length;
    if (n <= 12) {
      for (let len = Math.max(1, n - 3); len < n; len++) {
        for (let i = 0; i + len <= n; i++) out.add(chars.slice(i, i + len).join(""));
      }
    }
  }
  return [...out];
}

export function hashKey(salt, id, normalized) {
  return `${salt}:${id}:${normalized}`;
}
