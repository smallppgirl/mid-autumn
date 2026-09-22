#!/usr/bin/env node
// Subsets LXGW WenKai to the characters this app can actually display, so phones
// download ~60 KB instead of ~1.5 MB of font from a CDN.
//
// Usage: node tools/build-font.mjs [path/to/LXGWWenKai-Medium.ttf]
// The full TTF lives in private/fonts/ (git-ignored, ~25 MB); the subset is committed.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import subsetFont from "subset-font";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = resolve(process.argv[2] ?? `${root}/private/fonts/LXGWWenKai-Medium.ttf`);
const outDir = `${root}/site/assets/fonts`;
const out = `${outDir}/lxgw-wenkai-subset.woff2`;

const read = (p) => readFileSync(`${root}/${p}`, "utf8");

// Everything the page can show: riddle text, interface strings in both languages,
// and the markup's own text.
const riddles = JSON.parse(read("site/data/riddles.json")).riddles.map((r) => r.zh + r.en).join("");
const scripts = ["site/js/app.js", "site/js/normalize.js", "site/js/storage.js"].map(read).join("");
const markup = read("site/index.html").replace(/<[^>]*>/g, " ");

// Digits, Latin, and punctuation the layout may produce even if not in the sources today.
const extras = [
  " !\"#$%&'()*+,-./0123456789:;<=>?@[\\]^_`{|}~",
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ",
  "，。！？；：、（）【】「」『』《》…—～·“”‘’　",
  "０１２３４５６７８９",
  "零一二两三四五六七八九十个题灯谜猜中已剩机会次换答案提交输入恭喜遗憾",
].join("");

const chars = [...new Set([...riddles, ...scripts, ...markup, ...extras])]
  .filter((c) => c.codePointAt(0) > 0x1f && !(c >= "\u{1f000}" && c <= "\u{1ffff}")) // emoji come from the system font
  .sort()
  .join("");

const subset = await subsetFont(readFileSync(src), chars, { targetFormat: "woff2" });
mkdirSync(outDir, { recursive: true });
writeFileSync(out, subset);
console.log(`Subset ${chars.length} characters -> ${out} (${(subset.length / 1024).toFixed(0)} KB)`);
