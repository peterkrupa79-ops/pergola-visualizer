import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";

export const runtime = "nodejs";

function readPngSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 24) return null;
  const sig = buf.subarray(0, 8);
  const pngSig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!sig.equals(pngSig)) return null;
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

function readJpegSize(buf: Buffer): { width: number; height: number } | null {
  if (buf.length < 4) return null;
  if (buf[0] !== 0xff || buf[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 4 < buf.length) {
    if (buf[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    const marker = buf[offset + 1];
    offset += 2;

    // EOI / SOS
    if (marker === 0xd9 || marker === 0xda) break;

    if (offset + 2 > buf.length) break;
    const len = buf.readUInt16BE(offset);
    if (len < 2) break;

    const isSOF =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);

    if (isSOF) {
      const height = buf.readUInt16BE(offset + 3);
      const width = buf.readUInt16BE(offset + 5);
      if (!width || !height) return null;
      return { width, height };
    }

    offset += len;
  }

  return null;
}

function detectImageSize(buf: Buffer, mime: string): { width: number; height: number } | null {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return readPngSize(buf);
  if (m.includes("jpeg") || m.includes("jpg")) return readJpegSize(buf);
  return readPngSize(buf) || readJpegSize(buf);
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get("image");

    // prompt je voliteľný (ale odporúčam posielať vždy)
    const prompt = (formData.get("prompt") as string | null) || "";

    if (!(image instanceof File)) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const sizeInfo = detectImageSize(buffer, image.type || "");

    // Pozn.: GPT image modely akceptujú png/webp/jpg < 50MB (edits endpoint). :contentReference[oaicite:2]{index=2}
    const imgFile = await toFile(buffer, image.name || "patch.jpg", {
      type: image.type || "image/jpeg",
    });

    const openai = new OpenAI({ apiKey });

    const res = await openai.images.edit({
      // modely podporované na /images/edits: gpt-image-1, gpt-image-1-mini, gpt-image-1.5 :contentReference[oaicite:3]{index=3}
      model: "gpt-image-1.5",
      image: imgFile,
      prompt,
      size: "auto",          // CRITICAL: zachová pomer strán vstupu :contentReference[oaicite:4]{index=4}
      output_format: "png",   // bezpečné pre ďalší compositing
      quality: "high",        // podporované pre GPT image modely :contentReference[oaicite:5]{index=5}
      // background: "auto",  // voliteľné
      // n: 1,               // voliteľné, default je 1
    });

    const b64 = res.data?.[0]?.b64_json;
    if (!b64) {
      return NextResponse.json({ error: "No image returned from OpenAI" }, { status: 500 });
    }

    return NextResponse.json({
      b64,
      meta: {
        input: sizeInfo || null,
        size: "auto",
      },
    });
  } catch (err: any) {
    console.error("OpenAI render error:", err);
    return NextResponse.json(
      {
        error: err?.message || "Unknown error",
        // pre debug je často užitočné vidieť aj kód/typ, ak existuje
        code: err?.code || null,
        type: err?.type || null,
      },
      { status: 500 }
    );
  }
}
