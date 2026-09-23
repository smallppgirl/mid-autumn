#!/usr/bin/env node
// Builds site/data/riddles.json from the riddle Markdown table.
// Answers are never written in plain text: only salted SHA-256 hashes are published.
//
// Usage: node tools/build-riddles.mjs [path/to/riddles.md] [path/to/aliases.json]
// The Markdown source and aliases file are git-ignored because they contain the answers.

import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as OpenCC from "opencc-js";
import { TYPO_MIN_LENGTH, deletions, hasCJK, hashKey, normalize } from "../site/js/normalize.js";
import { assignCodes } from "./codes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = resolve(process.argv[2] ?? `${root}/中秋灯谜-新-中英对照.md`);
const aliasPath = resolve(process.argv[3] ?? `${root}/private/aliases.json`);
const outPath = `${root}/site/data/riddles.json`;

// Optional extra accepted answers, keyed by the Chinese answer cell: { "冰箱": ["fridge"] }
const aliases = existsSync(aliasPath) ? JSON.parse(readFileSync(aliasPath, "utf8")) : {};

// Traditional-Chinese spellings (Taiwan and Hong Kong) of every Chinese answer.
const toTraditional = [
  OpenCC.Converter({ from: "cn", to: "tw" }),
  OpenCC.Converter({ from: "cn", to: "hk" }),
];

// "文具盒（笔盒）" / "灯／电器" / "解 (jiě)" / "Lamp or light" -> separate answers.
const splitAnswers = (s) =>
  s.split(/\s*(?:[／/、,，;；()（）]|\bor\b)\s*/i).map((x) => x.trim()).filter(Boolean);

// Editorial notes such as 〔旧低清版〕 are for the source file, not for players.
const cleanText = (s) => s.replace(/\s*〔[^〕]*〕\s*/g, " ").replace(/\s+/g, " ").trim();

const rows = readFileSync(mdPath, "utf8")
  .split("\n")
  .filter((line) => line.trim().startsWith("|"))
  .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
  .filter((cells) => cells.length >= 4 && !/^[-:\s]+$/.test(cells[0]) && cells[0] !== "中文谜面");

if (!rows.length) throw new Error(`No riddle rows found in ${mdPath}`);

const salt = randomBytes(12).toString("hex");
const sha = (s) => createHash("sha256").update(s).digest("hex");

const idOf = (zh) => sha(zh).slice(0, 10);
const { map: codes, added } = assignCodes(rows.map(([zhRaw]) => idOf(cleanText(zhRaw))));

const seenIds = new Set();
const riddles = rows.map(([zhRaw, zhAnswer, enRaw, enAnswer]) => {
  const zh = cleanText(zhRaw);
  const en = cleanText(enRaw);
  // Stable id from the riddle text, so editing or reordering the file keeps players' progress.
  const id = idOf(zh);
  const code = codes[id];
  if (seenIds.has(id)) throw new Error(`Duplicate riddle: ${zh}`);
  seenIds.add(id);

  const raw = [...splitAnswers(zhAnswer), ...splitAnswers(enAnswer), ...(aliases[zhAnswer] ?? [])];
  const withTraditional = raw.flatMap((a) => (hasCJK(a) ? [a, ...toTraditional.map((c) => c(a))] : [a]));
  const accepted = new Set(withTraditional.map((a) => normalize(a)).filter(Boolean));

  // One-letter-missing variants of long Latin answers, for typo tolerance.
  const near = new Set();
  for (const a of accepted) {
    if (/^[a-z]+$/.test(a) && a.length >= TYPO_MIN_LENGTH) {
      for (const d of deletions(a)) if (!accepted.has(d)) near.add(d);
    }
  }

  const hash = (a) => sha(hashKey(salt, id, a));
  return {
    id,
    code,
    zh,
    en,
    answers: [...accepted].map(hash).sort(),
    near: [...near].map(hash).sort(),
  };
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ salt, riddles }) + "\n");
console.log(`Wrote ${riddles.length} riddles to ${outPath}${added ? ` (${added} new code${added > 1 ? "s" : ""} assigned)` : ""}`);
