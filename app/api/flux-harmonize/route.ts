import { NextRequest } from "next/server";
import Replicate from "replicate";

export const runtime = "nodejs";

const replicate = new Replicate({
  auth: process.env.REPLICATE_API_TOKEN!,
});

export async function POST(req: NextRequest) {
  try {
    if (!process.env.REPLICATE_API_TOKEN) {
      return new Response("Missing REPLICATE_API_TOKEN", { status: 500 });
    }

    const { image, mask, prompt, steps, seed } = await req.json();

    if (!image || !mask || !prompt) {
      return new Response("Missing image/mask/prompt", { status: 400 });
    }

    const output = await replicate.run(
      "black-forest-labs/flux-fill-pro:9609ba7331ed872c99f81c92c69a9ee52a50d8aba99f636173e0674d997efd0c",
      {
        input: {
          image,
          mask,
          prompt,
          steps: typeof steps === "number" ? steps : 35,
          seed: typeof seed === "number" ? seed : undefined,
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
    return new Response("Flux harmonize error", { status: 500 });
  }
}
