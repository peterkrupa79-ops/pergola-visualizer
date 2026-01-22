import { NextRequest } from "next/server";
import sharp from "sharp";
import path from "path";
import fs from "fs/promises";

export const runtime = "nodejs"; // dôležité pre sharp (nie edge)

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export async function POST(req: NextRequest) {
  try {
    const { imageUrl } = await req.json();

    if (!imageUrl || typeof imageUrl !== "string") {
      return new Response("Missing imageUrl", { status: 400 });
    }

    // 1) stiahni zdrojový obrázok
    const srcRes = await fetch(imageUrl);
    if (!srcRes.ok) {
      return new Response("Failed to fetch source image", { status: 400 });
    }
    const srcBuf = Buffer.from(await srcRes.arrayBuffer());

    // 2) načítaj logo z /public
    const logoPath = path.join(process.cwd(), "public", "brand", "logo.png");
    const logoBuf = await fs.readFile(logoPath);

    // 3) zisti rozmery zdrojového obrázka
    const srcMeta = await sharp(srcBuf).metadata();
    const srcW = srcMeta.width ?? 1024;

    // 4) dopočítaj veľkosť loga (napr. 10% šírky)
    const targetLogoW = clamp(Math.round(srcW * 0.10), 140, 320);
    const padding = srcW < 700 ? 16 : 24;

    const resizedLogo = await sharp(logoBuf)
      .resize({ width: targetLogoW, withoutEnlargement: true })
      .png()
      .toBuffer();

    // (voliteľné) jednoduchý tieň/kontrast cez SVG podklad
    const shadowPad = 8;
    const shadowSvg = Buffer.from(`
      <svg width="${targetLogoW + shadowPad * 2}" height="${targetLogoW + shadowPad * 2}">
        <filter id="ds" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="2" stdDeviation="3" flood-color="rgba(0,0,0,0.35)"/>
        </filter>
        <rect x="${shadowPad}" y="${shadowPad}" width="${targetLogoW}" height="${targetLogoW}" fill="transparent" filter="url(#ds)"/>
      </svg>
    `);

    // 5) overlay
    const outBuf = await sharp(srcBuf)
      .composite([
        {
          input: shadowSvg,
          top: padding - shadowPad,
          left: padding - shadowPad,
        },
        { input: resizedLogo, top: padding, left: padding },
      ])
      .png()
      .toBuffer();

    // ✅ FIX: Buffer -> ArrayBuffer pre Response (TS/Vercel kompatibilita)
    const outArrayBuffer = outBuf.buffer.slice(
      outBuf.byteOffset,
      outBuf.byteOffset + outBuf.byteLength
    );

    return new Response(outArrayBuffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    return new Response("Watermark error", { status: 500 });
  }
}
