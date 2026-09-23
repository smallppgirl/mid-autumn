// Staff answer key. The published answers.json is encrypted; the password entered here
// derives the key (PBKDF2) and decrypts it in the browser. Nothing is stored: closing the
// tab means typing the password again.

const $ = (id) => document.getElementById(id);
const els = {
  loginForm: $("loginForm"), password: $("password"), unlock: $("unlock"), loginMsg: $("loginMsg"),
  lookup: $("lookup"), lookupForm: $("lookupForm"), code: $("code"), lookupMsg: $("lookupMsg"),
  result: $("result"), allList: $("allList"),
};

let riddles = null;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function decrypt(password) {
  const file = await (await fetch("answers.json", { cache: "no-cache" })).json();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(file.kdf.salt), iterations: file.kdf.iterations, hash: file.kdf.hash },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"],
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(file.iv) }, key, b64(file.data));
  return JSON.parse(new TextDecoder().decode(plain)).riddles;
}

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = els.password.value;
  if (!password) return;
  els.unlock.disabled = true;
  els.loginMsg.className = "msg";
  els.loginMsg.textContent = "解锁中… Unlocking…";
  try {
    riddles = await decrypt(password);
    els.password.value = "";
    els.loginForm.hidden = true;
    els.lookup.hidden = false;
    renderAll();
    els.code.focus();
  } catch {
    // A wrong password fails the AES-GCM tag check, which is indistinguishable from a corrupt file.
    els.loginMsg.className = "msg err";
    els.loginMsg.textContent = "口令不对 · Wrong password";
    els.password.select();
  } finally {
    els.unlock.disabled = false;
  }
});

els.lookupForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const code = els.code.value.trim().toUpperCase().padStart(2, "0");
  const riddle = riddles.find((r) => r.code === code);
  els.lookupMsg.className = "msg";
  els.lookupMsg.textContent = "";
  if (!riddle) {
    els.result.hidden = true;
    els.lookupMsg.className = "msg err";
    els.lookupMsg.textContent = `没有编号 ${code} 的灯谜 · No riddle ${code}`;
    return;
  }
  els.result.hidden = false;
  els.result.replaceChildren(...render(riddle));
  els.result.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

function list(items, main) {
  const ul = document.createElement("ul");
  ul.className = "answers";
  for (const a of items) {
    const li = document.createElement("li");
    li.textContent = a;
    if (main) li.className = "main";
    ul.append(li);
  }
  return ul;
}

function heading(text) {
  const h = document.createElement("h3");
  h.textContent = text;
  return h;
}

function render(r) {
  const out = [];
  const code = document.createElement("span");
  code.className = "code";
  code.textContent = r.code;
  out.push(code);

  const zh = document.createElement("p");
  zh.className = "riddle";
  zh.textContent = r.zh;
  const en = document.createElement("p");
  en.className = "riddle en";
  en.textContent = r.en;
  out.push(zh, en);

  out.push(heading("谜底 · Answer"), list([...r.zhAnswer, ...r.enAnswer], true));
  const also = [...r.zhAlso, ...r.enAlso, ...r.traditional];
  if (also.length) out.push(heading("也接受 · Also accepted"), list(also, false));
  return out;
}

function renderAll() {
  const table = document.createElement("table");
  table.innerHTML = "<thead><tr><th>编号</th><th>谜底 · Answer</th><th>谜面</th></tr></thead>";
  const body = document.createElement("tbody");
  for (const r of riddles) {
    const tr = document.createElement("tr");
    const c = document.createElement("td");
    c.className = "c";
    c.textContent = r.code;
    const a = document.createElement("td");
    a.textContent = [...r.zhAnswer, ...r.enAnswer].join(" / ");
    const q = document.createElement("td");
    q.textContent = r.zh;
    tr.append(c, a, q);
    body.append(tr);
  }
  table.append(body);
  els.allList.replaceChildren(table);
}
