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

function percentile95Sampled(values01: Float32Array, sampleStride: number): number {
  const samples: number[] = [];
  for (let i = 0; i < values01.length; i += sampleStride) samples.push(values01[i]);
  samples.sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(samples.length - 1, Math.floor(samples.length * 0.95)));
  return samples[idx] ?? 0.1;
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

function dilateVertical(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      let any = 0;
      for (let yy = y0; yy <= y1; yy++) {
        if (bin[yy * w + x] === 1) {
          any = 1;
          break;
        }
      }
      out[y * w + x] = any;
    }
  }
  return out;
}

function opening(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return dilate(erode(bin, w, h, r), w, h, r);
}

function closing(bin: Uint8Array, w: number, h: number, r: number): Uint8Array {
  return erode(dilate(bin, w, h, r), w, h, r);
}

type Component = { area: number; sumX: number; sumY: number; pixels: number[] };

function largestComponent(bin: Uint8Array, w: number, h: number): Uint8Array {
  const visited = new Uint8Array(bin.length);
  let best: Component | null = null;
  const stack: number[] = [];

  for (let i = 0; i < bin.length; i++) {
    if (bin[i] === 0 || visited[i] === 1) continue;

    stack.length = 0;
    stack.push(i);
    visited[i] = 1;

    let area = 0;
    let sumX = 0;
    let sumY = 0;
    const pixels: number[] = [];

    while (stack.length) {
      const idx = stack.pop()!;
      pixels.push(idx);
      area++;

      const y = Math.floor(idx / w);
      const x = idx - y * w;
      sumX += x;
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

    if (!best) best = { area, sumX, sumY, pixels };
    else {
      const bestCenterYNorm = (best.sumY / Math.max(1, best.area)) / Math.max(1, h - 1);
      const bestScore = best.area * (0.7 + 0.3 * bestCenterYNorm);
      if (score > bestScore) best = { area, sumX, sumY, pixels };
    }
  }

  const out = new Uint8Array(bin.length);
  if (!best) return out;
  for (const idx of best.pixels) out[idx] = 1;
  return out;
}

function normU8(x: Uint8Array): Uint8Array {
  return Uint8Array.from(x);
}

async function fileToBuffer(file: File): Promise<Buffer> {
  const ab = await file.arrayBuffer();
  return Buffer.from(ab);
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return new Response("Missing REPLICATE_API_TOKEN", { status: 500 });
    }

    const form = await req.formData();
    const originalFile = form.get("original");
    const proposedFile = form.get("proposed");
    const prompt = String(form.get("prompt") ?? "");
    const steps = Number(form.get("steps") ?? 35);
    const seedRaw = form.get("seed");
    const seed = seedRaw === null ? undefined : Number(seedRaw);

    if (!(originalFile instanceof File) || !(proposedFile instanceof File)) {
      return new Response("Missing original/proposed files", { status: 400 });
    }
    if (!prompt) {
      return new Response("Missing prompt", { status: 400 });
    }

    const origBuf = await fileToBuffer(originalFile);
    const propBuf = await fileToBuffer(proposedFile);

    const origMeta = await sharp(origBuf).metadata();
    const W = origMeta.width ?? 0;
    const H = origMeta.height ?? 0;
    if (!W || !H) return new Response("Invalid original image", { status: 400 });

    // Work on a downscaled diff for speed
    const maxDim = 768;
    const scale = Math.min(1, maxDim / Math.max(W, H));
    const mw = Math.max(1, Math.round(W * scale));
    const mh = Math.max(1, Math.round(H * scale));

    const origSmall = await sharp(origBuf)
      .resize(mw, mh, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const propSmall = await sharp(propBuf)
      .resize(mw, mh, { fit: "fill" })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const o = origSmall.data;
    const p = propSmall.data;
    const n = mw * mh;

    const diff01 = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const k = i * 3;
      const dr = Math.abs(o[k] - p[k]);
      const dg = Math.abs(o[k + 1] - p[k + 1]);
      const db = Math.abs(o[k + 2] - p[k + 2]);
      diff01[i] = (dr + dg + db) / (3 * 255);
    }

    const sampleStride = clamp(Math.floor(n / 25000), 1, 50);
    const p95 = percentile95Sampled(diff01, sampleStride);
    const T = clamp(p95 * 0.35, 0.06, 0.16);

    let bin: Uint8Array = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = diff01[i] > T ? 1 : 0;

    const k1 = clamp(Math.round(Math.min(mw, mh) * 0.003), 2, 4);
    const k2 = clamp(Math.round(Math.min(mw, mh) * 0.01), 4, 10);

    bin = normU8(opening(bin, mw, mh, k1));
    bin = normU8(closing(bin, mw, mh, k2));
    bin = normU8(largestComponent(bin, mw, mh));

    const grow = clamp(Math.round(Math.min(mw, mh) * 0.02), 10, 40);
    bin = normU8(dilate(bin, mw, mh, grow));
    bin = normU8(dilateVertical(bin, mw, mh, Math.round(grow * 1.2)));

    const maskSmall255 = Buffer.alloc(n);
    for (let i = 0; i < n; i++) maskSmall255[i] = bin[i] ? 255 : 0;

    const sigma = clamp(Math.round(Math.min(mw, mh) * 0.008), 6, 20);

    const maskBuf = await sharp(maskSmall255, { raw: { width: mw, height: mh, channels: 1 } })
      .blur(sigma)
      .resize(W, H, { kernel: "lanczos3" })
      .png()
      .toBuffer();

    // Hard mask for compositing
    const hardMaskFull = await sharp(maskSmall255, { raw: { width: mw, height: mh, channels: 1 } })
      .resize(W, H, { kernel: "nearest" })
      .raw()
      .toBuffer();

    const origFull = await sharp(origBuf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const propFull = await sharp(propBuf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();

    const outFull = Buffer.alloc(origFull.length);
    for (let i = 0; i < W * H; i++) {
      const m = hardMaskFull[i] > 127;
      const k = i * 3;
      outFull[k] = m ? propFull[k] : origFull[k];
      outFull[k + 1] = m ? propFull[k + 1] : origFull[k + 1];
      outFull[k + 2] = m ? propFull[k + 2] : origFull[k + 2];
    }

    const compositeBuf = await sharp(outFull, { raw: { width: W, height: H, channels: 3 } })
      .png()
      .toBuffer();

    // Run Flux directly here (avoids huge client payloads)
    const output = await replicate.run(
      "black-forest-labs/flux-fill-pro:9609ba7331ed872c99f81c92c69a9ee52a50d8aba99f636173e0674d997efd0c",
      {
        input: {
          prompt,
          image: `data:image/png;base64,${compositeBuf.toString("base64")}`,
          mask: `data:image/png;base64,${maskBuf.toString("base64")}`,
          steps: Number.isFinite(steps) ? clamp(steps, 10, 50) : 35,
          seed: Number.isFinite(seed) ? seed : undefined,
        },
      }
    );

    const url =
      typeof output === "string"
        ? output
        : Array.isArray(output)
          ? (output[0] as string | undefined)
          : (output as any)?.output ?? (output as any)?.[0];

    if (!url || typeof url !== "string") {
      return new Response("Flux did not return an output URL", { status: 500 });
    }

    return Response.json({ outputUrl: url });
  } catch (e) {
    console.error(e);
    return new Response("Mask/Flux error", { status: 500 });
  }
}
