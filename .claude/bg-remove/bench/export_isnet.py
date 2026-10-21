"""Export IS-Net (xuebinqin/DIS, Apache-2.0 code) general-use weights to ONNX, fixed 1x3x1024x1024.

Input: RGB / 255 - 0.5 (std 1), bilinear-resized to 1024 (as IS-Net/Inference.py). Output: sigmoid(d1), 1x1x1024x1024;
Inference.py then min-max normalizes per image, which the harness does in post.
Weights: isnet-general-use.pth from the DIS README's Google Drive link (not IMG.LY's or onnx-community's conversion).

usage: python export_isnet.py <DIS repo>/IS-Net isnet-general-use.pth models/isnet_fp32.onnx
"""
import sys

import torch


class D1(torch.nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, x):
        return self.net(x)[0][0]


def main(repo, weights, dst):
    sys.path.insert(0, repo)
    from models.isnet import ISNetDIS

    net = ISNetDIS()
    net.load_state_dict(torch.load(weights, map_location='cpu', weights_only=True))
    net.eval()
    x = torch.zeros(1, 3, 1024, 1024)
    torch.onnx.export(D1(net), (x,), dst, input_names=['input'], output_names=['mask'], opset_version=17, dynamo=False)
    print('params', sum(p.numel() for p in net.parameters()))


if __name__ == '__main__':
    main(*sys.argv[1:4])
