#!/usr/bin/env python3
"""MinerU middle.json -> 站點 content.json。

主幹 = MinerU（表格 HTML、段落、標題、圖片 bbox、頁眉、頁碼）。
兜底 = Vision OCR（MinerU 未取到名稱/文字時）。
所有不確定處寫入 site/data/review.json，在界面上明示，而不是假裝正確。
"""
import json, re, os, glob
from html.parser import HTMLParser
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MINERU = glob.glob(os.path.join(ROOT, "MinerU_*.json"))[0]
PAGES = os.path.join(ROOT, "site", "assets", "pages")
CROPS = os.path.join(ROOT, "site", "assets", "crops")
VISION = os.path.join(ROOT, "_analysis", "json")
DATA = os.path.join(ROOT, "site", "data")

# 目錄頁 p004 的權威印刷頁碼（已驗證 page_number 頁 = PDF 頁序）
TOC = {
    "story": ("故事背景", 2, 4, []),
    "system": ("系統篇", 5, 44, [
        (6, "本作的操作方法"), (8, "開始遊戲的方法"), (9, "遊戲的流程"), (10, "關於戰鬥系統"),
        (13, "在戰場上的行動"), (14, "戰鬥選單"), (22, "狀態畫面的看法"), (25, "關於系統選單"),
        (27, "關於聯合作戰"), (41, "角色介紹")]),
    "guide": ("攻略篇", 45, 136, None),
    "data": ("資料篇", 137, 159, [
        (138, "人物技能一覽"), (144, "機甲零件一覽"), (150, "機甲武器一覽"),
        (153, "機甲背包一覽"), (157, "道具一覽"), (158, "超強金手指")]),
    "glossary": ("雷霆任務歷史 & 專有名詞解釋", 160, 171, []),
}
SUBBLOCK = {"戰術方針", "劇情要提", "劇情提要", "敵方機體資料", "敵方機體瓷料", "勝利條件", "敗北條件",
            "角色介紹", "系統篇", "攻略篇", "資料篇", "出擊點", "敵軍", "目錄", "寬料篇", "政略篇"}


def span_text(b):
    return "".join(s.get("content", "") for ln in b.get("lines", [])
                   for s in ln.get("spans", []) if s.get("type") == "text")


def block_text(b):
    return "".join([span_text(b)] + [span_text(s) for s in b.get("blocks", [])])


def norm(s):
    return re.sub(r"[\s/·、，。『「」』”“\"]", "", s or "")


def is_subblock(t):
    return norm(t) in {norm(x) for x in SUBBLOCK} or bool(re.fullmatch(r"雷霆任务\s*4?|雷霆任務\s*4?|4", t.strip()))


