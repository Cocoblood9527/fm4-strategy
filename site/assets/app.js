const S = { content: null, ocr: {}, blocksBySection: new Map(), sections: [] };
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const pg = (n) => "p" + String(n).padStart(3, "0");
const pagesLabel = (a) => (a.length > 1 ? `${a[0]}–${a[a.length - 1]}` : `${a[0]}`);

/* ---------------- boot ---------------- */
async function boot() {
  const [c] = await Promise.all([
    fetch("data/content.json").then((r) => r.json()),
    fetch("data/ocr.json").then((r) => r.json()).then((o) => (S.ocr = o)).catch(() => {}),
  ]);
  S.content = c;
  fetch("data/review.json").then((r) => r.json())
    .then((rv) => {
      S.review = rv;
      const real = rv.filter((x) => x[0] === "表格退化" || x[0] === "關號" || x[0] === "關名缺失" || x[0] === "關卡邊界");
      const btn = $("#revBtn");
      btn.hidden = !rv.length;
      btn.innerHTML = `複核 ${rv.length} 項`;
      btn.title = real.length ? `${real.length} 項需人工處理` : "多為自動修正項";
      btn.onclick = () => {
        $("#drawerTitle").textContent = `構建复核清单（${rv.length} 項）`;
        $("#drawerBody").innerHTML = `<div class="revlist">${rv.map((x) =>
          `<div class="ri"><span class="rk ${x[0] === "表格退化" ? "bad" : ""}">${esc(x[0])}</span><code>${esc(x[1])}</code><div>${esc(x[2])}</div></div>`).join("")}</div>`;
        $("#drawer").classList.add("on"); $("#scrim").classList.add("on");
      };
    }).catch(() => {});
  $("#brandTitle").textContent = c.meta.title;
  $("#brandSub").textContent = c.meta.subtitle + " · " + c.meta.source;
  (c.blocks || []).forEach((b) => {
    if (!S.blocksBySection.has(b.section)) S.blocksBySection.set(b.section, []);
    S.blocksBySection.get(b.section).push(b);
  });
  renderNav();
  renderBody();
  buildIndex();
  wire();
  history.replaceState(null, "", location.pathname + location.search + (location.hash || "#st-05"));
  if (!location.hash) location.hash = "#st-05";
}

/* ---------------- nav ---------------- */
function renderNav() {
  const out = [];
  for (const part of S.content.tree) {
    const kids = part.children || [];
    out.push(`<div class="part"><div class="ph" data-part="${part.id}"><span>${esc(part.label)}</span><span class="num">${pagesLabel(part.pages)}</span></div><div class="nav">`);
    const list = kids.length ? kids : [part];
    for (const n of list) {
      out.push(`<a href="#${n.id}" class="${n.pending ? "dim" : ""}" data-sec="${n.id}"><span>${esc(n.label)}</span><span class="pg">${pagesLabel(n.pages)}</span></a>`);
    }
    out.push("</div></div>");
    if (!kids.length) continue;
  }
  $("#nav").innerHTML = out.join("");
}

/* ---------------- body ---------------- */
function renderBody() {
  const out = [];
  for (const part of S.content.tree) {
    const list = part.children && part.children.length ? part.children : [Object.assign({}, part, { selfPart: true })];
    for (const sec of list) {
      const m = /^(STAGE\s*\d+)\s*(.+)$/.exec(sec.label);
      const badge = m ? m[1] : null, label = m ? m[2] : sec.label;
      S.sections.push(sec);
      const blocks = S.blocksBySection.get(sec.id) || [];
      out.push(`<section class="sec" id="${sec.id}">`);
      out.push(
        `<div class="sechead">${badge ? `<span class="badge">${esc(badge)}</span>` : ""}` +
          `<h2>${esc(label)}</h2>` +
          (sec.src ? `<button class="srcbtn" data-src="sec:${sec.id}">對照掃描頁 ↗</button>` : "") +
          `<span class="pages">原書 p.${pagesLabel(sec.pages)}</span></div>`
      );
      if (!blocks.length) {
        out.push(
          `<div class="pending"><b>待轉錄</b><span class="sep">·</span>原書 p.${pagesLabel(sec.pages)}` +
            `<span class="sep">·</span>正文走 OCR、數值表逐頁人工校對</div>`
        );
      } else {
        blocks.forEach((b) => out.push(renderBlock(b)));
      }
      out.push("</section>");
    }
  }
  $("#doc").innerHTML = out.join("");
  $$(".block").forEach(initTable);
}

