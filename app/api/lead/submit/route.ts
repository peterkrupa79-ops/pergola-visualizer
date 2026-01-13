import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs"; // dôležité pre nodemailer na Verceli

function getEnv(name: string) {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : "";
}

function escapeHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function POST(req: NextRequest) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("multipart/form-data")) {
      return NextResponse.json({ error: 'Content-Type must be "multipart/form-data".' }, { status: 400 });
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
      return NextResponse.json({ error: "Missing required fields (name, email, phone, city)." }, { status: 400 });
    }

    if (!(imageFile instanceof File)) {
      return NextResponse.json({ error: "Missing image file (field name: image)." }, { status: 400 });
    }

    // --- SMTP config ---
    const SMTP_HOST = getEnv("SMTP_HOST");
    const SMTP_PORT = Number(getEnv("SMTP_PORT") || "465");
    const SMTP_USER = getEnv("SMTP_USER");
    const SMTP_PASS = getEnv("SMTP_PASS");
    const SMTP_FROM = getEnv("SMTP_FROM") || SMTP_USER;

    if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
      return NextResponse.json(
        { error: "Missing SMTP env vars (SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS)." },
        { status: 500 }
      );
    }

    // 465 = SSL => secure: true
    const secure = SMTP_PORT === 465;

    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
    });

    // Overenie pripojenia (pomôže v logoch)
    await transporter.verify();

    const pngArrayBuf = await imageFile.arrayBuffer();
    const pngBuffer = Buffer.from(pngArrayBuf);

    const subject = `TERANEA Lead – ${name} (${city})`;

    const text = [
      `TERANEA Lead`,
      ``,
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

    const safeName = escapeHtml(name);
    const safeEmail = escapeHtml(email);
    const safePhone = escapeHtml(phone);
    const safeCity = escapeHtml(city);
    const safeNote = escapeHtml(note || "-");
    const safeConsent = escapeHtml(consent || "-");
    const safeSource = escapeHtml(source || "-");

    // inline obrázok cez Content-ID
    const inlineCid = "vizualizacia@teranea";

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>TERANEA Lead</title>
  </head>
  <body style="margin:0;padding:0;background:#f6f6f6;font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Arial;">
    <div style="max-width:820px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid rgba(0,0,0,0.08);border-radius:16px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.06);">
        <div style="padding:18px 20px;border-bottom:1px solid rgba(0,0,0,0.06);background:linear-gradient(180deg,#111 0%,#222 100%);color:#fff;">
          <div style="font-weight:900;font-size:16px;letter-spacing:-0.01em;">TERANEA – nový dopyt</div>
          <div style="opacity:0.9;margin-top:4px;font-weight:650;font-size:13px;">Vizualizačný editor pergoly</div>
        </div>

        <div style="padding:18px 20px;">
          <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start;">
            <div style="flex:1 1 340px;min-width:280px;">
              <div style="font-weight:900;font-size:13px;color:rgba(0,0,0,0.65);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">
                Kontaktné údaje
              </div>

              <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:separate;border-spacing:0 8px;">
                <tr>
                  <td style="width:120px;color:rgba(0,0,0,0.55);font-weight:800;font-size:13px;">Meno</td>
                  <td style="color:#111;font-weight:800;font-size:14px;">${safeName}</td>
                </tr>
                <tr>
                  <td style="color:rgba(0,0,0,0.55);font-weight:800;font-size:13px;">Mesto</td>
                  <td style="color:#111;font-weight:800;font-size:14px;">${safeCity}</td>
                </tr>
                <tr>
                  <td style="color:rgba(0,0,0,0.55);font-weight:800;font-size:13px;">Telefón</td>
                  <td style="color:#111;font-weight:800;font-size:14px;">${safePhone}</td>
                </tr>
                <tr>
                  <td style="color:rgba(0,0,0,0.55);font-weight:800;font-size:13px;">Email</td>
                  <td style="color:#111;font-weight:800;font-size:14px;">${safeEmail}</td>
                </tr>
              </table>

              <div style="margin-top:14px;padding:12px 14px;border-radius:14px;border:1px solid rgba(0,0,0,0.08);background:rgba(0,0,0,0.02);">
                <div style="font-weight:900;font-size:12px;color:rgba(0,0,0,0.6);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">
                  Poznámka / rozmery / variant
                </div>
                <div style="white-space:pre-wrap;color:#111;font-weight:650;font-size:14px;line-height:1.45;">${safeNote}</div>
              </div>

              <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap;">
                <div style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,0.08);background:#fff;font-weight:800;font-size:12px;color:rgba(0,0,0,0.7);">
                  Súhlas: <span style="color:#111;">${safeConsent}</span>
                </div>
                <div style="padding:10px 12px;border-radius:999px;border:1px solid rgba(0,0,0,0.08);background:#fff;font-weight:800;font-size:12px;color:rgba(0,0,0,0.7);">
                  Zdroj: <span style="color:#111;">${safeSource}</span>
                </div>
              </div>
            </div>

            <div style="flex:1 1 360px;min-width:280px;">
              <div style="font-weight:900;font-size:13px;color:rgba(0,0,0,0.65);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:10px;">
                Náhľad vizualizácie
              </div>

              <div style="border:1px solid rgba(0,0,0,0.08);border-radius:16px;overflow:hidden;background:#fff;">
                <img src="cid:${inlineCid}" alt="Vizualizácia" style="display:block;width:100%;height:auto;" />
              </div>

              <div style="margin-top:10px;color:rgba(0,0,0,0.55);font-weight:650;font-size:12px;line-height:1.4;">
                Ak sa obrázok nezobrazí priamo v texte, nájdeš ho aj v prílohe <b>vizualizacia.png</b>.
              </div>
            </div>
          </div>

          ${
            configJson
              ? `<div style="margin-top:16px;padding:12px 14px;border-radius:14px;border:1px solid rgba(0,0,0,0.08);background:rgba(0,0,0,0.015);">
                  <div style="font-weight:900;font-size:12px;color:rgba(0,0,0,0.6);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px;">
                    Technické údaje (configJson)
                  </div>
                  <pre style="margin:0;white-space:pre-wrap;word-break:break-word;font-size:12px;line-height:1.45;color:rgba(0,0,0,0.85);font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;">${escapeHtml(
                    configJson
                  )}</pre>
                </div>`
              : ""
          }
        </div>

        <div style="padding:14px 20px;border-top:1px solid rgba(0,0,0,0.06);background:#fafafa;color:rgba(0,0,0,0.55);font-size:12px;font-weight:650;">
          Tento email bol odoslaný automaticky z vizualizačného editora TERANEA.
        </div>
      </div>
    </div>
  </body>
</html>`;

    // Kam posielame (fixne na obchod@teranea.sk)
    const to = "obchod@teranea.sk";

    await transporter.sendMail({
      from: SMTP_FROM, // odporúčam mať SMTP_FROM=obchod@teranea.sk
      to,
      subject,
      text,
      html,
      replyTo: email, // aby obchod vedel odpísať priamo zákazníkovi
      attachments: [
        // Inline obrázok (zobrazenie v HTML)
        {
          filename: "vizualizacia.png",
          content: pngBuffer,
          contentType: "image/png",
          cid: inlineCid,
          contentDisposition: "inline",
        },
        // Plus rovnaký obrázok aj ako klasická príloha (pre klientov, čo inline blokujú)
        {
          filename: "vizualizacia.png",
          content: pngBuffer,
          contentType: "image/png",
          contentDisposition: "attachment",
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
