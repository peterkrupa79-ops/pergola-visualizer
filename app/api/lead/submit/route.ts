import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs"; // dôležité pre nodemailer na Verceli

function getEnv(name: string) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json(
        { error: 'Content-Type must be "multipart/form-data".' },
        { status: 400 }
      );
    }

    const form = await req.formData();

    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const phone = String(form.get("phone") || "").trim();
    const city = String(form.get("city") || "").trim();
    const note = String(form.get("note") || "").trim();
    const consent = String(form.get("consent") || "").trim();
    const source = String(form.get("source") || "").trim();
    const configJson = String(form.get("configJson") || "").trim();

    const imageFile = form.get("image");

    if (!name || !email || !phone || !city) {
      return NextResponse.json(
        { error: "Missing required fields (name, email, phone, city)." },
        { status: 400 }
      );
    }

    if (!(imageFile instanceof File)) {
      return NextResponse.json(
        { error: "Missing image file (field name: image)." },
        { status: 400 }
      );
    }

    // --- SMTP config ---
    const SMTP_HOST = getEnv("SMTP_HOST");
    const SMTP_PORT = Number(getEnv("SMTP_PORT") || "465");
    const SMTP_USER = getEnv("SMTP_USER");
    const SMTP_PASS = getEnv("SMTP_PASS");

    // Pre istotu: FROM ako čistý email (bez mena)
    const SMTP_FROM = getEnv("SMTP_FROM") || SMTP_USER;

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      return NextResponse.json(
        { error: "Missing SMTP env vars (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS)." },
        { status: 500 }
      );
    }

    // 465 = SSL => secure: true
    // 587 = STARTTLS => secure: false (ale ty máš 465)
    const secure = SMTP_PORT === 465;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      // Niektoré hostingy majú prísne/čudné TLS; toto zvyčajne netreba,
      // ale ak by robilo TLS problémy, dá sa dočasne odblokovať:
      // tls: { rejectUnauthorized: false },
    });

    // Overenie pripojenia (pomôže v logoch)
    await transporter.verify();

    const pngArrayBuf = await imageFile.arrayBuffer();
    const pngBuffer = Buffer.from(pngArrayBuf);

    const subject = `TERANEA Lead – ${name} (${city})`;

    const text = [
      `Meno: ${name}`,
      `Mesto: ${city}`,
      `Telefón: ${phone}`,
      `Email: ${email}`,
      ``,
      `Poznámka / rozmery / variant:`,
      note || "-",
      ``,
      `Súhlas: ${consent || "-"}`,
      `Zdroj: ${source || "-"}`,
      ``,
      `Config JSON:`,
      configJson || "-",
    ].join("\n");

    // Kam posielame (fixne na obchod@teranea.sk)
    const to = "obchod@teranea.sk";

    await transporter.sendMail({
      from: SMTP_FROM,
      to,
      subject,
      text,
      replyTo: email, // aby obchod vedel odpísať priamo zákazníkovi
      attachments: [
        {
          filename: "vizualizacia.png",
          content: pngBuffer,
          contentType: "image/png",
        },
      ],
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Lead submit error:", err);
    return NextResponse.json(
      {
        error: err?.message || "Lead submit failed",
        code: err?.code || null,
        response: err?.response || null,
      },
      { status: 500 }
    );
  }
}
