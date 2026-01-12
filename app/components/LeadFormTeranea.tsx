"use client";

import React, { useMemo, useState } from "react";

type LeadFormTeraneaProps = {
  /**
   * Funkcia, ktorá vráti PNG ako Blob (image/png).
   * - Ak už vo svojom editore vieš vyrobiť PNG (napr. z canvasu), napoj to sem.
   */
  getPngBlob: () => Promise<Blob>;

  /**
   * Voliteľne: objekt konfigurácie, ktorý chceš poslať spolu s formulárom
   * (uloží sa ako JSON do field-u configJson).
   */
  config?: any;

  /**
   * Voliteľne: predvyplnené mesto alebo iné údaje.
   */
  defaultCity?: string;
};

export default function LeadFormTeranea(props: LeadFormTeraneaProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [city, setCity] = useState(props.defaultCity ?? "");
  const [note, setNote] = useState("");
  const [consent, setConsent] = useState(false);

  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string>("");

  const canSubmit = useMemo(() => {
    return name.trim().length > 1 && email.trim().length > 3;
  }, [name, email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setErrorMsg("");

    try {
      // 1) zober PNG Blob z editora
      const pngBlob = await props.getPngBlob();

      // 2) poskladaj FormData
      const fd = new FormData();
      fd.append("name", name);
      fd.append("email", email);
      fd.append("phone", phone);
      fd.append("city", city);
      fd.append("note", note);
      fd.append("consent", consent ? "true" : "false");
      fd.append("source", "pergola-editor");

      if (props.config !== undefined) {
        fd.append("configJson", JSON.stringify(props.config));
      }

      // 3) dôležité: PNG musí ísť ako súbor v poli "image"
      fd.append("image", pngBlob, "vizualizacia.png");

      // 4) fetch BEZ nastavovania Content-Type!
      // (prehliadač si sám nastaví multipart/form-data s boundary)
      const res = await fetch("/api/lead/submit", {
        method: "POST",
        body: fd,
      });

      let data: any = null;
      try {
        data = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok) {
        const msg = data?.error || data?.detail || `Server error (${res.status})`;
        throw new Error(msg);
      }

      setStatus("success");
    } catch (err: any) {
      setStatus("error");
      setErrorMsg(String(err?.message || err));
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12, maxWidth: 520 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label>Meno*</label>
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Meno a priezvisko" />
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label>E-mail*</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} required type="email" placeholder="email@domena.sk" />
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label>Telefón</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+421..." />
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label>Mesto</label>
        <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Prešov" />
      </div>

      <div style={{ display: "grid", gap: 6 }}>
        <label>Poznámka</label>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Čokoľvek doplňujúce…" rows={4} />
      </div>

      <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        Súhlasím so spracovaním údajov (GDPR)
      </label>

      <button type="submit" disabled={!canSubmit || status === "sending"} style={{ padding: "10px 14px" }}>
        {status === "sending" ? "Odosielam…" : "Odoslať dopyt"}
      </button>

      {status === "success" && (
        <div style={{ padding: 10, border: "1px solid #2b8a3e", borderRadius: 8 }}>
          ✅ Formulár bol odoslaný.
        </div>
      )}

      {status === "error" && (
        <div style={{ padding: 10, border: "1px solid #c92a2a", borderRadius: 8 }}>
          ❌ Nepodarilo sa odoslať formulár: <b>{errorMsg}</b>
        </div>
      )}
    </form>
  );
}
