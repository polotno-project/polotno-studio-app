import Foundation
import Vision
import CoreImage
import ImageIO
import UniformTypeIdentifiers

// usage: vision-bg <in> <out.png>
let args = CommandLine.arguments
guard args.count == 3 else { FileHandle.standardError.write("usage: vision-bg <in> <out.png>\n".data(using: .utf8)!); exit(2) }
let inURL = URL(fileURLWithPath: args[1]), outURL = URL(fileURLWithPath: args[2])
guard let src = CGImageSourceCreateWithURL(inURL as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(src, 0, nil) else { print("cannot read"); exit(1) }
let t0 = Date()
let req = VNGenerateForegroundInstanceMaskRequest()
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
do {
  try handler.perform([req])
  guard let obs = req.results?.first else { print("no subject found"); exit(3) }
  let buf = try obs.generateMaskedImage(ofInstances: obs.allInstances, from: handler, croppedToInstancesExtent: false)
  let ci = CIImage(cvPixelBuffer: buf)
  let ctx = CIContext()
  try ctx.writePNGRepresentation(of: ci, to: outURL, format: .RGBA8, colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!)
  print(String(format: "ok %dx%d instances=%d %.0fms", cg.width, cg.height, obs.allInstances.count, Date().timeIntervalSince(t0)*1000))
} catch { print("error: \(error)"); exit(1) }