function srcBtn(b, label) {
  if (!b.src) return "";
  return `<button class="srcbtn" data-src="blk:${esc(b.id)}">${label || "原書 p." + b.src.page + " ↗"}</button>`;
}

function renderBlock(b) {
  const head = b.title ? `<h3>${esc(b.title)}${srcBtn(b)}</h3>` : "";
  let inner = "";
  if (b.type === "prose") inner = `<div class="prose">${b.paras.map((p) => `<p>${esc(p)}</p>`).join("")}</div>`;
  else if (b.type === "chips")
    inner = `<div class="chips">${b.items.map((i) => `<div class="chip ${i.tone}"><span class="k">${esc(i.k)}</span><span class="v">${esc(i.v)}</span></div>`).join("")}</div>`;
  else if (b.type === "figure")
    inner =
      `<figure class="map"><img src="${b.image}" alt="${esc(b.caption)}" loading="lazy" data-zoom="${esc(b.id)}">` +
      `<figcaption><span>${esc(b.caption)}</span>${srcBtn(b)}</figcaption></figure>`;
  else if (b.type === "table") inner = tableHTML(b);
  return `<div class="block" id="blk-${b.id}" data-block="${b.id}">${head}${inner}${b.note ? `<div class="note">${esc(b.note)}</div>` : ""}</div>`;
}

function cellHTML(b, r, c) {
  const v = r[c.k];
  const shown = v === null || v === undefined || v === "" ? `<span class="dash">—</span>` : esc(v);
  const cls = c.k === "name" ? "txt" : c.t === "text" ? "txt" : "";
  return `<td class="${cls}">${shown}</td>`;
}
function rowsHTML(b) {
  return b.rows.map((r) => `<tr>${b.cols.map((c) => cellHTML(b, r, c)).join("")}</tr>`).join("");
}
function tableHTML(b) {
  const cols = b.cols.map((c) => `<th class="${c.t}" data-k="${c.k}">${esc(c.label)}</th>`).join("");
  return (
    `<div class="tablebar"><input type="search" placeholder="篩選本表…" data-filter>` +
    `<span class="hint">共 ${b.rows.length} 列 · 點欄位標題可排序</span></div>` +
    `<div class="tablewrap"><table><thead><tr>${cols}</tr></thead><tbody>${rowsHTML(b)}</tbody></table></div>`
  );
}

/* ---------------- table behaviour ---------------- */
function initTable(block) {
  const b = S.content.blocks.find((x) => x.id === block.dataset.block);
  if (!b || !b.rows) return;
  const table = $(".tablewrap table", block);
  let sortK = null, asc = false;
  $$("th", table).forEach((th) =>
    th.addEventListener("click", () => {
      const k = th.dataset.k;
      asc = sortK === k ? !asc : false;
      sortK = k;
      const col = b.cols.find((c) => c.k === k);
      b.rows.sort((x, y) => {
        if (col.t === "num") {
          const a = x[k] === null ? -Infinity : +x[k], c = y[k] === null ? -Infinity : +y[k];
          return asc ? a - c : c - a;
        }
        return asc ? String(x[k]).localeCompare(String(y[k]), "zh-Hant") : String(y[k]).localeCompare(String(x[k]), "zh-Hant");
      });
      $$("th", table).forEach((t) => t.classList.remove("sorted", "asc"));
      th.classList.add("sorted");
      if (asc) th.classList.add("asc");
      $("tbody", table).innerHTML = rowsHTML(b);
      applyFilter(block);
    })
  );
  const inp = $("[data-filter]", block);
  inp.addEventListener("input", () => applyFilter(block));
}
function applyFilter(block) {
  const q = ($("[data-filter]", block).value || "").trim().toLowerCase();
  $$("tbody tr", block).forEach((tr) => {
    tr.hidden = !!q && !tr.textContent.toLowerCase().includes(q);
  });
}

