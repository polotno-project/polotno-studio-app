# Third-party notices

Polotno App ships or downloads the components below. This file is installed with the app and published next to the
background removal models.

## Background removal

The app downloads these models on first use from this repository's `background-models-v1` release. Both are our own
ONNX exports of the authors' published weights; `scripts/background-models/` rebuilds them.

### IS-Net (standard background removal)

- Source: https://github.com/xuebinqin/DIS, weights `isnet-general-use.pth`.
- The code is under the Apache License 2.0 (https://github.com/xuebinqin/DIS/blob/main/LICENSE.md). The weights are
  published by the same authors, with no licence of their own.
- Converted to ONNX (fp16 weights, fp32 input and output) by Polotno.
- Citation: Xuebin Qin, Hang Dai, Xiaobin Hu, Deng-Ping Fan, Ling Shao, Luc Van Gool. "Highly Accurate Dichotomous
  Image Segmentation". ECCV 2022.

### BiRefNet_lite (high-quality background removal)

- Source: https://huggingface.co/ZhengPeng7/BiRefNet_lite, https://github.com/ZhengPeng7/BiRefNet.
- Converted from the ONNX export at https://huggingface.co/onnx-community/BiRefNet_lite-ONNX; Polotno split its
  deformable convolutions and capped Concat/Split fan-out so it runs on WebGPU. The weights are unchanged.
- Citation: Peng Zheng, Dehong Gao, Deng-Ping Fan, Li Liu, Jorma Laaksonen, Wanli Ouyang, Nicu Sebe. "Bilateral
  Reference for High-Resolution Dichotomous Image Segmentation". CAAI Artificial Intelligence Research, vol. 3,
  9150038, 2024.

```
MIT License

Copyright (c) 2024 ZhengPeng

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### ONNX Runtime Web

- https://github.com/microsoft/onnxruntime (`onnxruntime-web`), bundled with the app to run the models.

```
MIT License

Copyright (c) Microsoft Corporation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
