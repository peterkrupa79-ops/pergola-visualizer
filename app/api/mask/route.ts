import { NextRequest } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normU8(x: Uint8Array): Uint8Array {
  return Uint8Array.from(x);
}

function percentile95Sampled(values01: Float32Array, sampleStride: number): number {
  const samples: number[] = [];
  for (let i = 0; i < values01.length; i += sampleStride) samples.push(values01[i]);
  samples.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(samples.length - 1, Math.floor(samples.length * 0.95)));
  return samples[idx] ?? 0.1;
}

function dilate(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      let any = 0;
      for (let yy = y0; yy <= y1 && !any; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          if (bin[row + xx] === 1) {
            any = 1;
            break;
          }
        }
      }
      out[y * w + x] = any;
    }
  }
  return out;
}

function largestComponent(bin: Uint8Array, w: number, h: number): Uint8Array {
  const visited = new Uint8Array(bin.length);
  let bestPixels: number[] | null = null;
  let bestScore = -1;

  const stack: number[] = [];

  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === 0 || visited[i] === 1) continue;

    stack.length = 0;
    stack.push(i);
    visited[i] = 1;

    let area = 0;
    let sumY = 0;
    const pixels: number[] = [];

    while (stack.length) {
      const idx = stack.pop()!;
      pixels.push(idx);
      area++;

      const y = Math.floor(idx / w);
      const x = idx - y * w;
      sumY += y;

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nidx = ny * w + nx;
          if (bin[nidx] === 1 && visited[nidx] === 0) {
            visited[nidx] = 1;
            stack.push(nidx);
          }
        }
      }
    }

    const centerYNorm = (sumY / Math.max(1, area)) / Math.max(1, h - 1);
    const score = area * (0.7 + 0.3 * centerYNorm);

    if (score > bestScore) {
      bestScore = score;
      bestPixels = pixels;
    }
  }

  const out = new Uint8Array(bin.length);
  if (!bestPixels) return out;
  for (const idx of bestPixels) out[idx] = 1;
  return out;
}

async function blobToBuffer(b: Blob): Promise<Buffer> {
  const ab = await b.arrayBuffer();
  return Buffer.from(ab);
}

