import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";

export const runtime = "nodejs"; // dôležité: nodemailer nejde na edge

type LeadFields = {
  name?: string;
  email?: string;
  phone?: string;
  city?: string;
  note?: string;
  consent?: string; // "true"/"false"
  source?: string;  // napr. "pergola-editor"
  configJson?: string; // JSON string (voliteľné)
};

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function sanitize(s: string, maxLen = 5000) {
  return String(s ?? "").trim().slice(0, maxLen);
}

function isEmailLike(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    // --------- fields ----------
    const fields: LeadFields = {
      name: sanitize(form.get("name")?.toString() || "", 200),
      email: sanitize(form.get("email")?.toString() || "", 200),
      phone: sanitize(form.get("phone")?.toString() || "", 200),
      city: sanitize(form.get("city")?.toString() || "", 200),
      note: sanitize(form.get("note")?.toString() || "", 4000),
      consent: sanitize(form.get("consent")?.toString() || "", 10),
      source: sanitize(form.get("source")?.toString() || "pergola-editor", 100),
      configJson: sanitize(form.get("configJson")?.toString() || "", 100_000),
    };

    if (!fields.name) {
      return NextResponse.json({ ok: false, error: "Missing name" }, { status: 400 });
    }
    if (!fields.email || !isEmailLike(fields.email)) {
      return NextResponse.json({ ok: false, error: "Invalid email" }, { status: 400 });
    }
    if (fields.consent && !["true", "false", "1", "0", "yes", "no"].includes(fields.consent.toLowerCase())) {
      return NextResponse.json({ ok: false, error: "Invalid consent" }, { status: 400 });
    }

    // --------- PNG file ----------
    // Očakávame field name: "image"
    const image = form.get("image");
    if (!(image instanceof File)) {
      return NextResponse.json({ ok: false, error: "Missing PNG file (field: image)" }, { status: 400 });
    }

    const contentType = image.type || "";
    const filename = image.name || "teranea.png";

    if (!contentType.includes("png") && !filename.toLowerCase().endsWith(".png")) {
      return NextResponse.json({ ok: false, error: "Only PNG is supported" }, { status: 400 });
    }

    const bytes = Buffer.from(await image.arrayBuffer());

    // limit (napr. 8MB)
    const maxBytes = 8 * 1024 * 1024;
    if (bytes.length > maxBytes) {
      return NextResponse.json({ ok: false, error: "PNG is too large (max 8MB)" }, { status: 413 });
    }

    // --------- email compose ----------
    const to = "obchod@teranea.sk";
    const subject = `TERANEA lead – ${fields.name}${fields.city ? ` (${fields.city})` : ""}`;

    let configPretty = "";
    if (fields.configJson) {
      try {
        const parsed = JSON.parse(fields.configJson);
        configPretty = JSON.stringify(parsed, null, 2);
      } catch {
        // necháme ako raw string
        configPretty = fields.configJson;
      }
    }

    const textBody = [
      "Nový dopyt z TERANEA Pergola vizualizačného editora",
      "",
      `Meno: ${fields.name}`,
      `Email: ${fields.email}`,
      `Telefón: ${fields.phone || "-"}`,
      `Mesto: ${fields.city || "-"}`,
      `Súhlas (GDPR/marketing): ${fields.consent || "-"}`,
      `Zdroj: ${fields.source || "-"}`,
      "",
      "Poznámka:",
      fields.note || "-",
      "",
      "Konfigurácia (JSON):",
      configPretty || "-",
      "",
      "PNG vizualizácia je v prílohe.",
    ].join("\n");

    const htmlBody = `
      <h2>Nový dopyt z TERANEA Pergola vizualizačného editora</h2>
      <ul>
        <li><b>Meno:</b> ${escapeHtml(fields.name || "-")}</li>
        <li><b>Email:</b> ${escapeHtml(fields.email || "-")}</li>
        <li><b>Telefón:</b> ${escapeHtml(fields.phone || "-")}</li>
        <li><b>Mesto:</b> ${escapeHtml(fields.city || "-")}</li>
        <li><b>Súhlas (GDPR/marketing):</b> ${escapeHtml(fields.consent || "-")}</li>
        <li><b>Zdroj:</b> ${escapeHtml(fields.source || "-")}</li>
      </ul>
      <h3>Poznámka</h3>
      <pre style="white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(fields.note || "-")}</pre>
      <h3>Konfigurácia (JSON)</h3>
      <pre style="white-space:pre-wrap;font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">${escapeHtml(configPretty || "-")}</pre>
      <p><b>PNG vizualizácia</b> je v prílohe.</p>
    `;

    // --------- transporter ----------
    // Nastav v .env:
    // SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM
    const transporter = nodemailer.createTransport({
      host: requiredEnv("SMTP_HOST"),
      port: Number(requiredEnv("SMTP_PORT")),
      secure: Number(process.env.SMTP_PORT) === 465, // 465 = TLS
      auth: {
        user: requiredEnv("SMTP_USER"),
        pass: requiredEnv("SMTP_PASS"),
      },
    });

    const from = process.env.SMTP_FROM || "TERANEA <no-reply@teranea.sk>";

    await transporter.sendMail({
      from,
      to,
      replyTo: fields.email, // aby obchod mohol rovno odpovedať zákazníkovi
      subject,
      text: textBody,
      html: htmlBody,
      attachments: [
        {
          filename: filename.toLowerCase().endsWith(".png") ? filename : `${filename}.png`,
          content: bytes,
          contentType: "image/png",
        },
      ],
    });

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Lead submit error:", err);
    return NextResponse.json(
      { ok: false, error: "Internal error", detail: process.env.NODE_ENV === "development" ? String(err?.message || err) : undefined },
      { status: 500 }
    );
  }
}

function escapeHtml(input: string) {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
