import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export const runtime = "nodejs";

/**
 * POST /api/render/gemini
 * FormData:
 * - image: File (collage.png)
 * - prompt: string
 * Returns JSON:
 * - { ok: true, b64: string }
 * - { ok: false, error: string }
 */
export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const image = form.get("image") as File | null;
    const prompt = (form.get("prompt") as string) || "";

    if (!image) {
      return NextResponse.json(
        { ok: false, error: "Missing image" },
        { status: 400, headers: { "Cache-Control": "no-store" } }
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing GEMINI_API_KEY" },
        { status: 500, headers: { "Cache-Control": "no-store" } }
      );
    }

    const modelName = process.env.GEMINI_MODEL || "gemini-1.5-flash";

    const buf = Buffer.from(await image.arrayBuffer());
    const b64in = buf.toString("base64");
    const mime = image.type || "image/png";

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: modelName });

    // POZNÁMKA:
    // Nie každý Gemini model vracia obrázok ako base64 v "inlineData".
    // Táto route je postavená tak, že ak model vráti text, alebo nič, vráti JSON error (nie crash).
    const result = await model.generateContent([
      {
        inlineData: {
          data: b64in,
          mimeType: mime,
        },
      },
      prompt,
    ]);

    const resp = result.response;

    // Skúsime nájsť inline image v candidates
    const candidates: any[] = (resp as any).candidates || [];
    for (const c of candidates) {
      const parts: any[] = c?.content?.parts || [];
      for (const p of parts) {
        const data = p?.inlineData?.data;
        const mt = p?.inlineData?.mimeType;
        if (data && typeof data === "string" && (mt?.startsWith("image/") || true)) {
          return NextResponse.json(
            { ok: true, b64: data, meta: { model: modelName } },
            { status: 200, headers: { "Cache-Control": "no-store" } }
          );
        }
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error:
          `Gemini model '${modelName}' nevrátil image inlineData. ` +
          `Nastav GEMINI_MODEL na model, ktorý podporuje generovanie obrázkov/edity, alebo použi OpenAI.`,
      },
      { status: 502, headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    console.error("Gemini render error:", err);
    return NextResponse.json(
      { ok: false, error: err?.message || "Unknown error" },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
