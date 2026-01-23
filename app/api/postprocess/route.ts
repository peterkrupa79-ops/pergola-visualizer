import { NextRequest } from "next/server";
import sharp from "sharp";
import { randomFillSync } from "crypto";

export const runtime = "nodejs";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = (await req.json()) as { imageUrl?: string };

    if (!imageUrl || typeof imageUrl !== "string") {
      return new Response("Missing imageUrl", { status: 400 });
    }

    // Fetch source image (typically data: URL from client)
    const srcRes = await fetch(imageUrl);
    if (!srcRes.ok) {
      return new Response("Failed to fetch source image", { status: 400 });
    }

    const srcBuf = Buffer.from(await srcRes.arrayBuffer());

    const img = sharp(srcBuf);
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (!w || !h) {
      return new Response("Invalid image", { status: 400 });
    }

    // --- Subtle global grading to reduce "two photos" seam ---
    // Keep this VERY gentle to avoid changing geometry / details.
    const blurSigma = 0.55; // micro-soften to unify sharpness/noise differences
    const saturation = 0.985;
    const brightness = 1.0;

    // --- Add very light grain using overlay on mid-gray ---
    // Overlay with mid-gray does nothing; small noise around 128 adds texture.
    const grainOpacity = 0.065; // 0..1, keep low
    const amp = 18; // noise amplitude around mid-gray

    const noise = Buffer.alloc(w * h * 4);
    randomFillSync(noise);

    for (let i = 0; i < w * h; i++) {
      const r = noise[i * 4]; // 0..255
      const n = 128 + Math.round(((r / 255) * 2 - 1) * amp);
      const v = clamp(n, 0, 255);
      const k = i * 4;
      noise[k] = v;
      noise[k + 1] = v;
      noise[k + 2] = v;
      noise[k + 3] = Math.round(grainOpacity * 255);
    }

    const noisePng = await sharp(noise, { raw: { width: w, height: h, channels: 4 } })
      .png()
      .toBuffer();

    const outBuf = await sharp(srcBuf)
      .blur(blurSigma)
      .modulate({ saturation, brightness })
      .composite([{ input: noisePng, blend: "overlay" }])
      .png()
      .toBuffer();

    // IMPORTANT: Next.js Response typings don't like Buffer directly.
    return new Response(new Uint8Array(outBuf), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
        "X-Unify": "1",
      },
    });
  } catch (e) {
    return new Response("Postprocess error", { status: 500 });
  }
}

