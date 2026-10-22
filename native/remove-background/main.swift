// Cuts the subject out of an image with Apple Vision (macOS 14+): the same
// model as Remove Background in Finder and Preview. Runs on the device.
//
//   remove-background [--max-side N] < image > result.png
//
// stdin: image bytes in any format ImageIO reads. stdout: a PNG with the
// background transparent, upright (EXIF orientation applied), the longest
// side at most N px (default 4096, never upscaled). Timing goes to stderr.
// The main process runs it (src/main/remove-background.ts) and maps the exit
// codes below to messages.

import CoreImage
import Foundation
import ImageIO
import Vision

enum Exit: Int32 {
  case ok = 0
  case failed = 1
  case usage = 2
  case noSubject = 3
  case unreadable = 4
}

func fail(_ code: Exit, _ message: String) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(code.rawValue)
}

var maxSide = 4096
var args = CommandLine.arguments.dropFirst()
while let arg = args.popFirst() {
  guard arg == "--max-side", let value = args.popFirst().flatMap({ Int($0) }), value > 0 else {
    fail(.usage, "usage: remove-background [--max-side N] < image > result.png")
  }
  maxSide = value
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let source = CGImageSourceCreateWithData(input as CFData, nil),
  let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
  let width = properties[kCGImagePropertyPixelWidth] as? Int,
  let height = properties[kCGImagePropertyPixelHeight] as? Int
else { fail(.unreadable, "cannot read the image") }

// A thumbnail at full size is the simplest way to get ImageIO to apply the
// EXIF orientation, as browsers do when they show the original.
let options: [CFString: Any] = [
  kCGImageSourceCreateThumbnailFromImageAlways: true,
  kCGImageSourceCreateThumbnailWithTransform: true,
  kCGImageSourceThumbnailMaxPixelSize: min(maxSide, max(width, height)),
]
guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else {
  fail(.unreadable, "cannot decode the image")
}

let started = Date()
let request = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: image, options: [:])
do {
  try handler.perform([request])
  guard let observation = request.results?.first, !observation.allInstances.isEmpty else {
    fail(.noSubject, "no subject found")
  }
  let masked = try observation.generateMaskedImage(
    ofInstances: observation.allInstances, from: handler, croppedToInstancesExtent: false)
  guard
    let png = CIContext().pngRepresentation(
      of: CIImage(cvPixelBuffer: masked), format: .RGBA8,
      colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
  else { fail(.failed, "cannot encode the result") }
  FileHandle.standardOutput.write(png)
  let ms = Int(Date().timeIntervalSince(started) * 1000)
  FileHandle.standardError.write(
    "ok \(image.width)x\(image.height) instances=\(observation.allInstances.count) \(ms)ms\n"
      .data(using: .utf8)!)
} catch {
  fail(.failed, "vision error: \(error)")
}