/* ---------------- search ---------------- */
let INDEX = [];
function secLabel(id) {
  for (const part of S.content.tree) {
    if (part.id === id) return part.label;
    for (const c of part.children || []) if (c.id === id) return c.label === part.label ? part.label : part.label + " › " + c.label;
  }
  return "";
}
function buildIndex() {
  INDEX = [];
  for (const sec of S.sections) {
    INDEX.push({ sec: sec.id, title: sec.label, path: secLabel(sec.id), text: "", pages: sec.pages, kind: "章節" });
  }
  const lastSub = {};
  for (const b of S.content.blocks || []) {
    if (b.type === "subhead") { lastSub[b.section] = b.title; continue; }
    const ctx = lastSub[b.section] || "";
    let text = "";
    if (b.paras) text = b.paras.join("\n");
    else if (b.items) text = b.items.map((i) => i.k + " " + i.v).join(" ");
    else if (b.caption) text = b.caption;
    else if (b.rows) text = b.cols.map((c) => c.label).join(" ") + "\n" + b.rows.map((r) => Object.values(r).join(" ")).join("\n");
    if (ctx) text = ctx + "\n" + text;
    INDEX.push({
      sec: b.section, block: b.id, title: b.title || ctx, path: secLabel(b.section), text,
      pages: b.pages || [], kind: { prose: "正文", table: "數據表", chips: "條件", figure: "地圖", subhead: "小標", stagehead: "關卡" }[b.type] || b.type,
    });
  }
}
function expand(q) {
  const out = [q];
  for (const g of S.content.aliases || []) {
    if (g.some((w) => w.length >= 2 && q.includes(w.toLowerCase()))) {
      for (const w of g) if (w.length >= 2 && !out.includes(w.toLowerCase())) out.push(w.toLowerCase());
    }
  }
  return out;
}
function doSearch(raw) {
  const q = raw.trim().toLowerCase();
  if (!q) return [];
  const toks = q.split(/\s+/).filter(Boolean);
  const hits = [];
  for (const e of INDEX) {
    const hay = (e.title + " " + e.text).toLowerCase();
    let score = 0, ok = true, term = toks[0];
    for (const t of toks) {
      let best = 0, bt = t;
      for (const x of expand(t)) {
        if (hay.includes(x)) { const s = x === t ? 6 : 2; if (s > best) { best = s; bt = x; } }
      }
      if (!best) { ok = false; break; }
      score += best;
      if (bt === t) term = t; else if (term === toks[0]) term = bt;
    }
    if (!ok) continue;
    if (e.title.toLowerCase().includes(toks[0])) score += 4;
    let hi = -1;
    const matched = [];
    for (const t of toks) {
      for (const x of expand(t)) {
        const j = e.text.toLowerCase().indexOf(x);
        if (j >= 0) { matched.push(x); if (hi < 0) { hi = j; term = x; } }
      }
    }
    const snip = hi >= 0 ? e.text.slice(Math.max(0, hi - 30), hi + 70) : e.text.slice(0, 80);
    hits.push({ e, score, snip: snip.replace(/\s+/g, " "), term, matched });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, 40);
}
function renderResults(hits, q) {
  const box = $("#results");
  if (!hits.length) { box.innerHTML = `<div class="res"><div class="rx">找不到「${esc(q)}」，可試試：加農砲、Tempest、Firebird、聯合作戰</div></div>`; box.classList.add("on"); return; }
  box.innerHTML = hits
    .map((h, i) => {
      const pats = [...new Set([...q.split(/\s+/), ...(h.matched || [h.term])])].filter(Boolean)
        .sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      const hl = (t) => pats.length ? esc(t).replace(new RegExp("(" + pats.join("|") + ")", "gi"), "<mark>$1</mark>") : esc(t);
      return `<div class="res${i === 0 ? " sel" : ""}" data-go="${h.e.block || h.e.sec}" data-sec="${h.e.sec}">
        <div class="rt"><span class="rp">${esc(h.e.path || h.e.title)}</span>${h.e.title && h.e.path ? `<b>› ${hl(h.e.title)}</b>` : ""}<span class="tag">${h.e.kind}</span><span class="rmeta">原書 p.${pagesLabel(h.e.pages || [0])}</span></div>
        ${h.e.text ? `<div class="rx">…${hl(h.snip || "")}…</div>` : ""}</div>`;
    })
    .join("");
  box.classList.add("on");
}
function goto(id, sec) {
  const el = document.getElementById(id.startsWith("blk-") ? id : sec || id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
  el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 1600);
}

