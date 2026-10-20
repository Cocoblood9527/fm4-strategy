# macOS Vision OCR（兜底引擎）

本机 `Vision.framework` 的原生中文 OCR，用于在 MinerU 未取到文字时补名与交叉校验。

```sh
xcrun swiftc -O ocr.swift -o ocr
./ocr page.jpg          # 输出 JSON：text/conf/bbox（bbox 为左下原点，需转 top-left）
```

实测：178 页约 18 秒（6 并发）。

**已知系统性缺陷**（因此不作主干）：
- 字距拉宽的拉丁字母会混入数字：`Darril` → `Darri1`
- 十六进制码 `0` ↔ `O` 互换：`1C8B86F0` → `1C8B86FO`
- 表格完全不可用：碎片化、行序错乱、表头丢失
