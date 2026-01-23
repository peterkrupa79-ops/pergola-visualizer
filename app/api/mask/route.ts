import { NextRequest } from "next/server";
import sharp from "sharp";
import Replicate from "replicate";

export const runtime = "nodejs";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function normU8(x: Uint8Array): Uint8Array {
  return Uint8Array.from(x);
}

function erode(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w - 1, x + r);
      let ok = 1;
      for (let yy = y0; yy <= y1 && ok; yy++) {
        const row = yy * w;
        for (let xx = x0; xx <= x1; xx++) {
          if (bin[row + xx] === 0) {
            ok = 0;
            break;
          }
        }
      }
      out[y * w + x] = ok;
    }
  }
  return out;
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

function percentile95Sampled(values01: Float32Array, sampleStride: number): number {
  const samples: number[] = [];
  for (let i = 0; i < values01.length; i += sampleStride) samples.push(values01[i]);
  samples.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(samples.length - 1, Math.floor(samples.length * 0.95)));
  return samples[idx] ?? 0.1;
}

async function blobToBuffer(b: Blob): Promise<Buffer> {
  const ab = await b.arrayBuffer();
  return Buffer.from(ab);
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return new Response("Missing REPLICATE_API_TOKEN", { status: 500 });
    }

    const fd = await req.formData();
    const original = fd.get("original");
    const proposed = fd.get("proposed");
    const prompt = String(fd.get("prompt") ?? "").trim();

    if (!(original instanceof Blob) || !(proposed instanceof Blob)) {
      return new Response("Missing original/proposed files", { status: 400 });
    }
    if (!prompt) {
      return new Response("Missing prompt", { status: 400 });
    }

    const origBuf = await blobToBuffer(original);
    const propBuf = await blobToBuffer(proposed);

    const origMeta = await sharp(origBuf).metadata();
    const W0 = origMeta.width ?? 0;
    const H0 = origMeta.height ?? 0;
    if (!W0 || !H0) return new Response("Invalid original image", { status: 400 });

    const MAX_DIM = 1400;
    const scale = Math.min(1, MAX_DIM / Math.max(W0, H0));
    const W = Math.max(1, Math.round(W0 * scale));
    const H = Math.max(1, Math.round(H0 * scale));

    const origRGB = await sharp(origBuf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const propRGB = await sharp(propBuf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();

    const n = W * H;

    const diff01 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const dr = Math.abs(origRGB[k] - propRGB[k]);
      const dg = Math.abs(origRGB[k + 1] - propRGB[k + 1]);
      const db = Math.abs(origRGB[k + 2] - propRGB[k + 2]);
      diff01[i] = (dr + dg + db) / (3 * 255);
    }

    const sampleStride = clamp(Math.floor(n / 25000), 1, 50);
    const p95 = percentile95Sampled(diff01, sampleStride);
    const T = clamp(p95 * 0.35, 0.06, 0.16);

    let bin: Uint8Array = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = diff01[i] > T ? 1 : 0;

    // ✅ TS fix: normalize after ops
    bin = normU8(largestComponent(bin, W, H));

    const outerR = clamp(Math.round(Math.min(W, H) * 0.03), 12, 55);
    const innerR = clamp(Math.round(Math.min(W, H) * 0.012), 6, 28);

    const outer = normU8(dilate(bin, W, H, outerR));
    const inner = normU8(erode(bin, W, H, innerR));

    const ring = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      ring[i] = outer[i] === 1 && inner[i] === 0 ? 1 : 0;
    }

    // shadow strip
    const shadowR = clamp(Math.round(Math.min(W, H) * 0.02), 10, 40);
    const below = new Uint8Array(n);
    for (let y = 1; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const aboveIdx = (y - 1) * W + x;
        below[idx] = bin[aboveIdx] ? 1 : 0;
      }
    }
    const shadow = normU8(dilate(below, W, H, shadowR));

    for (let i = 0; i < n; i++) ring[i] = ring[i] || shadow[i] ? 1 : 0;

    const mask255 = Buffer.alloc(n);
    for (let i = 0; i < n; i++) mask255[i] = ring[i] ? 255 : 0;

    const sigma = clamp(Math.round(Math.min(W, H) * 0.004), 2, 10);

    const maskPng = await sharp(mask255, { raw: { width: W, height: H, channels: 1 } })
      .blur(sigma)
      .png()
      .toBuffer();

    const proposedPng = await sharp(propBuf).resize(W, H, { fit: "fill" }).png().toBuffer();

    const imageDataUri = `data:image/png;base64,${proposedPng.toString("base64")}`;
    const maskDataUri = `data:image/png;base64,${maskPng.toString("base64")}`;

    const output = await replicate.run(
      "black-forest-labs/flux-fill-pro:9609ba7331ed872c99f81c92c69a9ee52a50d8aba99f636173e0674d997efd0c",
      {
        input: {
          image: imageDataUri,
          mask: maskDataUri,
          prompt,
          steps: 28,
        },
      }
    );

    const outUrl =
      typeof output === "string"
        ? output
        : Array.isArray(output)
          ? (output[0] as string | undefined)
          : (output as any)?.output ?? (output as any)?.[0];

    if (!outUrl || typeof outUrl !== "string") {
      return new Response("Flux did not return an output URL", { status: 500 });
    }

    return Response.json({ outputUrl: outUrl });
  } catch (e) {
    console.error(e);
    return new Response("Mask/Flux error", { status: 500 });
  }
}
