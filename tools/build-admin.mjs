#!/usr/bin/env node
// Builds the password-protected answer key for staff.
//
// GitHub Pages is static and the repo is public, so the folder name is not a secret: the
// protection is the encryption. Answers are encrypted with AES-256-GCM under a key derived
// from the password (PBKDF2-SHA256), and only the ciphertext is published. Without the
// password the file is unreadable, even to someone who finds the URL.
//
// Usage: ADMIN_PASSWORD='...' node tools/build-admin.mjs [riddles.md] [aliases.json]

import { createCipheriv, createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as OpenCC from "opencc-js";
import { assignCodes } from "./codes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const mdPath = resolve(process.argv[2] ?? `${root}/中秋灯谜-新-中英对照.md`);
const aliasPath = resolve(process.argv[3] ?? `${root}/private/aliases.json`);
const secret = readFileSync(`${root}/private/admin-path.txt`, "utf8").trim();
const outDir = `${root}/site/${secret}`;

const password = process.env.ADMIN_PASSWORD;
if (!password) throw new Error("Set ADMIN_PASSWORD");
if (!/^[A-Za-z0-9_-]{4,64}$/.test(secret)) throw new Error(`Bad admin path: ${secret}`);

const ITERATIONS = 600_000;

const aliases = existsSync(aliasPath) ? JSON.parse(readFileSync(aliasPath, "utf8")) : {};
const cleanText = (s) => s.replace(/\s*〔[^〕]*〕\s*/g, " ").replace(/\s+/g, " ").trim();
const splitAnswers = (s) =>
  s.split(/\s*(?:[／/、,，;；()（）]|\bor\b)\s*/i).map((x) => x.trim()).filter(Boolean);
const isCJK = (s) => /[㐀-鿿]/.test(s);
const toTW = OpenCC.Converter({ from: "cn", to: "tw" });

const rows = readFileSync(mdPath, "utf8")
  .split("\n")
  .filter((l) => l.trim().startsWith("|"))
  .map((l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()))
  .filter((c) => c.length >= 4 && !/^[-:\s]+$/.test(c[0]) && c[0] !== "中文谜面");

const idOf = (zh) => createHash("sha256").update(zh).digest("hex").slice(0, 10);
const { map: codes } = assignCodes(rows.map(([zhRaw]) => idOf(cleanText(zhRaw))));

const riddles = rows.map(([zhRaw, zhAnswer, enRaw, enAnswer]) => {
  const extra = aliases[zhAnswer] ?? [];
  const zhMain = splitAnswers(zhAnswer);
  const enMain = splitAnswers(enAnswer);
  const seen = new Set([...zhMain, ...enMain].map((a) => a.toLowerCase()));
  const keep = (a) => !seen.has(a.toLowerCase()) && seen.add(a.toLowerCase());
  const zhAlso = extra.filter(isCJK).filter(keep);
  const enAlso = extra.filter((a) => !isCJK(a)).filter(keep);
  const traditional = [...zhMain, ...zhAlso].map(toTW).filter(keep);
  const zh = cleanText(zhRaw);
  return {
    code: codes[idOf(zh)],
    zh,
    en: cleanText(enRaw),
    zhAnswer: zhMain,
    enAnswer: enMain,
    zhAlso,
    enAlso,
    traditional: [...new Set(traditional)],
  };
});

const plaintext = Buffer.from(JSON.stringify({ riddles }), "utf8");
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, ITERATIONS, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
const payload = Buffer.concat([body, cipher.getAuthTag()]); // WebCrypto expects the tag appended

mkdirSync(outDir, { recursive: true });
writeFileSync(`${outDir}/answers.json`, JSON.stringify({
  v: 1,
  kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt: salt.toString("base64") },
  iv: iv.toString("base64"),
  data: payload.toString("base64"),
}) + "\n");

const check = createHash("sha256").update(password).digest("hex").slice(0, 8);
console.log(`Encrypted ${riddles.length} answers -> ${outDir}/answers.json`);
console.log(`Password fingerprint (not the password): ${check}`);
