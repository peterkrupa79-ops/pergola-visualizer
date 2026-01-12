import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("image") as File | null;

  if (!file) {
    return NextResponse.json({ ok: false, error: "Missing image" }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    filename: file.name,
    type: file.type,
    sizeBytes: file.size,
  });
}
