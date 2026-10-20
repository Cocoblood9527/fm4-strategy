import Foundation
import PDFKit
import AppKit

let path = CommandLine.arguments[1]
guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { print("無法開啟"); exit(1) }

let W = 200, H = 282
var gaps: [(Int, Double)] = []
var sum = 0.0

for i in 0..<doc.pageCount {
    guard let page = doc.page(at: i) else { continue }
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: W, pixelsHigh: H, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .calibratedRGB, bytesPerRow: W * 4, bitsPerPixel: 32)!
    guard let ctx = NSGraphicsContext(bitmapImageRep: rep) else { continue }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = ctx
    NSColor.white.setFill()
    NSRect(x: 0, y: 0, width: W, height: H).fill()
    page.draw(with: .mediaBox, to: ctx.cgContext)
    NSGraphicsContext.restoreGraphicsState()

    let buf = rep.bitmapData!
    var first = H, last = 0
    for y in 0..<H {
        var ink = 0
        let row = y * W * 4
        for x in 0..<W {
            let o = row + x * 4
            let lum = (Int(buf[o]) * 299 + Int(buf[o + 1]) * 587 + Int(buf[o + 2]) * 114) / 1000
            if lum < 232 { ink += 1 }
        }
        if ink > 2 { if first == H { first = y }; last = y }
    }
    let top = Double(first) / Double(H)
    gaps.append((i + 1, top))
    sum += top
}

let avg = sum / Double(gaps.count)
print(String(format: "頁數 %d   平均頂部空白 %.1f%%", gaps.count, avg * 100))
let bad = gaps.filter { $0.1 > 0.10 }
print("頂部空白 >10% 的頁數：\(bad.count)")
let hist = stride(from: 0.0, through: 1.0, by: 0.1).map { b in
    gaps.filter { Int($0.1 * 10) == Int(b * 10) }.count
}
print("分佈(每10%一档):", hist.enumerated().map { "\($0.offset*10)%:\($0.element)" }.joined(separator: " "))
for (p, g) in bad.sorted(by: { $0.1 > $1.1 }).prefix(12) {
    print(String(format: "   第 %3d 頁  頂部空白 %.0f%%", p, g * 100))
}
