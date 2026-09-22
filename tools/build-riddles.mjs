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
import { hashKey, normalize } from "../site/js/normalize.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = resolve(process.argv[2] ?? `${root}/中秋灯谜-去重版.md`);
const aliasPath = resolve(process.argv[3] ?? `${root}/private/aliases.json`);
const outPath = `${root}/site/data/riddles.json`;

// Optional extra accepted answers, keyed by the Chinese answer: { "冰箱": ["fridge"] }
const aliases = existsSync(aliasPath) ? JSON.parse(readFileSync(aliasPath, "utf8")) : {};

const splitAnswers = (s) =>
  s.split(/\s*(?:[／/、,，;；]|\bor\b)\s*/i).map((x) => x.trim()).filter(Boolean);

const rows = readFileSync(mdPath, "utf8")
  .split("\n")
  .filter((line) => line.trim().startsWith("|"))
  .map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
  .filter((cells) => cells.length >= 4 && !/^-+$/.test(cells[0]) && cells[0] !== "中文谜面");

if (!rows.length) throw new Error(`No riddle rows found in ${mdPath}`);

const salt = randomBytes(12).toString("hex");
const sha = (s) => createHash("sha256").update(s).digest("hex");

const riddles = rows.map(([zh, zhAnswer, en, enAnswer], i) => {
  const id = i + 1;
  const accepted = new Set(
    [...splitAnswers(zhAnswer), ...splitAnswers(enAnswer), ...(aliases[zhAnswer] ?? [])]
      .map(normalize)
      .filter(Boolean),
  );
  return {
    id,
    zh,
    en,
    answers: [...accepted].map((a) => sha(hashKey(salt, id, a))).sort(),
  };
});

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify({ salt, riddles }, null, 2) + "\n");
console.log(`Wrote ${riddles.length} riddles to ${outPath}`);
