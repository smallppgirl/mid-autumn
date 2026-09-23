# 中秋猜灯谜 · Mid-Autumn Lantern Riddles

A mobile-first, static web app for Mid-Autumn lantern riddles, hosted on GitHub Pages.

- A random riddle is written on the moon. The text is sized and wrapped to fit inside the moon's circle; any characters that spill off the moon switch to a light color so they stay readable against the night sky.
- A **中 / EN** toggle (top right) switches the same riddle between Chinese and English.
- Guesses are accepted in Chinese or English. A correct guess opens a congratulation page.
- **5 guesses per turn**: after 5 misses guessing locks and the 换一题 button pulses; tapping it
  shows another riddle with 5 fresh guesses. Unsolved riddles can come back later (recently shown
  ones are skipped); solved riddles never do.
- The win counter stops at **10** ("已猜中 N / 10", win button "你已猜中三个灯谜"), but play continues:
  solving more is allowed, the counter just stays at 10 / 10. Everything only locks once every riddle
  is solved.
- The riddle number is not shown.
- Answers are never displayed.

## How answers stay hidden

The riddle source (`中秋灯谜-新-中英对照.md`) contains the answers, so it is **git-ignored** and never published.
`tools/build-riddles.mjs` turns it into `site/data/riddles.json`, which holds the riddle text and only
**salted SHA-256 hashes** of the accepted answers. The browser hashes each guess and compares hashes.

Optional extra accepted answers (synonyms such as `fridge`, `电冰箱`) live in `private/aliases.json`
(also git-ignored), keyed by the Chinese answer:

```json
{ "冰箱": ["电冰箱", "fridge"] }
```

To update the riddles:

```sh
npm install                # once: opencc-js (Traditional Chinese variants) + subset-font
npm run build              # riddles.json, then the font subset for the new characters
git add site/data/riddles.json site/assets/fonts && git commit -m "Update riddles" && git push
```

`npm run build` reads `中秋灯谜-新-中英对照.md` and `private/aliases.json`. The font step needs
`private/fonts/LXGWWenKai-Medium.ttf` (~25 MB, git-ignored), downloaded from
<https://github.com/lxgw/LxgwWenKai/releases>. Skip it with `npm run build:riddles` if the new
riddles introduce no new characters.

Riddle ids are derived from the Chinese riddle text, so reordering the file keeps players' progress;
editing a riddle's wording makes it a new riddle.

## How a guess is judged

A guess and every accepted answer are normalized the same way, then compared by hash:

- Full-width/half-width, upper/lower case, spaces and punctuation are ignored; pinyin tone marks
  are dropped (`jiě` = `jie`); English articles and simple plurals are ignored (`the Sun`, `fingers`).
- Accepted answers are the Chinese and English answer cells (alternatives split on `／`, `（）`, `/`, `or`),
  the extra answers in `private/aliases.json`, and Traditional Chinese spellings of all of them.
- Chatty guesses work: `我猜是镜子吧`, `是盐`, `I think it's a mirror`.
- Chinese guesses may carry up to two extra characters (`电冰箱`, `小猴子`), but never match a
  shorter piece than two characters, so `大小` is not accepted for `小` and `雪人` not for `雪`.
- English answers of 7+ letters tolerate one missing or one extra letter (`elevatr`, `umbrellla`).
- Not tolerated: wrong characters/homophones in Chinese, or synonyms missing from the aliases file.

`private/test-answers.mjs` checks all of this, including that no riddle accepts another riddle's answer.

## Answer key for staff

Each riddle shows a two-digit hex code (01..FE, random, not in riddle order) in small dim text at the
bottom right of the moon. Staff read that code and look the answer up at a separate page:

```
https://smallppgirl.github.io/mid-autumn/<secret path>/
```

The path is in `private/admin-path.txt` (git-ignored, but the folder name is still visible in this
public repo — the folder name is not the protection). The protection is encryption: `answers.json`
holds the answers encrypted with AES-256-GCM under a key derived from the password with PBKDF2-SHA256
(600,000 iterations). Without the password the file is random bytes; the page decrypts it in the
browser and keeps nothing. Anyone with the password and the URL can read the answers, so treat the
password as the secret and prefer a long one.

Rebuild it after changing riddles or aliases, or to change the password:

```sh
ADMIN_PASSWORD='...' npm run build:admin
```

Codes live in `tools/riddle-codes.json` (committed; riddle ids and codes only, no answers) and are
never reassigned, so a printed answer sheet stays correct when riddles are edited or added.

## Fonts

The riddle text uses [LXGW WenKai](https://github.com/lxgw/LxgwWenKai) (SIL Open Font License 1.1,
see `site/assets/fonts/LICENSE.txt`), subset by `tools/build-font.mjs` to just the characters this
app can display: ~140 KB self-hosted instead of ~1.5 MB from a public CDN, and no third-party
dependency at run time (which also helps on mainland Chinese networks). Anything outside the
subset — including what players type — falls back to the system font.

## Limits of a GitHub-only app

GitHub Pages only serves static files; there is no server or database. So:

- **Progress is per browser, not per person.** Solved riddles are stored on the phone in localStorage,
  a cookie and IndexedDB (clearing only one of them does not reset it). A private/incognito window,
  another browser, or clearing all site data starts over. Per-IP limits need a backend
  (for example a Cloudflare Worker or Supabase), which GitHub Pages cannot provide.
- **Hashing hides the answers from casual viewing**, but anyone determined could still hash likely
  words to test them offline. That is fine for a festival game but not for a prize with real value.

## Run locally

```sh
cd site && python3 -m http.server 8000
# open http://localhost:8000
```
