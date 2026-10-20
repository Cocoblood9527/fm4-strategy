import Foundation
import CoreGraphics
import ImageIO
import Vision

struct Line: Codable { let text: String; let conf: Double; let x: Double; let y: Double; let w: Double; let h: Double }

let args = CommandLine.arguments
guard args.count >= 2 else {
    FileHandle.standardError.write("usage: ocr <image> [--gray]\n".data(using: .utf8)!)
    exit(2)
}
let path = args[1]
let gray = args.contains("--gray")

guard let src = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
      let img = CGImageSourceCreateImageAtIndex(src, 0, nil) else {
    print("[]"); exit(1)
}

var cg = img
if gray {
    let cs = CGColorSpaceCreateDeviceGray()
    let ctx = CGContext(data: nil, width: img.width, height: img.height, bitsPerComponent: 8,
                        bytesPerRow: img.width, space: cs,
                        bitmapInfo: CGImageAlphaInfo.none.rawValue)!
    ctx.draw(img, in: CGRect(x: 0, y: 0, width: img.width, height: img.height))
    cg = ctx.makeImage()!
}

let req = VNRecognizeTextRequest { obs, _ in
    guard let res = obs.results as? [VNRecognizedTextObservation] else { return }
    var out: [Line] = []
    for r in res {
        guard let top = r.topCandidates(1).first else { continue }
        let b = r.boundingBox
        out.append(Line(text: top.string, conf: Double(top.confidence),
                        x: Double(b.minX), y: Double(b.minY), w: Double(b.width), h: Double(b.height)))
    }
    out.sort { ($0.y + $0.h) > ($1.y + $1.h) }
    let data = try! JSONEncoder().encode(out)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write("\n".data(using: .utf8)!)
}
req.recognitionLevel = .accurate
req.usesLanguageCorrection = true
req.recognitionLanguages = ["zh-Hant", "zh-Hans", "en-US", "ja-JP"]

let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try! handler.perform([req])
