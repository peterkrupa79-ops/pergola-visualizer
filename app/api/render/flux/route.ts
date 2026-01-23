import { NextRequest } from "next/server";
import Replicate from "replicate";

export const runtime = "nodejs";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

async function blobToDataUrl(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  const b64 = Buffer.from(ab).toString("base64");
  const mime = blob.type || "image/jpeg";
  return `data:${mime};base64,${b64}`;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Flux Dev + ControlNet (Canny) = drží geometriu (hrany) a pritom spraví AI harmonizáciu.
 * Model schema (verified): xlabs-ai/flux-dev-controlnet:56ac7b66... :contentReference[oaicite:1]{index=1}
 *
 * FormData:
 *  - image: Blob (input koláž / preblend)
 *  - prompt: string
 *  - strength (optional) -> mapujeme na image_to_image_strength (0..0.25 odporúčané)
 *  - guidance (optional) -> guidance_scale (max 5)
 *  - steps (optional) -> steps (1..50)
 */
export async function POST(req: NextRequest) {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return new Response("Missing REPLICATE_API_TOKEN", { status: 500 });
    }

    const fd = await req.formData();
    const image = fd.get("image");
    const prompt = String(fd.get("prompt") ?? "").trim();

    if (!(image instanceof Blob)) {
      return new Response("Missing image", { status: 400 });
    }
    if (!prompt) {
      return new Response("Missing prompt", { status: 400 });
    }

    // Optional knobs from client (safe defaults tuned for "AI look, keep placement")
    const strengthRaw = Number(fd.get("strength") ?? fd.get("prompt_strength") ?? "0.18");
    const guidanceRaw = Number(fd.get("guidance") ?? fd.get("guidance_scale") ?? "2.4");
    const stepsRaw = Number(fd.get("steps") ?? fd.get("num_inference_steps") ?? "24");

    // Keep the structure tightly:
    // - image_to_image_strength: 0..0.25 (higher = more change & more drift risk)
    const imageToImageStrength = clamp(strengthRaw, 0.10, 0.25);

    // guidance_scale: lower = less "plastic AI look"
    const guidanceScale = clamp(guidanceRaw, 1.6, 5);

    // steps: moderate
    const steps = clamp(Math.round(stepsRaw), 16, 32);

    const controlImage = await blobToDataUrl(image);

    // IMPORTANT:
    // - control_type = canny (locks edges)
    // - control_image = the same composite image (model does canny internally)
    // - image_to_image_strength uses the control image as the init image for img2img
    // Schema fields confirmed in Replicate version docs :contentReference[oaicite:2]{index=2}
    const output = await replicate.run(
      "xlabs-ai/flux-dev-controlnet:56ac7b66bd9a1b5eb7d15da5ac5625e4c8c9c5bc26da892caf6249cf38a611ed",
      {
        input: {
          prompt,
          negative_prompt:
            "floating, detached, misaligned, warped, extra columns, extra beams, broken perspective, cartoon, CGI, 3d render, lowres, blurry, artifacts",
          guidance_scale: guidanceScale,
          steps,
          control_type: "canny",
          control_strength: 0.55, // canny best ~0.5 per model notes :contentReference[oaicite:3]{index=3}
          control_image: controlImage,
          image_to_image_strength: imageToImageStrength, // 0..0.25 recommended :contentReference[oaicite:4]{index=4}
          return_preprocessed_image: false,
          output_format: "png",
          output_quality: 95,
        },
      }
    );

    // Output schema is array of URLs :contentReference[oaicite:5]{index=5}
    const outUrl =
      Array.isArray(output) && typeof output[0] === "string"
        ? (output[0] as string)
        : typeof output === "string"
          ? output
          : (output as any)?.output?.[0];

    if (!outUrl) {
      return new Response("Flux controlnet returned no output", { status: 500 });
    }

    return Response.json({
      outputUrl: outUrl,
      meta: {
        model: "xlabs-ai/flux-dev-controlnet (canny)",
        guidance_scale: guidanceScale,
        steps,
        image_to_image_strength: imageToImageStrength,
        control_strength: 0.55,
      },
    });
  } catch (e: any) {
    console.error(e);
    return new Response(`Flux render error: ${e?.message ?? "unknown"}`, { status: 500 });
  }
}