class T(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows, self.cur, self.buf, self.in_cell = [], [], [], False

    def handle_starttag(self, tag, a):
        if tag == "tr":
            self.cur = []
        elif tag in ("td", "th"):
            self.in_cell, self.buf = True, []
        elif tag == "br" and self.in_cell:
            self.buf.append(" ")

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.in_cell:
            self.cur.append("".join(self.buf).strip()); self.in_cell = False
        elif tag == "tr":
            if self.cur: self.rows.append(self.cur)
            self.cur = []

    def handle_data(self, d):
        if self.in_cell: self.buf.append(d)


def parse_table(html):
    p = T(); p.feed(html or ""); return [r for r in p.rows if r]


def table_html(b):
    return "".join(s.get("html", "") for sub in b.get("blocks", []) if sub.get("type") == "table_body"
                   for ln in sub.get("lines", []) for s in ln.get("spans", []) if s.get("type") == "table")


def rect_of(bbox, ps):
    x0, y0, x1, y1 = bbox; w, h = ps
    return [round(x0 / w, 4), round(y0 / h, 4), round((x1 - x0) / w, 4), round((y1 - y0) / h, 4)]


def merge_rect(a, b):
    x0, y0 = min(a[0], b[0]), min(a[1], b[1])
    x1, y1 = max(a[0] + a[2], b[0] + b[2]), max(a[1] + a[3], b[1] + b[3])
    return [round(x0, 4), round(y0, 4), round(x1 - x0, 4), round(y1 - y0, 4)]


def is_num(v):
    return v not in ("", "—", "-", "–") and bool(re.fullmatch(r"[\d.,]+", v.replace(",", "")))


def crop(page, rect, name):
    src = os.path.join(PAGES, f"p{page:03d}.webp")
    if not os.path.exists(src):
        return None
    im = Image.open(src); W, H = im.size
    x, y, w, h = rect
    box = (int(x * W), int(y * H), int((x + w) * W), int((y + h) * H))
    if box[2] - box[0] < 40 or box[3] - box[1] < 40:
        return None
    os.makedirs(CROPS, exist_ok=True)
    im.crop(box).save(os.path.join(CROPS, name), "WEBP", quality=84, method=6)
    return f"assets/crops/{name}"


def main():
    d = json.load(open(MINERU, encoding="utf-8"))
    pi = {p["page_idx"]: p for p in d["pdf_info"]}
    review, blocks, tree = [], [], []
    vcache = {}

    def vision(i):
        if i not in vcache:
            fp = os.path.join(VISION, f"p{i:03d}.json")
            vcache[i] = [x["text"] for x in json.load(open(fp, encoding="utf-8"))] if os.path.exists(fp) else []
        return vcache[i]

    def headers(i):
        return [span_text(b).strip() for b in pi.get(i, {}).get("discarded_blocks", [])
                if b.get("type") in ("header", "aside_text") and span_text(b).strip()]

    def titles(i):
        return [block_text(b).strip() for b in pi.get(i, {}).get("para_blocks", [])
                if b.get("type") == "title" and block_text(b).strip()]

    def big_images(i):
        p = pi.get(i, {})
        if not p: return []
        W, H = p["page_size"]
        return [b for b in p["para_blocks"] if b.get("type") == "image"
                and ((b["bbox"][2] - b["bbox"][0]) / W) * ((b["bbox"][3] - b["bbox"][1]) / H) > 0.20]

    def page_text(i):
        return "".join(block_text(b) for b in pi.get(i, {}).get("para_blocks", []))

    # ---------- 攻略關卡邊界 ----------
    # 結構判定只用 MinerU；Vision 僅在「已確定是開局頁但 MinerU 沒給關名」時補名。
    def mineru_name(i):
        for h in headers(i):
            t = re.sub(r"STAGE\s*\d*(\s*/\s*STAGE\s*\d*)?", "", h, flags=re.I).strip(" /·-—")
            if t and not is_subblock(t) and not re.search(r"雷霆|攻略篇|^4$", t):
                return t, "頁眉"
        for t in titles(i):
            if not is_subblock(t) and not re.search(r"雷霆|^4$|攻略篇", t) and len(t) >= 3:
                return t, "標題"
        # 關名橫幅位於地圖塊上方（相對判據，比絕對座標穩）
        big = big_images(i)
        if big:
            top = min(b["bbox"][3] for b in big)
            H = pi[i]["page_size"][1]
            for b in pi[i]["para_blocks"]:
                if b.get("type") != "text" or b["bbox"][3] > top + 12:
                    continue
                t = block_text(b).strip()
                if 3 <= len(t) <= 14 and not is_subblock(t) and not re.search(r"[，。、；：…]", t) and not re.search(r"條件|敵軍|出擊點", t):
                    return t, "地圖上方橫幅"
        return None, None

    def vision_name(i):
        for t in vision(i):
            t = t.strip()
            if 4 <= len(t) <= 14 and not is_subblock(t) and not re.search(r"[，。、；：…（(]", t) \
               and re.search(r"[基地山區戰境都港台路邸橋峽場所]", t):
                return t
        return None

    cands = []
    for i in range(45, 137):
        sig = []
        nm, _ = mineru_name(i)
        if big_images(i) and re.search(r"勝利條件|敗北條件|出擊點", page_text(i)): sig.append("地圖+條件")
        if nm and any(re.search(r"STAGE", h, re.I) for h in headers(i)): sig.append("頁眉關名")
        if nm and big_images(i): sig.append("地圖+關名")
        if sig:
            cands.append((i, nm, sig))
    starts = []
    for i, nm, sig in cands:
        if starts and i - starts[-1][0] < 2:
            continue
        if starts and not nm and starts[-1][1]:
            continue  # 無名頁不覆蓋已有名的關
        starts.append((i, nm, sig))
    if len(starts) != 30:
        review.append(("關卡邊界", f"偵測到 {len(starts)} 關，預期 30 關", [s[0] for s in starts]))
    guide = []
    for k, (i, nm, sig) in enumerate(starts):
        end = (starts[k + 1][0] - 1) if k + 1 < len(starts) else 136
        if not nm:
            v = vision_name(i)
            if v:
                nm, _ = v, "Vision"
        nums = {int(m.group(1)) for p in range(i, end + 1) for h in headers(p) for m in re.finditer(r"STAGE\s*(\d+)", h, re.I)}
        num = max(nums) if nums else k + 1
        if num != k + 1:
            review.append(("關號", f"p{i} 頁眉最大 STAGE{num}，與順序 {k+1} 不符", sorted(nums)))
        if not nm:
            review.append(("關名缺失", f"p{i}", "需人工補"))
        guide.append({"id": f"st-{num:02d}", "label": f"STAGE {num} {nm or '（名稱待補）'}",
                      "pages": [i, end], "_start": i})

    # ---------- 非攻略篇：用目錄頁碼 ----------
    def toc_children(part_id, lo, hi, subs):
        if not subs:
            return [{"id": f"{part_id}-a", "label": TOC[part_id][0], "pages": [lo, hi], "_start": lo}]
        out = []
        for j, (p, name) in enumerate(subs):
            end = (subs[j + 1][0] - 1) if j + 1 < len(subs) else hi
            out.append({"id": f"{part_id}-{p}", "label": name, "pages": [max(p, lo), end], "_start": p})
        return out

    tree = []
    allsecs = []
    for pid, (label, lo, hi, subs) in TOC.items():
        kids = guide if pid == "guide" else toc_children(pid, lo, hi, subs)
        tree.append({"id": pid, "label": label, "pages": [lo, hi], "kind": "part", "children": kids})
        allsecs += kids

    # ---------- 逐頁產出內容塊 ----------
    page2sec = {}
    for s in allsecs:
        for i in range(s["pages"][0], s["pages"][1] + 1):
            page2sec.setdefault(i, s["id"])
    for i in range(0, 178):
        if i not in page2sec:
            page2sec[i] = None

    for s in allsecs:
        sid = s["id"]; s.pop("_start", None)
        for i in range(s["pages"][0], s["pages"][1] + 1):
            p = pi.get(i)
            if not p: continue
            ps = p["page_size"]
            for bi, b in enumerate(p["para_blocks"]):
                t, bbox = b.get("type"), b.get("bbox")
                if not bbox: continue
                r = rect_of(bbox, ps)
                bid = f"b{i}-{bi}"
                if t == "title":
                    txt = block_text(b).strip()
                    if not txt or re.search(r"雷霆任務|^4$|CHAPTER", txt) or norm(txt) in {norm("目錄"), "CONTENTS"}:
                        continue
                    blocks.append({"id": bid, "section": sid, "type": "subhead", "title": txt,
                                   "pages": [i], "src": {"page": i, "rect": r}})
                elif t == "text":
                    txt = block_text(b).strip()
                    if len(txt) < 2: continue
                    prev = blocks[-1] if blocks and blocks[-1]["section"] == sid else None
                    if prev and prev["type"] == "prose" and prev["pages"] == [i]:
                        prev["paras"].append(txt); prev["src"]["rect"] = merge_rect(prev["src"]["rect"], r)
                    else:
                        blocks.append({"id": bid, "section": sid, "type": "prose", "title": None,
                                       "paras": [txt], "pages": [i], "src": {"page": i, "rect": r}})
                elif t == "table":
                    cap = ""
                    for sub in b.get("blocks", []):
                        if sub.get("type") == "table_caption":
                            cap = span_text(sub).strip()
                    rows = parse_table(table_html(b))
                    rows = [x for x in rows if any(c.strip() for c in x)]
                    if not rows:
                        img = crop(i, r, f"p{i:03d}-{bi}.webp")
                        if img:
                            blocks.append({"id": bid, "section": sid, "type": "figure", "caption": None,
                                           "image": img, "pages": [i], "src": {"page": i, "rect": r}})
                            review.append(("表格實為圖片", bid, f"p{i} 已改以截圖呈現"))
                        else:
                            review.append(("空表格", bid, f"p{i}"))
                        continue
                    w = max(len(x) for x in rows)
                    if w <= 1 or len(rows) <= 1:
                        review.append(("表格退化", bid, f"p{i} {len(rows)}行×{w}列，需人工重錄"))
                        continue
                    rows = [x + [""] * (w - len(x)) for x in rows]
                    head, body = rows[0], rows[1:]
                    cols = []
                    for ci, h in enumerate(head):
                        tn = "num" if all(is_num(x[ci]) or x[ci] in ("", "—", "-") for x in body) else "text"
                        cols.append({"k": f"c{ci}", "label": h or f"欄{ci+1}", "t": tn})
                    rr = []
                    for x in body:
                        o = {}
                        for ci, c in enumerate(cols):
                            v = x[ci].strip()
                            if c["t"] == "num":
                                n = v.replace(",", "")
                                o[c["k"]] = None if n in ("", "—", "-") else (float(n) if "." in n else int(n) if n.isdigit() else v)
                            else:
                                o[c["k"]] = v or None
                        rr.append(o)
                    blocks.append({"id": bid, "section": sid, "type": "table", "title": cap or None,
                                   "cols": cols, "rows": rr, "pages": [i], "src": {"page": i, "rect": r}})
                elif t == "image":
                    if r[2] * r[3] < 0.02: continue
                    img = crop(i, r, f"p{i:03d}-{bi}.webp")
                    if not img: continue
                    blocks.append({"id": bid, "section": sid, "type": "figure", "caption": None,
                                   "image": img, "pages": [i], "src": {"page": i, "rect": r}})

    # ---------- 人工校對覆寫（MinerU 版面失敗處）----------
    ovp = os.path.join(ROOT, "tools", "overrides.json")
    applied = []
    if os.path.exists(ovp):
        ov = json.load(open(ovp, encoding="utf-8"))
        for o in ov.get("overrides", []):
            drop = set(o.get("drop_pages", []))
            before = len(blocks)
            blocks[:] = [b for b in blocks if not (b["section"] == o["section"] and b["src"]["page"] in drop)]
            removed = before - len(blocks)
            blk = dict(o["block"])
            blk.setdefault("manual", True)
            blocks.append(blk)
            applied.append((o["id"], o["section"], removed, len(blk.get("rows", []))))
            review[:] = [r for r in review if not (len(r) > 1 and str(r[1]).startswith("b156"))]
    for oid, sec, removed, nrows in applied:
        review.append(("人工覆寫", oid, f"於 {sec} 以 {nrows} 行手工資料取代 {removed} 個自動塊"))

    aliases = json.load(open(os.path.join(DATA, "aliases.json"), encoding="utf-8")) if os.path.exists(os.path.join(DATA, "aliases.json")) else []
    json.dump({"meta": {"title": "雷霆任務4", "subtitle": "故事完全攻略", "source": "疾風之狼 PS2-36",
                        "scanPages": 178, "engine": "MinerU 主幹 + Vision OCR 兜底"},
               "aliases": aliases, "tree": tree, "blocks": blocks},
              open(os.path.join(DATA, "content.json"), "w", encoding="utf-8"), ensure_ascii=False)

    used = sorted({b["src"]["page"] for b in blocks})
    json.dump({str(i): [{"t": x} for x in vision(i)] for i in used},
              open(os.path.join(DATA, "ocr.json"), "w", encoding="utf-8"), ensure_ascii=False)
    json.dump(review, open(os.path.join(DATA, "review.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    n = lambda k: sum(1 for b in blocks if b["type"] == k)
    print(f"小節={len(allsecs)} 塊={len(blocks)}  正文={n('prose')} 小標={n('subhead')} 表={n('table')} 圖={n('figure')}")
    print(f"攻略關卡={len(guide)}  待複核={len(review)}")
    for x in review[:20]:
        print("   ", x)


if __name__ == "__main__":
    main()
