import { NextRequest } from "next/server";
import sharp from "sharp";

export const runtime = "nodejs";

/**
 * NON-AI harmonizácia (bez generovania):
 * - vytvorí masku pergoly z rozdielu (original vs proposed)
 * - vyberie najväčší blob
 * - vytvorí soft alpha (feather)
 * - pridá jemný tieň (blur + offset)
 * - zloží výsledok: original + shadow + proposed (cez alpha)
 *
 * Vstup: multipart/form-data
 *  - original: image/jpeg|png
 *  - proposed: image/jpeg|png
 * Výstup: image/png
 */

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

async function blobToBuffer(b: Blob): Promise<Buffer> {
  const ab = await b.arrayBuffer();
  return Buffer.from(ab);
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

    // preferuj väčšie + trochu nižšie v obraze
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

    const meta = await sharp(origBuf).metadata();
    const W0 = meta.width ?? 0;
    const H0 = meta.height ?? 0;
    if (!W0 || !H0) return new Response("Invalid original image", { status: 400 });

    // normalizuj navrh do rozmeru originalu
    const proposedPngFull = await sharp(propBuf).resize(W0, H0, { fit: "fill" }).png().toBuffer();

    // pracovné rozlíšenie na masku (rýchle)
    const MASK_MAX = 900;
    const scale = Math.min(1, MASK_MAX / Math.max(W0, H0));
    const W = Math.max(1, Math.round(W0 * scale));
    const H = Math.max(1, Math.round(H0 * scale));
    const n = W * H;

    const origRGB = await sharp(origBuf).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();
    const propRGB = await sharp(proposedPngFull).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer();

    // diff mapa
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

    let bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) bin[i] = diff01[i] > T ? 1 : 0;

    bin = largestComponent(bin, W, H);

    // sprav “mäkší” okraj (dilation + blur neskôr)
    const grow = clamp(Math.round(Math.min(W, H) * 0.02), 10, 35);
    bin = dilate(bin, W, H, grow);

    // alpha mask 0..255
    const alpha255Small = Buffer.alloc(n);
    for (let i = 0; i < n; i++) alpha255Small[i] = bin[i] ? 255 : 0;

    // feather
    const sigma = clamp(Math.round(Math.min(W, H) * 0.008), 6, 18);

    const alphaPngFull = await sharp(alpha255Small, { raw: { width: W, height: H, channels: 1 } })
      .blur(sigma)
      .resize(W0, H0, { kernel: "lanczos3" })
      .png()
      .toBuffer();

    // tieň: použijeme tú istú masku, posunieme ju mierne dole/ doprava a rozmažeme
    const shadowDx = Math.round(W0 * 0.002); // ~2px na 1000px
    const shadowDy = Math.round(H0 * 0.006); // trochu viac dole
    const shadowBlur = clamp(Math.round(Math.min(W0, H0) * 0.012), 10, 30);
    const shadowOpacity = 0.22; // jemné

    const shadowLayer = await sharp(alphaPngFull)
      .blur(shadowBlur)
      .linear(shadowOpacity, 0) // zníž intenzitu
      .png()
      .toBuffer();

    const origPngFull = await sharp(origBuf).resize(W0, H0, { fit: "fill" }).png().toBuffer();

    // zloženie:
    // 1) background original
    // 2) shadow (pod pergolou) s offsetom
    // 3) proposed pergola cez alpha mask (blend)
    const outPng = await sharp(origPngFull)
      .composite([
        { input: shadowLayer, left: shadowDx, top: shadowDy, blend: "over" },
        // proposed cez alpha: vytvoríme RGBA proposed + alpha
        {
          input: await sharp(proposedPngFull)
            .ensureAlpha()
            .composite([{ input: alphaPngFull, blend: "dest-in" }])
            .png()
            .toBuffer(),
          left: 0,
          top: 0,
          blend: "over",
        },
      ])
      .png()
      .toBuffer();

    // ✅ FIX: Response body nesmie byť Buffer (TS), použijeme Uint8Array
    return new Response(new Uint8Array(outPng), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    console.error(e);
    return new Response("Mask harmonize error", { status: 500 });
  }
}