/* ---------------- evidence drawer ---------------- */
function findSrc(key) {
  const [kind, id] = key.split(":");
  if (kind === "sec") return (S.content.tree.find((p) => p.id === id) || (S.content.tree.flatMap((p) => p.children || [])).find((c) => c.id === id) || {}).src;
  const b = S.content.blocks.find((x) => x.id === id);
  return b && b.src;
}
function openSrc(key) {
  const src = findSrc(key);
  if (!src) return;
  const { page, rect } = src;
  const [x, y, w, h] = rect;
  $("#drawerTitle").textContent = `原書掃描頁 p.${String(page).padStart(3, "0")}`;
  const lines = (S.ocr[String(page)] || []).map((l) => l.t).join("\n");
  $("#drawerBody").innerHTML =
    `<div class="pagebox"><img src="assets/pages/${pg(page)}.webp" alt="p.${page}">` +
    `<div class="hl" style="left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${h * 100}%"></div></div>` +
    `<div class="rawtext"><em>該頁 OCR 原文（未校對，僅供核對用）：</em>\n${esc(lines)}</div>`;
  $("#drawer").classList.add("on");
  $("#scrim").classList.add("on");
}

/* ---------------- wiring ---------------- */
function wire() {
  const q = $("#q");
  let t;
  q.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => renderResults(doSearch(q.value), q.value.trim()), 90); });
  q.addEventListener("focus", () => { if (q.value) renderResults(doSearch(q.value), q.value.trim()); });
  q.addEventListener("keydown", (e) => {
    const items = $$("#results .res[data-go]");
    let i = items.findIndex((x) => x.classList.contains("sel"));
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault(); if (!items.length) return;
      items[i < 0 ? 0 : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length].classList.add("sel");
      if (i >= 0) items[i].classList.remove("sel");
      $$("#results .res[data-go]").forEach((x) => x.classList.contains("sel") && x.scrollIntoView({ block: "nearest" }));
    } else if (e.key === "Enter") { (items[i >= 0 ? i : 0] || {}).click?.(); }
    else if (e.key === "Escape") { $("#results").classList.remove("on"); q.blur(); }
  });
  $("#results").addEventListener("click", (e) => {
    const r = e.target.closest("[data-go]"); if (!r) return;
    $("#results").classList.remove("on"); goto(r.dataset.go, r.dataset.sec);
  });
  document.addEventListener("click", (e) => { if (!e.target.closest(".searchwrap")) $("#results").classList.remove("on"); });
  $("#doc").addEventListener("click", (e) => {
    const s = e.target.closest(".srcbtn"); if (s) return openSrc(s.dataset.src);
    const z = e.target.closest("[data-zoom]");
    if (z) { $("#lightboxImg").src = z.src; $("#lightbox").classList.add("on"); }
  });
  $("#lightbox").addEventListener("click", () => $("#lightbox").classList.remove("on"));
  const close = () => { $("#drawer").classList.remove("on"); $("#scrim").classList.remove("on"); };
  $("#drawerClose").addEventListener("click", close);
  $("#scrim").addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); $("#q").focus(); $("#q").select(); }
    if (e.key === "Escape") close();
  });
  const links = $$("#nav a");
  const spy = new IntersectionObserver(
    (es) => es.forEach((en) => { if (en.isIntersecting) links.forEach((a) => a.classList.toggle("active", a.dataset.sec === en.target.id)); }),
    { rootMargin: "-70px 0px -75% 0px" }
  );
  S.sections.forEach((s) => { const el = document.getElementById(s.id); if (el) spy.observe(el); });
}
boot();
