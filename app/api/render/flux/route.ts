import { NextRequest } from "next/server";
import Replicate from "replicate";

export const runtime = "nodejs";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

function stripDataUri(s: string) {
  const i = s.indexOf("base64,");
  return i >= 0 ? s.slice(i + "base64,".length) : s;
}

export async function POST(req: NextRequest) {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return new Response(JSON.stringify({ error: "Missing REPLICATE_API_TOKEN" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const form = await req.formData();
    const image = form.get("image");
    const prompt = String(form.get("prompt") ?? "").trim();

    if (!(image instanceof Blob)) {
      return new Response(JSON.stringify({ error: "Missing image" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!prompt) {
      return new Response(JSON.stringify({ error: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Convert input image to data URI (Replicate accepts data URIs or URLs)
    const ab = await image.arrayBuffer();
    const b64 = Buffer.from(ab).toString("base64");
    const mime = image.type || "image/jpeg";
    const dataUri = `data:${mime};base64,${b64}`;

    // Flux Dev supports image-to-image via `image` + `prompt_strength` (lower = closer to input).
    // We keep this conservative to preserve user placement from the collage.
    const output = await replicate.run("black-forest-labs/flux-dev", {
      input: {
        prompt,
        image: dataUri,
        prompt_strength: 0.2,
      },
    });

    const outUrl =
      typeof output === "string"
        ? output
        : Array.isArray(output)
          ? (output[0] as string | undefined)
          : (output as any)?.output ?? (output as any)?.[0];

    if (!outUrl || typeof outUrl !== "string") {
      return new Response(JSON.stringify({ error: "Flux did not return an output URL" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch output and return as base64 PNG (same contract as previous OpenAI route)
    const imgRes = await fetch(outUrl);
    if (!imgRes.ok) {
      return new Response(JSON.stringify({ error: "Failed to fetch Flux output" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const outAb = await imgRes.arrayBuffer();
    const outB64 = Buffer.from(outAb).toString("base64");

    return new Response(JSON.stringify({ b64: stripDataUri(outB64) }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(JSON.stringify({ error: e?.message || "Flux render error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

