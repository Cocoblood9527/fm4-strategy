import Foundation
import PDFKit
import AppKit

let args = CommandLine.arguments
guard let path = args.dropFirst().first(where: { $0.hasSuffix(".pdf") }),
      let doc = PDFDocument(url: URL(fileURLWithPath: path)) else {
    print("用法: pdfcheck <pdf> [搜尋字串...] [--render 頁碼:輸出png]")
    exit(2)
}

print("頁數: \(doc.pageCount)")
var total = 0
for i in 0..<doc.pageCount { total += (doc.page(at: i)?.string ?? "").count }
print("文字層總字數: \(total)")

for needle in args.dropFirst(2) where !needle.hasPrefix("--") {
    var found: [Int] = []
    for i in 0..<doc.pageCount where (doc.page(at: i)?.string ?? "").contains(needle) { found.append(i + 1) }
    let s = found.isEmpty ? "✗ 找不到" : "✓ 第 " + found.prefix(5).map(String.init).joined(separator: ",") + " 頁"
    print("搜尋「\(needle)」→ \(s)")
}

if let k = args.firstIndex(of: "--render"), k + 1 < args.count {
    let parts = args[k + 1].split(separator: ":")
    guard let pn = Int(parts[0]), let page = doc.page(at: pn - 1) else { print("渲染失敗"); exit(1) }
    let b = page.bounds(for: .mediaBox)
    let scale: CGFloat = 1.7
    let sc: CGFloat = 1.7
    let pw = Int(b.width * sc), ph = Int(b.height * sc)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: pw, pixelsHigh: ph, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .calibratedRGB, bytesPerRow: pw * 4, bitsPerPixel: 32)!
    guard let g = NSGraphicsContext(bitmapImageRep: rep) else { print("渲染失敗"); exit(1) }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = g
    NSColor.white.setFill(); NSRect(x: 0, y: 0, width: pw, height: ph).fill()
    page.draw(with: .mediaBox, to: g.cgContext)
    NSGraphicsContext.restoreGraphicsState()
    try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: String(parts[1])))
    print("已渲染第 \(pn) 頁 → \(parts[1])")
}
