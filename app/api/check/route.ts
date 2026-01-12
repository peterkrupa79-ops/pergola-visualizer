import { NextResponse } from "next/server";

export async function GET() {
  const hasOpenAI = !!process.env.OPENAI_API_KEY;
  const hasGemini = !!process.env.GEMINI_API_KEY;

  return NextResponse.json({
    ok: true,
    hasOpenAI,
    hasGemini,
  });
}
