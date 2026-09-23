// Two-digit hex code per riddle (01..FE), shown small in the app so staff can look an
// answer up. Codes are random, not sequential, so they give nothing away about order.
//
// Assignments are persisted in tools/riddle-codes.json and never reassigned: a printed
// answer sheet stays correct when riddles are edited, added or removed. The file holds
// only riddle ids (hashes of the riddle text) and codes — no answers.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomInt } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const mapPath = resolve(here, "riddle-codes.json");

const MIN = 0x01;
const MAX = 0xfe;

export function assignCodes(ids) {
  const map = existsSync(mapPath) ? JSON.parse(readFileSync(mapPath, "utf8")) : {};
  const used = new Set(Object.values(map));
  let added = 0;

  for (const id of ids) {
    if (map[id]) continue;
    if (used.size > MAX - MIN) throw new Error(`No codes left (max ${MAX - MIN + 1} riddles)`);
    let code;
    do {
      code = randomInt(MIN, MAX + 1).toString(16).toUpperCase().padStart(2, "0");
    } while (used.has(code));
    map[id] = code;
    used.add(code);
    added++;
  }

  if (added) {
    const sorted = Object.fromEntries(Object.entries(map).sort(([, a], [, b]) => a.localeCompare(b)));
    writeFileSync(mapPath, JSON.stringify(sorted, null, 2) + "\n");
  }
  return { map, added };
}