function luminance(r: number, g: number, b: number) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export async function POST(req: NextRequest) {
  try {
    const fd = await req.formData();
    const original = fd.get("original");
    const proposed = fd.get("proposed");

    if (!(original instanceof Blob) || !(proposed instanceof Blob)) {
      return new Response("Missing original/proposed files", { status: 400 });
    }

    const origBuf = await blobToBuffer(original);
    const propBuf = await blobToBuffer(proposed);

    const origMeta = await sharp(origBuf).metadata();
    const W0 = origMeta.width ?? 0;
    const H0 = origMeta.height ?? 0;
    if (!W0 || !H0) return new Response("Invalid original image", { status: 400 });

    // Output size (keeps quality but bounded)
    const MAX_DIM = 2000;
    const scaleOut = Math.min(1, MAX_DIM / Math.max(W0, H0));
    const W = Math.max(1, Math.round(W0 * scaleOut));
    const H = Math.max(1, Math.round(H0 * scaleOut));

    // Working size for mask
    const MAX_MASK_DIM = 900;
    const scaleMask = Math.min(1, MAX_MASK_DIM / Math.max(W, H));
    const mw = Math.max(1, Math.round(W * scaleMask));
    const mh = Math.max(1, Math.round(H * scaleMask));
    const n = mw * mh;

    const origSmall = await sharp(origBuf).resize(mw, mh, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const propSmall = await sharp(propBuf).resize(mw, mh, { fit: "fill" }).removeAlpha().raw().toBuffer();

    // Diff map 0..1
    const diff01 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const dr = Math.abs(origSmall[k] - propSmall[k]);
      const dg = Math.abs(origSmall[k + 1] - propSmall[k + 1]);
      const db = Math.abs(origSmall[k + 2] - propSmall[k + 2]);
      diff01[i] = (dr + dg + db) / (3 * 255);
    }

    const sampleStride = clamp(Math.floor(n / 25000), 1, 50);
    const p95 = percentile95Sampled(diff01, sampleStride);
    const T = clamp(p95 * 0.35, 0.06, 0.16);

    let bin: Uint8Array = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = diff01[i] > T ? 1 : 0;

    // Keep largest changed blob (pergola)
    bin = normU8(largestComponent(bin, mw, mh));

    // Alpha (soft edges)
    const alpha255Small = Buffer.alloc(n);
    for (let i = 0; i < n; i++) alpha255Small[i] = bin[i] ? 255 : 0;

    const featherSigma = clamp(Math.round(Math.min(mw, mh) * 0.010), 6, 22);

    const alphaFull = await sharp(alpha255Small, { raw: { width: mw, height: mh, channels: 1 } })
      .blur(featherSigma)
      .resize(W, H, { kernel: "lanczos3" })
      .raw()
      .toBuffer();

    // Shadow: dilate + blur
    const shadowR = clamp(Math.round(Math.min(mw, mh) * 0.035), 10, 45);
    const shadowBin = normU8(dilate(bin, mw, mh, shadowR));

    const shadow255Small = Buffer.alloc(n);
    for (let i = 0; i < n; i++) shadow255Small[i] = shadowBin[i] ? 255 : 0;

    const shadowSigma = clamp(Math.round(Math.min(mw, mh) * 0.020), 10, 40);

    const shadowAlphaFull = await sharp(shadow255Small, { raw: { width: mw, height: mh, channels: 1 } })
      .blur(shadowSigma)
      .resize(W, H, { kernel: "lanczos3" })
      .raw()
      .toBuffer();

    // Full-res RGB
    const origFull = await sharp(origBuf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const propFull = await sharp(propBuf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();

    // Exposure match: inside pergola vs nearby ring
    let sumIn = 0;
    let cntIn = 0;
    let sumRing = 0;
    let cntRing = 0;

    for (let i = 0; i < W * H; i++) {
      const a = alphaFull[i];
      const k = i * 3;
      if (a > 180) {
        sumIn += luminance(propFull[k], propFull[k + 1], propFull[k + 2]);
        cntIn++;
      } else if (a > 40 && a < 160) {
        sumRing += luminance(origFull[k], origFull[k + 1], origFull[k + 2]);
        cntRing++;
      }
    }

    const meanIn = cntIn > 0 ? sumIn / cntIn : 130;
    const meanRing = cntRing > 0 ? sumRing / cntRing : meanIn;
    const gain = clamp(meanRing / Math.max(1e-6, meanIn), 0.75, 1.25);

    // Compose RGBA
    const outRGBA = Buffer.alloc(W * H * 4);

    const shadowStrength = 0.38;
    const dx = Math.round(W * 0.006);
    const dy = Math.round(H * 0.012);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        const k3 = i * 3;
        const k4 = i * 4;

        // base = original
        let r = origFull[k3];
        let g = origFull[k3 + 1];
        let b = origFull[k3 + 2];

        // shadow sample with shift
        const xs = x - dx;
        const ys = y - dy;
        let sa = 0;
        if (xs >= 0 && xs < W && ys >= 0 && ys < H) {
          sa = shadowAlphaFull[ys * W + xs] / 255;
        }
        sa = sa * shadowStrength;

        r = Math.round(r * (1 - sa));
        g = Math.round(g * (1 - sa));
        b = Math.round(b * (1 - sa));

        // overlay = proposed with matched exposure
        const a = alphaFull[i] / 255;
        const pr = clamp(Math.round(propFull[k3] * gain), 0, 255);
        const pg = clamp(Math.round(propFull[k3 + 1] * gain), 0, 255);
        const pb = clamp(Math.round(propFull[k3 + 2] * gain), 0, 255);

        const outR = Math.round(r * (1 - a) + pr * a);
        const outG = Math.round(g * (1 - a) + pg * a);
        const outB = Math.round(b * (1 - a) + pb * a);

        outRGBA[k4] = outR;
        outRGBA[k4 + 1] = outG;
        outRGBA[k4 + 2] = outB;
        outRGBA[k4 + 3] = 255;
      }
    }

    // Subtle grain
    const grain = 5;
    for (let i = 0; i < W * H; i++) {
      const k4 = i * 4;
      const rnd = ((i * 1103515245 + 12345) >>> 0) % 65536;
      const n = (rnd / 65535 - 0.5) * grain * 2;
      outRGBA[k4] = clamp(Math.round(outRGBA[k4] + n), 0, 255);
      outRGBA[k4 + 1] = clamp(Math.round(outRGBA[k4 + 1] + n), 0, 255);
      outRGBA[k4 + 2] = clamp(Math.round(outRGBA[k4 + 2] + n), 0, 255);
    }

    const outPng = await sharp(outRGBA, { raw: { width: W, height: H, channels: 4 } })
      .png()
      .toBuffer();

    return new Response(outPng, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("Harmonize error", { status: 500 });
  }
}
