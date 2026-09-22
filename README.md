# 中秋猜灯谜 · Mid-Autumn Lantern Riddles

A mobile-first, static web app for Mid-Autumn lantern riddles, hosted on GitHub Pages.

- A random riddle is written on the moon. The text is sized and wrapped to fit inside the moon's circle; any characters that spill off the moon switch to a light color so they stay readable against the night sky.
- A **中 / EN** toggle (top right) switches the same riddle between Chinese and English.
- Guesses are accepted in Chinese or English. A correct guess opens a congratulation page.
- Each device can play **3 riddles with 3 guesses each** (at most 9 guesses and 3 wins).
  Browsing with 换一题 is free; a riddle counts once you submit a guess on it. Finished riddles
  (solved, or 3 wrong guesses) don't come back, and once 3 riddles are started, 换一题 only cycles
  through the unfinished ones. The win button shows the total, e.g. "你已猜中两个灯谜".
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
npm install                              # once: installs opencc-js (Traditional Chinese variants)
node tools/build-riddles.mjs             # reads 中秋灯谜-新-中英对照.md and private/aliases.json
git add site/data/riddles.json && git commit -m "Update riddles" && git push
```

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

## Limits of a GitHub-only app

GitHub Pages only serves static files; there is no server or database. So:

- **The play limit is per browser, not per person.** The count is stored on the phone in localStorage,
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
