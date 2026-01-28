import { NextResponse } from "next/server";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import crypto from "crypto";

export const runtime = "nodejs";


// ===== Cost / safety guards =====
const ALLOWED_SIZES = new Set(["1024x1024", "1024x1536", "1536x1024"]);
const ALLOWED_QUALITIES = new Set(["low", "medium"]);
const DEFAULT_QUALITY: "low" | "medium" = "medium";

// Hardened prompt suffix to reduce hallucinations / unwanted edits
const PROMPT_HARDEN_SUFFIX = [
  "Photorealistic, preserve the original background and architecture.",
  "Do NOT change the house/terrace geometry, camera viewpoint, lens perspective, or overall composition.",
  "Do NOT add or remove objects (no new furniture, plants, people, cars, lamps).",
  "Integrate ONLY the pergola from the provided image realistically (lighting, shadows, reflections).",
  "Do NOT alter the pergola's position/scale/rotation; keep it exactly where it is in the provided image.",
  "Avoid any frames, borders, picture-in-picture, duplicated images, seams, or collage artifacts."
].join(" ");

// Simple in-memory dedupe (prevents double-click / client retries from costing twice)
// Keyed by hash(image bytes + prompt + size + quality). TTL keeps memory bounded.
type CacheEntry = { ts: number; promise: Promise<string> };
const __dedupeCache: Map<string, CacheEntry> =
  (globalThis as any).__openaiImageDedupeCache || new Map<string, CacheEntry>();
(globalThis as any).__openaiImageDedupeCache = __dedupeCache;

function _sha256Hex(buf: Buffer | string) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function _pruneCache(now: number, ttlMs = 2 * 60 * 1000) {
  for (const [k, v] of __dedupeCache.entries()) {
    if (now - v.ts > ttlMs) __dedupeCache.delete(k);
  }
}

function _isTransientOpenAiError(err: any) {
  const status = err?.status ?? err?.response?.status ?? err?.cause?.status;
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

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

function detectImageSize(
  buf: Buffer,
  mime: string
): { width: number; height: number } | null {
  if (mime.includes("png")) return readPngSize(buf);
  if (mime.includes("jpeg") || mime.includes("jpg")) return readJpegSize(buf);
  return readPngSize(buf) || readJpegSize(buf);
}

function pickOpenAiSize(
  width: number,
  height: number
): "1024x1024" | "1024x1536" | "1536x1024" {
  const r = width / height;
  const candidates = [
    { size: "1024x1024" as const, ratio: 1 },
    { size: "1024x1536" as const, ratio: 1024 / 1536 },
    { size: "1536x1024" as const, ratio: 1536 / 1024 },
  ];

  let best = candidates[0];
  let bestDist = Math.abs(r - best.ratio);

  for (const c of candidates) {
    const d = Math.abs(r - c.ratio);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return best.size;
}

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get("image") as File | null;
    const prompt = (formData.get("prompt") as string | null) || "";
    const requestedQuality = (formData.get("quality") as string | null) || DEFAULT_QUALITY;

    if (!image) {
      return NextResponse.json({ error: "Missing image" }, { status: 400 });
    }

    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "Missing OPENAI_API_KEY" },
        { status: 500 }
      );
    }

    const buffer = Buffer.from(await image.arrayBuffer());
    const sizeInfo = detectImageSize(buffer, image.type || "");
    const chosenSize = sizeInfo
      ? pickOpenAiSize(sizeInfo.width, sizeInfo.height)
      : "1024x1024";

    // Guard: never allow unexpected sizes/qualities
    if (!ALLOWED_SIZES.has(chosenSize)) {
      return NextResponse.json({ error: `Invalid size: ${chosenSize}` }, { status: 400 });
    }

    const quality = (ALLOWED_QUALITIES.has(requestedQuality) ? requestedQuality : DEFAULT_QUALITY) as "low" | "medium";
    console.log("[render/openai] size=%s quality=%s inputBytes=%d", chosenSize, quality, buffer.length);


    const finalPrompt = (prompt ? prompt + " " : "") + PROMPT_HARDEN_SUFFIX;
    const inputBytes = buffer.length;

    const imgFile = await toFile(buffer, image.name || "collage.png", {
      type: image.type || "image/png",
    });

    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Dedupe key for this exact request
const now = Date.now();
_pruneCache(now);

const dedupeKey = _sha256Hex(
  buffer.toString("base64").slice(0, 4096) + // prefix to keep hashing cost bounded
    "|" +
    _sha256Hex(finalPrompt) +
    "|" +
    chosenSize +
    "|" +
    quality +
    "|" +
    "gpt-image-1"
);

const cached = __dedupeCache.get(dedupeKey);
if (cached) {
  const b64 = await cached.promise;
  return NextResponse.json({
    b64,
    meta: {
      input: sizeInfo || null,
      chosenSize,
      quality,
      inputBytes,
      deduped: true,
    },
  });
}

const doCall = async (q: "low" | "medium") => {
  const res = await openai.images.edit({
    model: "gpt-image-1",
    image: imgFile,
    prompt: finalPrompt,
    size: chosenSize,
    quality: q,
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("No image returned from OpenAI");
  }
  return b64;
};

const promise = (async () => {
  try {
    // Primary attempt
    return await doCall(quality);
  } catch (err: any) {
    // Adaptive fallback: on transient errors, retry once with "low" (cheaper and often faster)
    if (quality !== "low" && _isTransientOpenAiError(err)) {
      return await doCall("low");
    }
    throw err;
  }
})();

__dedupeCache.set(dedupeKey, { ts: now, promise });

const b64 = await promise;

if (!b64) {
  return NextResponse.json(
    { error: "No image returned from OpenAI" },
    { status: 500 }
  );
}

return NextResponse.json({
  b64,
  meta: {
    input: sizeInfo || null,
    chosenSize,
    quality,
    inputBytes,
    deduped: false,
  },
});
  } catch (err: any) {
    console.error("OpenAI render error:", err);
    return NextResponse.json(
      { error: err?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
