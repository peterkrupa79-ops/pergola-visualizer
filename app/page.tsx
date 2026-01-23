// ===== page.tsx (časť 1/5) =====
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type PergolaType = "bioklim" | "pevna" | "zimna";
type Mode = "move" | "rotate3d" | "roll" | "resize";
type Vec2 = { x: number; y: number };

type HandleId = "nw" | "ne" | "se" | "sw";
const HANDLE_R = 9;
const HANDLE_HIT = 18;

const SCALE_STEP = 0.5;
const SCALE_MIN = 1;
const SCALE_MAX = 200;

// auto-normalizácia veľkosti GLB (štartná veľkosť pri 100%)
const TARGET_MODEL_MAX_DIM_AT_100 = 1.7;

// --- Prompting (stabilná poloha bez maskovania) ---
// Pozn.: model dostáva "collage" (foto + 3D pergola). Prompt má striktne harmonizovať a NESMIE meniť polohu/perpektívu.
const FINAL_PROMPT_BASE = `HARMONIZE ONLY. Keep the exact original geometry and perspective from the input collage image.
Do NOT move/shift/translate the pergola forward/backward/sideways. Keep it exactly where it is in the collage.
Do NOT change the pergola shape, size, thickness, leg width, proportions, spacing, angle, or any structural details.
Do NOT add/remove objects. Do NOT crop. Do NOT change camera position, lens, viewpoint, rotation, or zoom.
Ensure the pergola looks architecturally connected and naturally integrated with the existing building and terrace as shown in the photo.
Align with terrace edges and the scene perspective lines as they appear in the collage.
Only adjust lighting, shadows, reflections, color grading, noise, sharpness, and blending so the pergola looks photo-realistic in the scene.

Avoid: floating, detached, standalone, hovering, levitating, sticker look, cut-out look, 3D render look, warped perspective, tilted camera, extra columns/posts, duplicated beams, exaggerated scale.`;

function pergolaStyleBlock(t: PergolaType) {
  if (t === "bioklim") {
    return `Style: modern bioclimatic pergola with clean straight lines, realistic materials, crisp but natural details.`;
  }
  if (t === "pevna") {
    return `Style: fixed-roof pergola with clean straight lines, realistic construction and materials.`;
  }
  return `Style: winter garden enclosure with sloped roof, realistic glass reflections consistent with the scene, subtle frames, natural integration.`;
}

// A/B "anchor" variants: 0-2 wall-first, 3-5 edge-first (pre 6 variantov)
function anchorBlock(variantIndex: number) {
  const i = (variantIndex ?? 0) % 6;
  if (i < 3) {
    return `Anchor: the pergola is attached to the house facade/wall as shown in the collage. The roof starts at the wall line and extends outward over the terrace.`;
  }
  return `Anchor: the pergola footprint follows the terrace boundary and aligns with the terrace edges as shown in the collage. Posts sit naturally on the terrace surface where they support the roof.`;
}

function buildFinalPrompt(t: PergolaType, variantIndex: number) {
  return [
    FINAL_PROMPT_BASE,
    anchorBlock(variantIndex),
    pergolaStyleBlock(t),
    `Keep the pergola modest in size as shown (do not enlarge it). Leave visible terrace space around it if present in the collage.`
  ].join("\n\n");
}



const MAX_VARIANTS = 6;

// ===== Hero krokový návod (rozbaľ v mobile) =====
const HERO_STEPS: { id: number; title: string; hint: string }[] = [
  {
    id: 1,
    title: "Nahraj fotku",
    hint:
      "Nahraj fotku terasy alebo domu (JPG/PNG). Ideálne z výšky očí alebo mierne zboku a tak, aby na fotke bolo vidno čo najviac okolia (nie len miesto tesne pri pergole). Viac priestoru na fotke pomôže mierke a perspektíve.",
  },
  {
    id: 2,
    title: "Umiestni pergolu",
    hint:
      "Vyber typ pergoly, posuň ju do fotky, otoč alebo nakloň a nastav rozmery. Voliteľne otvor Perspektíva a dolaď horizont a hĺbku pohľadu podľa fotky. Tip: nastav pergolu radšej trochu menšiu, AI ju vo výsledku často mierne zväčší.",
  },
  {
    id: 3,
    title: "Vygeneruj vizualizácie",
    hint:
      "Klikni na Vygenerovať a nechaj AI vytvoriť varianty. AI doladí svetlo, tiene a celkový vzhľad, aby pergola pôsobila prirodzene. Je to pomôcka pre predstavu, AI môže občas domýšľať alebo dokresľovať detaily.",
  },
  {
    id: 4,
    title: "Odošli dopyt a stiahni PNG",
    hint:
      "Vyber najlepší variant a vyplň krátky formulár, aby sa odomklo sťahovanie. Po odoslaní si môžeš stiahnuť PNG a pridať poznámku k požiadavke, aby sme vedeli pripraviť ďalší postup.",
  },
];

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
function dist(a: Vec2, b: Vec2) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}
function roundToStep(v: number, step = SCALE_STEP) {
  return Math.round(v / step) * step;
}
function clampPct(v: number) {
  return clamp(roundToStep(v), SCALE_MIN, SCALE_MAX);
}
function isValidEmail(email: string) {
  const s = email.trim();
  if (!s) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
function typeLabel(t: PergolaType) {
  if (t === "bioklim") return "Bioklimatická pergola";
  if (t === "pevna") return "Pergola s pevnou strechou";
  return "Zimná záhrada";
}
function makeId() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}
async function b64PngToBlob(b64: string): Promise<Blob> {
  const r = await fetch(`data:image/png;base64,${b64}`);
  return await r.blob();
}

async function blobToB64Png(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = "";
  // chunk to avoid call stack issues
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

async function canvasToJpegBlobAtMaxDim(canvas: HTMLCanvasElement, maxDim: number, quality: number): Promise<Blob> {
  const w = canvas.width;
  const h = canvas.height;
  const s = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s));
  const th = Math.max(1, Math.round(h * s));

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(canvas, 0, 0, tw, th);

  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob returned null"))), "image/jpeg", quality)
  );
  return blob;
}

async function b64PngToJpegBlobAtMaxDim(b64Png: string, maxDim: number, quality: number): Promise<Blob> {
  const bmp = await _b64ToImageBitmap(b64Png);
  const w = bmp.width;
  const h = bmp.height;
  const s = Math.min(1, maxDim / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s));
  const th = Math.max(1, Math.round(h * s));

  const c = document.createElement("canvas");
  c.width = tw;
  c.height = th;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp as any, 0, 0, tw, th);

  const blob: Blob = await new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("toBlob returned null"))), "image/jpeg", quality)
  );
  return blob;
}


// Adds a small brand logo into the top-left corner AFTER generation (stable watermark, no prompt tricks).
async function watermarkB64Png(b64: string): Promise<string> {
  try {
    const imageUrl = `data:image/png;base64,${b64}`;
    const res = await fetch("/api/watermark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl }),
    });
    if (!res.ok) return b64;
    const blob = await res.blob();
    return await blobToB64Png(blob);
  } catch {
    return b64;
  }
}


async function canvasToB64Png(canvas: HTMLCanvasElement): Promise<string> {
  const blob: Blob = await new Promise((res, rej) =>
    canvas.toBlob((b) => (b ? res(b) : rej(new Error("canvas.toBlob returned null"))), "image/png")
  );
  return await blobToB64Png(blob);
}

async function fetchUrlToB64Png(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Failed to fetch Flux output: HTTP ${r.status}`);
  const buf = await r.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function buildFluxPrompt(t: PergolaType, variantIndex: number) {
  return [
    `Harmonize the existing pergola structure naturally into the photograph.`,
    `Preserve the exact position, size, perspective and orientation of the pergola. Do NOT move, resize, rotate or redesign the structure.`,
    `Improve realism only: lighting, shadows, natural contact with terrace and house wall, realistic materials and details, photographic color balance.`,
    `Keep the original camera position, perspective and composition unchanged (no crop, no rotation, no zoom).`,
    anchorBlock(variantIndex),
    pergolaStyleBlock(t),
    `Photorealistic result, looks like a real photo. Avoid floating/detached/hovering. No extra columns or beams.`,
  ].join("\n");
}

async function fluxHarmonize({
  compositeB64,
  maskB64,
  prompt,
  seed,
  steps = 35,
}: {
  compositeB64: string;
  maskB64: string;
  prompt: string;
  seed?: number;
  steps?: number;
}): Promise<string> {
  const r = await fetch("/api/flux-harmonize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      image: `data:image/png;base64,${compositeB64}`,
      mask: `data:image/png;base64,${maskB64}`,
      prompt,
      seed,
      steps,
    }),
  });

  const j = await r.json().catch(async () => {
    const t = await r.text().catch(() => "");
    return { error: t || `HTTP ${r.status}` };
  });

  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);

  const outputUrl = j?.outputUrl as string | undefined;
  if (!outputUrl) throw new Error("Flux API nevrátilo outputUrl.");

  return await fetchUrlToB64Png(outputUrl);
}



// --- AI alignment helpers (keeps photorealistic output but recenters pergola to the exact user placement) ---
type EdgeTemplate = { w: number; h: number; pts: Array<[number, number]>; maxShift: number };

function _clampInt(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n | 0));
}

function _b64ToImageBitmap(b64: string): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async () => {
      try {
        // @ts-ignore
        const bmp: ImageBitmap = await createImageBitmap(img);
        resolve(bmp);
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Nepodarilo sa dekódovať PNG."));
    img.src = `data:image/png;base64,${b64}`;
  });
}

function _canvasToB64Png(c: HTMLCanvasElement): string {
  const d = c.toDataURL("image/png");
  const comma = d.indexOf(",");
  return comma >= 0 ? d.slice(comma + 1) : d;
}

function _makeEdgeTemplateFromDiff(bg: HTMLCanvasElement, collage: HTMLCanvasElement, targetW = 256): EdgeTemplate {
  const w = collage.width;
  const h = collage.height;

  const scale = Math.min(1, targetW / Math.max(w, h));
  const sw = Math.max(32, Math.round(w * scale));
  const sh = Math.max(32, Math.round(h * scale));

  const a = document.createElement("canvas");
  a.width = sw; a.height = sh;
  const actx = a.getContext("2d")!;
  actx.drawImage(bg, 0, 0, sw, sh);
  const bgData = actx.getImageData(0, 0, sw, sh).data;

  actx.clearRect(0, 0, sw, sh);
  actx.drawImage(collage, 0, 0, sw, sh);
  const colData = actx.getImageData(0, 0, sw, sh).data;

  // diff mask
  const mask = new Uint8Array(sw * sh);
  const thr = 28; // per-channel diff threshold
  for (let i = 0, p = 0; p < sw * sh; p++, i += 4) {
    const dr = Math.abs(colData[i] - bgData[i]);
    const dg = Math.abs(colData[i + 1] - bgData[i + 1]);
    const db = Math.abs(colData[i + 2] - bgData[i + 2]);
    // strong change likely belongs to pergola render
    mask[p] = (dr + dg + db) / 3 > thr ? 1 : 0;
  }

  // edge points from mask
  const pts: Array<[number, number]> = [];
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const idx = y * sw + x;
      if (!mask[idx]) continue;
      // edge if any neighbor is 0
      if (
        !mask[idx - 1] || !mask[idx + 1] ||
        !mask[idx - sw] || !mask[idx + sw]
      ) {
        pts.push([x, y]);
      }
    }
  }

  // max shift in downscaled pixels
  const maxShift = Math.round(Math.min(sw, sh) * 0.14); // ~14% of shorter side
  return { w: sw, h: sh, pts, maxShift: Math.max(10, Math.min(70, maxShift)) };
}

function _edgeMapFromImageBitmap(bmp: ImageBitmap, w: number, h: number): Uint8Array {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const e = new Uint8Array(w * h);

  // simple gradient magnitude on luminance
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; p < w * h; p++, i += 4) {
    lum[p] = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) | 0;
  }
  const thr = 26;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const p = y * w + x;
      const gx = (lum[p + 1] - lum[p - 1]) + (lum[p + 1 + w] - lum[p - 1 + w]) + (lum[p + 1 - w] - lum[p - 1 - w]);
      const gy = (lum[p + w] - lum[p - w]) + (lum[p + w + 1] - lum[p - w + 1]) + (lum[p + w - 1] - lum[p - w - 1]);
      const mag = Math.abs(gx) + Math.abs(gy);
      e[p] = mag > thr ? 1 : 0;
    }
  }
  return e;
}

function _estimateShift(template: EdgeTemplate, aiEdges: Uint8Array): { dx: number; dy: number; score: number } {
  const { w, h, pts, maxShift } = template;
  let best = { dx: 0, dy: 0, score: -1 };

  // quick bounds
  const ptsLen = pts.length;
  if (ptsLen < 50) return best;

  for (let dy = -maxShift; dy <= maxShift; dy++) {
    for (let dx = -maxShift; dx <= maxShift; dx++) {
      let s = 0;
      for (let i = 0; i < ptsLen; i++) {
        const x = pts[i][0] + dx;
        const y = pts[i][1] + dy;
        if (x < 1 || x >= w - 1 || y < 1 || y >= h - 1) continue;
        s += aiEdges[y * w + x];
      }
      if (s > best.score) best = { dx, dy, score: s };
    }
  }
  return best;
}

async function _alignAiB64ToTemplate(aiB64: string, template: EdgeTemplate): Promise<string> {
  const bmp = await _b64ToImageBitmap(aiB64);
  const edges = _edgeMapFromImageBitmap(bmp, template.w, template.h);
  const { dx, dy, score } = _estimateShift(template, edges);

  // If confidence is low, skip alignment.
  const minScore = Math.max(120, Math.round(template.pts.length * 0.08));
  if (score < minScore) return aiB64;

  // dx,dy is where AI edges match template when sampling AI at (x+dx,y+dy).
  // So AI pergola is shifted by (+dx,+dy) relative to template -> translate image by (-dx,-dy).
  const full = document.createElement("canvas");
  full.width = bmp.width;
  full.height = bmp.height;
  const ctx = full.getContext("2d")!;
  // fill by original first (prevents empty borders)
  ctx.drawImage(bmp, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  // overlay shifted copy
  const sx = Math.round((-dx) * (bmp.width / template.w));
  const sy = Math.round((-dy) * (bmp.height / template.h));
  ctx.clearRect(0, 0, full.width, full.height);
  ctx.drawImage(bmp, sx, sy);
  // For uncovered areas, draw original under it (already empty due to clearRect). Use destination-over:
  ctx.globalCompositeOperation = "destination-over";
  ctx.drawImage(bmp, 0, 0);

  return _canvasToB64Png(full);
}

function useMedia(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setMatch(m.matches);
    on();
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [query]);
  return match;
}

function Icon({
  name,
  size = 18,
}: {
  name: "upload" | "move" | "rotate" | "resize" | "reset" | "sparkles" | "download" | "zoom";
  size?: number;
}) {
  const common = { width: size, height: size, viewBox: "0 0 24 24" };
  switch (name) {
    case "upload":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 16V4" />
          <path d="M7 9l5-5 5 5" />
          <path d="M4 20h16" />
        </svg>
      );
    case "move":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2v20" />
          <path d="M2 12h20" />
          <path d="M12 2l-3 3" />
          <path d="M12 2l3 3" />
          <path d="M12 22l-3-3" />
          <path d="M12 22l3-3" />
          <path d="M2 12l3-3" />
          <path d="M2 12l3 3" />
          <path d="M22 12l-3-3" />
          <path d="M22 12l-3 3" />
        </svg>
      );
    case "rotate":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v6h-6" />
        </svg>
      );
    case "resize":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 7V3h4" />
          <path d="M21 17v4h-4" />
          <path d="M3 3l7 7" />
          <path d="M21 21l-7-7" />
        </svg>
      );
    case "reset":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 12a9 9 0 1 0 3-6.7" />
          <path d="M3 3v6h6" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2l1.6 4.7L18 8.3l-4.4 1.6L12 14.6l-1.6-4.7L6 8.3l4.4-1.6L12 2z" />
          <path d="M5 14l.8 2.2L8 17l-2.2.8L5 20l-.8-2.2L2 17l2.2-.8L5 14z" />
          <path d="M19 13l.8 2.2L22 16l-2.2.8L19 19l-.8-2.2L16 16l2.2-.8L19 13z" />
        </svg>
      );
    case "download":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3v12" />
          <path d="M7 10l5 5 5-5" />
          <path d="M4 20h16" />
        </svg>
      );
    case "zoom":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="10" cy="10" r="6" />
          <path d="M21 21l-6-6" />
          <path d="M10 7v6" />
          <path d="M7 10h6" />
        </svg>
      );
    default:
      return null;
  }
}

/** Custom slider = drag always works on mobile (pointer capture + stopPropagation) */
function CustomSlider({
  min,
  max,
  step,
  value,
  onChange,
  label,
  suffix,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (v: number) => void;
  label?: string;
  suffix?: string;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
  const safeStep = step > 0 ? step : 1;

  const snap = (v: number) => {
    const snapped = Math.round(v / safeStep) * safeStep;
    return Number(snapped.toFixed(6));
  };

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = clamp01((clientX - rect.left) / Math.max(1, rect.width));
    const raw = min + t * (max - min);
    const next = snap(raw);
    onChange(Math.max(min, Math.min(max, next)));
  };

  const pct = ((value - min) / Math.max(1e-9, max - min)) * 100;

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline" }}>
        <div
          style={{
            fontSize: 12,
            fontWeight: 900,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "rgba(0,0,0,0.65)",
          }}
        >
          {label ?? "Hodnota"}
        </div>
        <div style={{ fontSize: 13, fontWeight: 950, color: "rgba(0,0,0,0.8)", fontVariantNumeric: "tabular-nums" }}>
          {String(value)}
          {suffix ?? ""}
        </div>
      </div>

      <div
        ref={trackRef}
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          draggingRef.current = true;
          (e.currentTarget as any).setPointerCapture(e.pointerId);
          setFromClientX(e.clientX);
        }}
        onPointerMove={(e) => {
          if (!draggingRef.current) return;
          e.preventDefault();
          e.stopPropagation();
          setFromClientX(e.clientX);
        }}
        onPointerUp={(e) => {
          if (!draggingRef.current) return;
          e.preventDefault();
          e.stopPropagation();
          draggingRef.current = false;
          try {
            (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
          } catch {}
        }}
        onPointerCancel={(e) => {
          draggingRef.current = false;
          e.stopPropagation();
          try {
            (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
          } catch {}
        }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onTouchCancel={(e) => e.stopPropagation()}
        role="slider"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        tabIndex={0}
        onKeyDown={(e) => {
          const s = safeStep;
          if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
            e.preventDefault();
            onChange(Math.max(min, snap(value - s)));
          } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
            e.preventDefault();
            onChange(Math.min(max, snap(value + s)));
          } else if (e.key === "Home") {
            e.preventDefault();
            onChange(min);
          } else if (e.key === "End") {
            e.preventDefault();
            onChange(max);
          }
        }}
        style={{
          position: "relative",
          height: 42,
          borderRadius: 999,
          background: "rgba(0,0,0,0.10)",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          outline: "none",
          border: "1px solid rgba(0,0,0,0.10)",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: "50%",
            transform: "translateY(-50%)",
            height: 12,
            borderRadius: 999,
            background: "rgba(0,0,0,0.14)",
            overflow: "hidden",
          }}
        >
          <div style={{ height: "100%", width: `${clamp(pct, 0, 100)}%`, background: "rgba(0,0,0,0.55)" }} />
        </div>

        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${clamp(pct, 0, 100)}%`,
            transform: "translate(-50%, -50%)",
            width: 26,
            height: 26,
            borderRadius: 999,
            background: "#111",
            boxShadow: "0 10px 24px rgba(0,0,0,0.18)",
            border: "2px solid rgba(255,255,255,0.9)",
          }}
        />
      </div>
    </div>
  );
}

function Segmented({
  value,
  onChange,
  items,
}: {
  value: string;
  onChange: (v: string) => void;
  items: { value: string; label: string; icon?: React.ReactNode }[];
}) {
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 6,
        padding: 6,
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(0,0,0,0.03)",
        maxWidth: "100%",
        overflowX: "auto",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {items.map((it) => {
        const active = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            onClick={() => onChange(it.value)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 14px",
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.10)",
              background: active ? "#fff" : "transparent",
              boxShadow: active ? "0 10px 22px rgba(0,0,0,0.10)" : "none",
              cursor: "pointer",
              fontWeight: 900,
              color: active ? "#111" : "rgba(0,0,0,0.55)",
              userSelect: "none",
              WebkitUserSelect: "none",
              whiteSpace: "nowrap",
            }}
          >
            {it.icon}
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

type VariantItem = {
  id: string;
  type: PergolaType;
  b64: string; // PNG
  createdAt: number;
};

export default function Page() {
  const isMobile = useMedia("(max-width: 920px)");
  const isMobileRef = useRef(false);
  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);

  // ===== Hero (rozbaľovací návod v mobile) =====
  const [heroHintOpen, setHeroHintOpen] = useState(false);
  // ===== Úvodné info (pop-up) =====
  const [introOpen, setIntroOpen] = useState(true);


  const closeIntro = () => {
    setIntroOpen(false);
  };

  // jemné guide správanie (bez overlayov)
  const [guideSeen, setGuideSeen] = useState({ move: false, roll: false, resize: false });

  // ===== Background upload =====
  const [bgFile, setBgFile] = useState<File | null>(null);
  const bgUrl = useMemo(() => (bgFile ? URL.createObjectURL(bgFile) : ""), [bgFile]);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!bgUrl) {
      setBgImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = bgUrl;
  }, [bgUrl]);

  // ===== Pergola type / model =====
  const [pergolaType, setPergolaType] = useState<PergolaType>("bioklim");
  const glbPath = useMemo(() => {
    if (pergolaType === "bioklim") return "/models/bioklim.glb";
    if (pergolaType === "pevna") return "/models/pevna.glb";
    return "/models/zimna.glb";
  }, [pergolaType]);

  // ===== Canvas sizing =====
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 980, h: 560 });
  useEffect(() => {
    const compute = () => {
      const availW = Math.max(320, Math.floor(window.innerWidth - 32));
      const maxW = Math.min(980, availW);
      const h = Math.max(240, Math.round((maxW * 560) / 980));
      setCanvasSize({ w: maxW, h });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const canvasW = canvasSize.w;
  const canvasH = canvasSize.h;

  // ===== Editor state =====
  const [mode, setMode] = useState<Mode>("move");
  const [panel, setPanel] = useState<"zoom" | "x" | "y" | "z">("zoom");
  const [panelOpen, setPanelOpen] = useState(false);

  const [editorZoom, setEditorZoom] = useState(100);

  // ===== Photo perspective calibration (camera matching) =====
  // UX: user aligns a horizon line + adjusts depth (FOV) + view direction (yaw).
  const defaultPerspective = (mobile: boolean) => ({
    horizonPct: mobile ? 62 : 58, // 0..100 (vertical position of horizon line from top)
    depthPct: mobile ? 52 : 48, // 0..100 (maps to FOV)
    viewYawDeg: 0, // -25..25 degrees
  });

  const [perspectiveOpen, setPerspectiveOpen] = useState(false);
  const [perspective, setPerspective] = useState(defaultPerspective(isMobileRef.current));

  const [pos, setPos] = useState<Vec2>({ x: 0.5, y: 0.72 });
  const [rot2D, setRot2D] = useState(0);
  const [rot3D, setRot3D] = useState({ yaw: 0.35, pitch: -0.12 });
  const [scalePct, setScalePct] = useState({ x: 100, y: 100, z: 100 });

  // mobile defaults
  useEffect(() => {
    if (!isMobileRef.current) return;
    setScalePct({ x: 75, y: 75, z: 75 });
    setPos({ x: 0.5, y: 0.78 });
    setPerspective(defaultPerspective(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [bboxRect, setBboxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [activeHandle, setActiveHandle] = useState<HandleId | null>(null);

  // ===== Three.js refs =====
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const threeReadyRef = useRef(false);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const rootRef = useRef<any>(null);
  const baseScaleRef = useRef<number>(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Prompt text (avoid name "prompt" which collides with window.prompt)
  const promptText: string = FINAL_PROMPT_DEFAULT;

  // prompt sa skladá dynamicky pre každý variant (A/B anchor)

  // ===== Variants =====
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  function openPreview(i: number) {
    setPreviewIndex(i);
    setPreviewOpen(true);
  }
  function closePreview() {
    setPreviewOpen(false);
  }

  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") setPreviewOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  const remaining = Math.max(0, MAX_VARIANTS - variants.length);

  const canGenerate = !!bgImg && !loading && variants.length < MAX_VARIANTS;

  // ===== Lead gating =====
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ kind: "single"; index: number } | { kind: "all" } | null>(null);

  const [lead, setLead] = useState({
    name: "",
    city: "",
    phone: "",
    email: "",
    approxWidth: "",
    approxDepth: "",
    approxHeight: "",
    customerNote: "",
  });

  const [leadErr, setLeadErr] = useState<{
    name?: string;
    city?: string;
    phone?: string;
    email?: string;
    approxWidth?: string;
    approxDepth?: string;
    approxHeight?: string;
    selectedVariant?: string;
  }>({});

  function closeLeadForm() {
    setLeadOpen(false);
    setLeadSubmitting(false);
    setPendingAction(null);
    setLeadErr({});
  }

  function validateLead() {
    const e: any = {};
    if (!lead.name.trim()) e.name = "Zadaj meno.";
    if (!lead.city.trim()) e.city = "Zadaj mesto.";

    const digits = lead.phone.replace(/\D/g, "");
    if (!digits || digits.length < 6) e.phone = "Zadaj platné telefónne číslo.";

    if (!isValidEmail(lead.email)) e.email = "Zadaj platnú emailovú adresu.";

    if (!lead.approxWidth.trim()) e.approxWidth = "Zadaj šírku.";
    if (!lead.approxDepth.trim()) e.approxDepth = "Zadaj hĺbku.";
    if (!lead.approxHeight.trim()) e.approxHeight = "Zadaj výšku.";

    if (!variants[selectedVariantIndex]?.b64) e.selectedVariant = "Vyber jednu vizualizáciu, ktorú nám pošleš.";

    setLeadErr(e);
    return Object.keys(e).length === 0;
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    if (leadSubmitting) return;
    if (!validateLead()) return;

    const picked = variants[selectedVariantIndex];
    if (!picked) return;

    setLeadSubmitting(true);

    try {
      const note = [
        `Vybraná vizualizácia: Variant ${selectedVariantIndex + 1} – ${typeLabel(picked.type)}`,
        `Rozmery (približne):`,
        `- šírka: ${lead.approxWidth}`,
        `- hĺbka: ${lead.approxDepth}`,
        `- výška: ${lead.approxHeight}`,
        ``,
        `Poznámka zákazníka:`,
        (lead.customerNote || "").trim() ? lead.customerNote.trim() : "-",
      ].join("\n");

      const pngBlob = await b64PngToBlob(picked.b64);

      const fd = new FormData();
      fd.append("name", lead.name);
      fd.append("city", lead.city);
      fd.append("phone", lead.phone);
      fd.append("email", lead.email);
      fd.append("note", note);
      fd.append("consent", "yes");
      fd.append("source", "teranea-editor");
      fd.append("image", pngBlob, `vizualizacia_variant_${selectedVariantIndex + 1}.png`);

      const r = await fetch("/api/lead/submit", {
        method: "POST",
        body: fd,
      });

      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `HTTP ${r.status}`);
      }

      setLeadSubmitted(true);
      setLeadOpen(false);
      setLeadSubmitting(false);

      if (pendingAction?.kind === "single") {
        downloadVariantPNG(pendingAction.index);
      } else if (pendingAction?.kind === "all") {
        await downloadAllPNGs();
      }
      setPendingAction(null);
    } catch (err: any) {
      console.error(err);
      setLeadSubmitting(false);
      setLeadErr((prev) => ({
        ...prev,
        email: prev.email || "Nepodarilo sa odoslať formulár. Skús znova.",
      }));
    }
  }

  function onDownloadOne(idx: number) {
    if (!variants[idx]?.b64) return;
    setSelectedVariantIndex(idx);

    if (leadSubmitted) {
      downloadVariantPNG(idx);
      return;
    }

    setLeadErr({});
    setPendingAction({ kind: "single", index: idx });
    setLeadOpen(true);
  }

  function onDownloadAllClick() {
    if (variants.length === 0) return;

    if (leadSubmitted) {
      downloadAllPNGs();
      return;
    }

    setLeadErr({});
    setPendingAction({ kind: "all" });
    setLeadOpen(true);
  }

  // ===== Helpers =====
  function setScaleAxis(axis: "x" | "y" | "z", value: number) {
    setScalePct((prev) => ({ ...prev, [axis]: clampPct(value) }));
  }

  function resetAll() {
    setScalePct(isMobileRef.current ? { x: 75, y: 75, z: 75 } : { x: 100, y: 100, z: 100 });
    setRot3D({ yaw: 0.35, pitch: -0.12 });
    setRot2D(0);
    setPos(isMobileRef.current ? { x: 0.5, y: 0.78 } : { x: 0.5, y: 0.72 });
    setPerspective(defaultPerspective(isMobileRef.current));
    setError("");
    setPanel("zoom");
    setPanelOpen(false);
    setPerspectiveOpen(false);
    setSelectedVariantIndex(0);
  }

  function togglePanel(p: "zoom" | "x" | "y" | "z") {
    setPanel((prev) => {
      if (prev === p) {
        setPanelOpen((o) => !o);
        return prev;
      }
      setPanelOpen(true);
      return p;
    });
  }

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * canvasW) / rect.width;
    const y = ((e.clientY - rect.top) * canvasH) / rect.height;
    return { x, y };
  }

  function hitHandle(p: Vec2, r: { x: number; y: number; w: number; h: number }) {
    const corners: Record<HandleId, Vec2> = {
      nw: { x: r.x, y: r.y },
      ne: { x: r.x + r.w, y: r.y },
      se: { x: r.x + r.w, y: r.y + r.h },
      sw: { x: r.x, y: r.y + r.h },
    };
    for (const id of Object.keys(corners) as HandleId[]) {
      if (dist(p, corners[id]) <= HANDLE_HIT) return id;
    }
    return null;
  }

  // ===== THREE INIT / RELOAD =====
  useEffect(() => {
    let cancelled = false;

    async function initThree() {
      try {
        const THREE = await import("three");
        const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

        if (cancelled) return;

        const scene = new THREE.Scene();
        scene.background = null;

        const camera = new THREE.PerspectiveCamera(35, canvasW / canvasH, 0.01, 100);
        camera.position.set(0, 0.7, 2.2);
        camera.lookAt(0, 0.35, 0);

        const renderer = new THREE.WebGLRenderer({
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
        });
        renderer.setSize(canvasW, canvasH, false);
        renderer.setPixelRatio(1);

        const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.95);
        scene.add(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 1.15);
        dir.position.set(1, 2, 1.2);
        scene.add(dir);

        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(glbPath);
        if (cancelled) return;

        if (rootRef.current) {
          try {
            scene.remove(rootRef.current);
          } catch {}
        }

        const root = new THREE.Group();
        scene.add(root);

        const model = gltf.scene;

        const bbox = new THREE.Box3().setFromObject(model);
        const size = bbox.getSize(new THREE.Vector3());
        const center = bbox.getCenter(new THREE.Vector3());
        model.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z);
        const safeMaxDim = maxDim > 1e-6 ? maxDim : 1;
        baseScaleRef.current = TARGET_MODEL_MAX_DIM_AT_100 / safeMaxDim;

        model.scale.set(1, 1, 1);
        root.add(model);

        sceneRef.current = scene;
        cameraRef.current = camera;
        rendererRef.current = renderer;
        rootRef.current = root;

        threeReadyRef.current = true;
        draw();
      } catch (err: any) {
        console.error(err);
        setError(String(err?.message || err));
      }
    }

    initThree();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [glbPath, canvasW, canvasH]);

  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImg, canvasW, canvasH, editorZoom, pos, rot2D, rot3D, scalePct, mode, perspective, perspectiveOpen]);

  function applyTransformsForCurrentState(width: number, height: number) {
    if (!threeReadyRef.current || !cameraRef.current || !rootRef.current) return;

    const camera = cameraRef.current;
    const root = rootRef.current;

    // --- Camera matching (photo perspective) ---
    // depthPct -> FOV range (tele -> wide)
    const fov = lerp(30, 75, clamp(perspective.depthPct / 100, 0, 1));
    camera.fov = fov;

    camera.aspect = width / height;

    // horizonPct -> approximate camera height + look target
    const hPct = clamp(perspective.horizonPct, 10, 90);
    const t = (hPct - 10) / 80; // 0..1
    const camY = lerp(1.20, 0.55, t);
    const targetY = lerp(0.42, 0.14, t);

    // viewYawDeg -> rotate camera around the scene (does NOT rotate the pergola itself)
    const yaw = clamp(perspective.viewYawDeg, -25, 25) * (Math.PI / 180);
    const radius = 2.2;

    camera.position.set(Math.sin(yaw) * radius, camY, Math.cos(yaw) * radius);
    camera.lookAt(0, targetY, 0);

    camera.updateProjectionMatrix();

    // --- Pergola transform (user manipulation) ---
    const base = baseScaleRef.current;
    root.scale.set(base * (scalePct.x / 100), base * (scalePct.y / 100), base * (scalePct.z / 100));

    const worldX = (pos.x - 0.5) * 1.8;
    const worldY = (0.9 - pos.y) * 1.2;
    root.position.set(worldX, worldY, 0);

    root.rotation.set(rot3D.pitch, rot3D.yaw, rot2D);
  }

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // clear (light editor)
    ctx.clearRect(0, 0, canvasW, canvasH);

    // background photo (cover) OR placeholder
    if (bgImg) {
      const cw = canvasW;
      const ch = canvasH;
      const iw = bgImg.width;
      const ih = bgImg.height;

      const r = Math.max(cw / iw, ch / ih); // cover
      const dw = iw * r;
      const dh = ih * r;
      const dx = (cw - dw) / 2;
      const dy = (ch - dh) / 2;
      ctx.drawImage(bgImg, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.95)";
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText("Nahraj fotku (JPG/PNG)", 18, 28);
    }

    // 3D render over it
    if (threeReadyRef.current && rendererRef.current && sceneRef.current && cameraRef.current && rootRef.current) {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;

      applyTransformsForCurrentState(canvasW, canvasH);
      renderer.setSize(canvasW, canvasH, false);
      renderer.render(scene, cameraRef.current);

      const glCanvas = renderer.domElement;
      ctx.drawImage(glCanvas, 0, 0);

      // bbox (read alpha)
      try {
        const gl = renderer.getContext();
        const pixels = new Uint8Array(canvasW * canvasH * 4);
        gl.readPixels(0, 0, canvasW, canvasH, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

        let minX = canvasW,
          minY = canvasH,
          maxX = 0,
          maxY = 0;
        let any = false;

        const step = 2;
        for (let y = 0; y < canvasH; y += step) {
          for (let x = 0; x < canvasW; x += step) {
            const i = (y * canvasW + x) * 4;
            const a = pixels[i + 3];
            if (a > 12) {
              any = true;
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }

        if (any) {
          const invMinY = canvasH - maxY;
          const invMaxY = canvasH - minY;
          const rect = { x: minX, y: invMinY, w: maxX - minX, h: invMaxY - invMinY };
          setBboxRect(rect);

          ctx.save();
          ctx.strokeStyle = "rgba(0,0,0,0.55)";
          ctx.lineWidth = 2;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
          ctx.setLineDash([]);

          // handles only in resize mode
          if (mode === "resize") {
            const corners: Record<HandleId, Vec2> = {
              nw: { x: rect.x, y: rect.y },
              ne: { x: rect.x + rect.w, y: rect.y },
              se: { x: rect.x + rect.w, y: rect.y + rect.h },
              sw: { x: rect.x, y: rect.y + rect.h },
            };
            for (const id of Object.keys(corners) as HandleId[]) {
              const c = corners[id];
              ctx.beginPath();
              ctx.fillStyle = "rgba(255,255,255,0.9)";
              ctx.arc(c.x, c.y, 11, 0, Math.PI * 2);
              ctx.fill();
              ctx.beginPath();
              ctx.fillStyle = "rgba(0,0,0,0.65)";
              ctx.arc(c.x, c.y, HANDLE_R, 0, Math.PI * 2);
              ctx.fill();
            }
          }

          ctx.restore();
        } else {
          setBboxRect(null);
        }
      } catch {
        // ignore
      }
    }
  }
    // Perspective overlay (horizon line) – shown only when the perspective panel is open
    if (perspectiveOpen) {
      const canvas = canvasRef.current;
      const ctx = canvas ? canvas.getContext("2d") : null;
      if (!ctx) return;

      const y = clamp((perspective.horizonPct / 100) * canvasH, 0, canvasH);
      ctx.save();
      ctx.strokeStyle = "rgba(0,0,0,0.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash([10, 8]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(canvasW, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // label
      ctx.fillStyle = "rgba(0,0,0,0.75)";
      ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
      const label = "HORIZONT";
      const pad = 8;
      const w = ctx.measureText(label).width + pad * 2;
      const bx = 12;
      const by = clamp(y - 28, 8, canvasH - 28);
      ctx.fillRect(bx, by, w, 22);
      ctx.fillStyle = "#fff";
      ctx.fillText(label, bx + pad, by + 15);
      ctx.restore();
    }

  // ===== 1 finger = always edit canvas =====
  const dragRef = useRef<{
    active: boolean;
    start: Vec2;
    startPos: Vec2;
    startRot3D: { yaw: number; pitch: number };
    startRot2D: number;
    startScalePct: { x: number; y: number; z: number };
    handle: HandleId | null;
    modeAtDown: Mode;
    rollMode: boolean;
    tiltAxis: "x" | "z" | null;
    tiltSign: number;
  }>({
    active: false,
    start: { x: 0, y: 0 },
    startPos: { x: 0.5, y: 0.72 },
    startRot3D: { yaw: 0.35, pitch: -0.12 },
    startRot2D: 0,
    startScalePct: { x: 100, y: 100, z: 100 },
    handle: null,
    modeAtDown: "move",
    rollMode: false,
    tiltAxis: null,
    tiltSign: 1,
  });

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = toCanvasXY(e);

    e.preventDefault();
    (e.currentTarget as any).setPointerCapture(e.pointerId);

    if (mode === "resize" && bboxRect) {
      const h = hitHandle(p, bboxRect);
      if (h) {
        setActiveHandle(h);
        setGuideSeen((g) => (g.resize ? g : { ...g, resize: true }));
        dragRef.current = {
          active: true,
          start: p,
          startPos: pos,
          startRot3D: rot3D,
          startRot2D: rot2D,
          startScalePct: scalePct,
          handle: h,
          modeAtDown: "resize" as Mode,
          rollMode: false,
          tiltAxis: null,
          tiltSign: 1,
        };
        return;
      }
    }

    let rollMode = false;
    // rotate3d: vždy otáčame len okolo osi Y (yaw)

    let tiltAxis: "x" | "z" | null = null;
    let tiltSign = 1;
    if (mode === "roll" && bboxRect) {
      const l = Math.abs(p.x - bboxRect.x);
      const r = Math.abs(p.x - (bboxRect.x + bboxRect.w));
      const t = Math.abs(p.y - bboxRect.y);
      const b = Math.abs(p.y - (bboxRect.y + bboxRect.h));
      const min = Math.min(l, r, t, b);

      if (min === l || min === r) {
        tiltAxis = "z";
        tiltSign = min === r ? 1 : -1; // pravý okraj hore = rot2D +, ľavý okraj hore = rot2D -
      } else {
        tiltAxis = "x";
        tiltSign = min === b ? 1 : -1; // spodná hrana hore = pitch +, horná hrana hore = pitch -
      }
    } else if (mode === "roll") {
      tiltAxis = "x";
      tiltSign = 1;
    }

    dragRef.current = {
      active: true,
      start: p,
      startPos: pos,
      startRot3D: rot3D,
      startRot2D: rot2D,
      startScalePct: scalePct,
      handle: null,
      modeAtDown: mode as Mode,
      rollMode,
      tiltAxis,
      tiltSign,
    };
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current.active) return;

    e.preventDefault();

    const p = toCanvasXY(e);
    const dx = p.x - dragRef.current.start.x;
    const dy = p.y - dragRef.current.start.y;

    const currentMode = dragRef.current.modeAtDown;

    if (currentMode === "move") {
      const nx = dragRef.current.startPos.x + dx / canvasW;
      const ny = dragRef.current.startPos.y + dy / canvasH;
      setPos({ x: clamp(nx, 0, 1), y: clamp(ny, 0, 1) });
      return;
    }

    if (currentMode === "rotate3d") {
      // Otoč 3D: otáčaj iba dookola okolo osi Y (yaw)
      const yaw = dragRef.current.startRot3D.yaw + dx * 0.01;
      setRot3D((prev) => ({ ...prev, yaw }));
      return;
    }

    if (currentMode === "roll") {
      setGuideSeen((g) => (g.roll ? g : { ...g, roll: true }));
      // Teeter-totter nakláňanie podľa toho, ktorú hranu chytíš:
      // - ľavý/pravý okraj: ťah hore zdvihne tú stranu (rot2D / roll)
      // - horná/spodná hrana: ťah hore zdvihne tú stranu (pitch)
      const k = 0.01;

      if (dragRef.current.tiltAxis === "z") {
        const roll = dragRef.current.startRot2D + dragRef.current.tiltSign * (-dy) * k;
        setRot2D(roll);
      } else {
        const pitch = dragRef.current.startRot3D.pitch + dragRef.current.tiltSign * (-dy) * k;
        setRot3D((prev) => ({ ...prev, pitch: clamp(pitch, -1.25, 1.25) }));
      }
      return;
    }

    if (currentMode === "resize") {
      const rect = bboxRect;
      if (!rect || !dragRef.current.handle) return;

      const start = dragRef.current.start;
      const handle = dragRef.current.handle;

      const sx = handle === "ne" || handle === "se" ? 1 : -1;
      const sy = handle === "sw" || handle === "se" ? 1 : -1;

      const dx2 = (p.x - start.x) * sx;
      const dy2 = (p.y - start.y) * sy;

      const newW = clamp(rect.w + dx2, 40, canvasW);
      const newH = clamp(rect.h + dy2, 40, canvasH);

      const wRatio = newW / Math.max(1, rect.w);
      const hRatio = newH / Math.max(1, rect.h);

      const nextX = clampPct(dragRef.current.startScalePct.x * wRatio);
      const nextY = clampPct(dragRef.current.startScalePct.y * hRatio);

      setScalePct((s) => ({ ...s, x: nextX, y: nextY }));
      return;
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    dragRef.current.tiltAxis = null;
    setActiveHandle(null);

    try {
      (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
    } catch {}
  }

  // ===== Generate (real API) =====
  async function generate() {
      if (!bgImg) return;
      if (variants.length >= MAX_VARIANTS) return;

      setLoading(true);
      setError("");

      try {
        // downscale export
        const MAX_DIM = 2048;
        const bgW = bgImg.width;
        const bgH = bgImg.height;

        const scale = Math.min(1, MAX_DIM / Math.max(bgW, bgH));
        const outW = Math.max(1, Math.round(bgW * scale));
        const outH = Math.max(1, Math.round(bgH * scale));

        const out = document.createElement("canvas");
        out.width = outW;
        out.height = outH;

        const octx = out.getContext("2d")!;
        octx.drawImage(bgImg, 0, 0, outW, outH);

        // bg-only canvas (for alignment template + Flux original)
        const bgOnly = document.createElement("canvas");
        bgOnly.width = outW;
        bgOnly.height = outH;
        const bgctx = bgOnly.getContext("2d")!;
        bgctx.drawImage(bgImg, 0, 0, outW, outH);

        if (
          !threeReadyRef.current ||
          !rendererRef.current ||
          !sceneRef.current ||
          !cameraRef.current ||
          !rootRef.current
        ) {
          throw new Error("3D renderer nie je pripravený.");
        }

        const renderer = rendererRef.current;
        const scene = sceneRef.current;

        applyTransformsForCurrentState(outW, outH);
        renderer.setSize(outW, outH, false);
        renderer.render(scene, cameraRef.current);

        const glTemp = renderer.domElement;
        octx.drawImage(glTemp, 0, 0);

        // Template for post-align (keeps exact placement)
        const alignTemplate = _makeEdgeTemplateFromDiff(bgOnly, out);

        // Collage -> JPEG blob for OpenAI
        const blob: Blob = await new Promise((res, rej) =>
          out.toBlob((b) => (b ? res(b) : rej(new Error("toBlob vrátil null"))), "image/jpeg", 0.9)
        );

        const form = new FormData();
        form.append("image", blob, "collage.jpg");
        form.append("prompt", promptText);

        const r = await fetch("/api/render/openai", { method: "POST", body: form });

        const j = await r.json().catch(async () => {
          const t = await r.text().catch(() => "");
          return { error: t || `HTTP ${r.status}` };
        });

        if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        if (!j?.b64) throw new Error("API nevrátilo b64.");

        // 1) OpenAI result (PNG b64)
        let finalB64 = j.b64 as string;

        // 2) Best-effort align back to template (reduces drift)
        try {
          finalB64 = await _alignAiB64ToTemplate(finalB64, alignTemplate);
        } catch {}

        // 3) Flux harmonization (REQUIRED) via /api/mask (server-side Flux)
        const fluxPrompt = [
          "HARMONIZE ONLY. The pergola structure is already placed correctly.",
          "Preserve the exact position, size, perspective and orientation of the pergola. Do NOT move, resize, rotate or redesign it.",
          "Do NOT change camera angle, crop, zoom, or viewpoint.",
          "Improve realism only: consistent lighting, realistic shadows, natural contact with terrace and house wall, photographic color balance and noise.",
          "No floating, no detached edges, no extra columns/beams, no new objects.",
          "Photorealistic result.",
        ].join("\\n");

        const originalJpg = await canvasToJpegBlobAtMaxDim(bgOnly, 1024, 0.9);
        const proposedJpg = await b64PngToJpegBlobAtMaxDim(finalB64, 1024, 0.9);

        const fd = new FormData();
        fd.append("original", originalJpg, "original.jpg");
        fd.append("proposed", proposedJpg, "proposed.jpg");
        fd.append("prompt", fluxPrompt);
        fd.append("steps", "35");
        fd.append("seed", String((Date.now() + variants.length * 997) % 2147483647));

        const mr = await fetch("/api/mask", { method: "POST", body: fd });
        if (!mr.ok) {
          const t = await mr.text().catch(() => "");
          throw new Error(`Flux step failed: /api/mask (${mr.status}) ${t || ""}`.trim());
        }
        const fj = await mr.json();
        const fluxUrl = fj?.outputUrl as string | undefined;
        if (!fluxUrl) {
          throw new Error("Flux step failed: /api/mask did not return outputUrl");
        }

        const fluxBlob = await fetch(fluxUrl).then((rr) => rr.blob());
        let fluxB64 = await blobToB64Png(fluxBlob);

        // 4) Best-effort align again
        try {
          fluxB64 = await _alignAiB64ToTemplate(fluxB64, alignTemplate);
        } catch {}

        finalB64 = fluxB64;

        // 5) Watermark
        finalB64 = await watermarkB64Png(finalB64);

        setVariants((prev) => {
          if (prev.length >= MAX_VARIANTS) return prev;
          const next = [
            ...prev,
            { id: makeId(), type: pergolaType, b64: finalB64, createdAt: Date.now() },
          ];
          return next;
        });

        setSelectedVariantIndex(() => clamp(variants.length, 0, MAX_VARIANTS - 1));
      } catch (err: any) {
        console.error(err);
        setError(String(err?.message || err));
      } finally {
        setLoading(false);
      }
    }

function downloadVariantPNG(idx: number) {
    const v = variants[idx];
    if (!v?.b64) return;
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${v.b64}`;
    a.download = `vizualizacia_${idx + 1}.png`;
    a.click();
  }

  async function downloadAllPNGs() {
    for (let i = 0; i < variants.length; i++) {
      downloadVariantPNG(i);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  const sliderBox = useMemo(() => {
    if (panel === "zoom") {
      return <CustomSlider min={50} max={160} step={5} value={editorZoom} onChange={(v) => setEditorZoom(Math.round(v))} label="Zoom" suffix="%" />;
    }
    if (panel === "x") {
      return (
        <CustomSlider
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={SCALE_STEP}
          value={Number(scalePct.x.toFixed(1))}
          onChange={(v) => setScaleAxis("x", v)}
          label="Šírka (X)"
          suffix="%"
        />
      );
    }
    if (panel === "y") {
      return (
        <CustomSlider
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={SCALE_STEP}
          value={Number(scalePct.y.toFixed(1))}
          onChange={(v) => setScaleAxis("y", v)}
          label="Výška (Y)"
          suffix="%"
        />
      );
    }
    return (
      <CustomSlider
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={SCALE_STEP}
        value={Number(scalePct.z.toFixed(1))}
        onChange={(v) => setScaleAxis("z", v)}
        label="Hĺbka (Z)"
        suffix="%"
      />
    );
  }, [panel, editorZoom, scalePct]);

  const stepCurrent = useMemo(() => {
    const hasAnyVariant = variants.length > 0;
    if (!bgImg) return 1;
    if (!hasAnyVariant) return 2;
    if (!leadSubmitted) return leadOpen ? 4 : 3;
    return 4;
  }, [bgImg, variants.length, leadSubmitted, leadOpen]);

  const heroStep = useMemo(() => {
    return HERO_STEPS.find((s) => s.id === stepCurrent) || HERO_STEPS[0];
  }, [stepCurrent]);

  // keď sa zmení krok, v mobile necháme hint zatvorený (user si ho rozbalí)
  useEffect(() => {
    if (isMobileRef.current) setHeroHintOpen(false);
  }, [stepCurrent]);

  return (
    <section
      style={{
        background: "#f6f6f6",
        color: "#111",
        padding: "28px 16px 90px",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
      }}
    >

      {introOpen ? (
        <div role="dialog" aria-modal="true" style={{ position: "fixed", inset: 0, zIndex: 9999, background: "rgba(0,0,0,0.55)", display: "grid", placeItems: "center", padding: 16 }}>
          <div style={{ width: "min(760px, 100%)", background: "#fff", borderRadius: 18, border: "1px solid rgba(0,0,0,0.10)", boxShadow: "0 30px 90px rgba(0,0,0,0.35)", padding: 18, display: "grid", gap: 12 }}>
            <div style={{ fontSize: 20, fontWeight: 950, letterSpacing: "-0.01em" }}>Ako to funguje</div>
            <div style={{ color: "rgba(0,0,0,0.72)", fontSize: 15, lineHeight: 1.45 }}>
              Tento vizualizér <b>nie je profesionálny architektonický nástroj</b>. Je to rýchla pomôcka, ktorá ti pomôže vytvoriť si lepšiu predstavu, ako môže pergola vyzerať na tvojom dome.
              <br />
              <br />
              Používame umelú inteligenciu, ktorá vie spraviť veľmi presvedčivé vizualizácie, no aj napriek snahe o presnosť si občas <b>domýšľa a dokresľuje detaily</b>.
            </div>
            <div style={{ display: "grid", gap: 8, color: "rgba(0,0,0,0.75)", fontSize: 14, lineHeight: 1.45 }}>
              <div>• Ideálna je fotka z výšky očí alebo mierne zboku a so záberom čo najväčšieho priestoru (nie len tesne okolo pergoly).</div>
              <div>• V návrhu nastav pergolu radšej <b>o trochu menšiu</b> – AI ju vo výsledku často mierne zväčší.</div>
              <div>• Výsledky ber ako <b>vizuálnu inšpiráciu</b>, nie ako finálny technický návrh.</div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <button type="button" onClick={closeIntro} style={{ padding: "12px 16px", borderRadius: 14, border: "1px solid #111", background: "#111", color: "#fff", fontWeight: 950, cursor: "pointer" }}>
                Rozumiem
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 14 }}>

        {/* Hero */}
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <img
              src="/brand/logo.png"
              alt="Teranea"
              style={{ height: 34, width: "auto", display: "block", filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.10))" }}
            />

            <h2 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, letterSpacing: "-0.02em" }}>Vizualizácia pergoly</h2>

            <button
              type="button"
              onClick={() => {
                if (isMobile) setHeroHintOpen((v) => !v);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.10)",
                background: "#fff",
                boxShadow: "0 12px 28px rgba(0,0,0,0.08)",
                cursor: isMobile ? "pointer" : "default",
                userSelect: "none",
                WebkitUserSelect: "none",
              }}
              aria-expanded={isMobile ? heroHintOpen : true}
              aria-controls="hero-step-hint"
            >
              <span
                style={{
                  height: 22,
                  padding: "0 8px",
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: "#111",
                  color: "#fff",
                  fontSize: 12,
                  fontWeight: 950,
                }}
              >
                {heroStep.id}/4
              </span>
              <span style={{ fontWeight: 950, fontSize: 13, color: "rgba(0,0,0,0.85)", letterSpacing: "0.01em" }}>
                {heroStep.title}
                {isMobile ? " • klikni pre informácie" : ""}
              </span>
              {isMobile ? <span style={{ marginLeft: 2, color: "rgba(0,0,0,0.55)", fontWeight: 950 }}>{heroHintOpen ? "▴" : "▾"}</span> : null}
            </button>
          </div>

          {!isMobile || heroHintOpen ? (
            <div id="hero-step-hint" style={{ margin: 0, color: "rgba(0,0,0,0.70)", fontSize: 16, maxWidth: "110ch" }}>
              {heroStep.hint}
            </div>
          ) : null}

          {/* Stepper skrytý – zobrazujeme iba aktuálny krok vedľa titulku */}
        </div>

        {/* Editor card */}
        <div
          style={{
            background: "#fff",
            border: "1px solid rgba(0,0,0,0.08)",
            borderRadius: 18,
            boxShadow: "0 10px 30px rgba(0,0,0,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              padding: "14px 16px",
              borderBottom: "1px solid rgba(0,0,0,0.06)",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 950 }}>Editor</div>
            <div style={{ fontSize: 14, fontWeight: 850, color: "rgba(0,0,0,0.55)" }}>
              Režim:{" "}
              <span style={{ color: "rgba(0,0,0,0.9)" }}>
                {mode === "move" ? "POSUN" : mode === "rotate3d" ? "OTOČ" : mode === "roll" ? "NAKLOŇ" : "RESIZE"}
              </span>
            </div>
          </div>

          <div style={{ padding: 14, display: "grid", gap: 12 }}>
            {/* Mode controls like screenshot */}
            {isMobile ? (
              <div style={{ display: "grid", gap: 10 }}>
                {/* 1. riadok: Výber pergoly / Reset */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%" }}>
                  <select
                    value={pergolaType}
                    onChange={(e) => setPergolaType(e.target.value as PergolaType)}
                    style={{
                      padding: "10px 12px",
                      height: 42,
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.12)",
                      background: "#fff",
                      color: "#111",
                      fontWeight: 800,
                      width: "100%",
                      maxWidth: "100%",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <option value="bioklim">Bioklimatická pergola</option>
                    <option value="pevna">Pergola s pevnou strechou</option>
                    <option value="zimna">Zimná záhrada</option>
                  </select>

                  <button
                    type="button"
                    onClick={resetAll}
                    disabled={loading}
                    style={{
                      ...btnStyle,
                      cursor: loading ? "not-allowed" : "pointer",
                      opacity: loading ? 0.6 : 1,
                      flex: "0 0 auto",
                      minWidth: 0,
                      whiteSpace: "nowrap",
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Icon name="reset" size={16} />
                      Reset
                    </span>
                  </button>
                </div>

                {/* 2. riadok: Nahraj fotku / Resize */}
                <div style={{ display: "flex", gap: 10, alignItems: "center", width: "100%" }}>
                  <label
                    style={{
                      ...btnStyle,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Icon name="upload" size={16} />
                      Nahraj fotku
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setBgFile(f);
                        setPerspective(defaultPerspective(isMobileRef.current));
                        setError("");
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => setMode("resize")}
                    style={{
                      ...btnStyle,
                      flex: 1,
                      minWidth: 0,
                    }}
                  >
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Icon name="resize" size={16} />
                      Resize
                    </span>
                  </button>
                </div>

                {/* 3. riadok: Posuň / Otoč / Nakloň */}
                <div style={{ width: "100%" }}>
                  <Segmented
                    value={mode}
                    onChange={(v) => setMode(v as Mode)}
                    items={[
                      { value: "move", label: "Posuň", icon: <Icon name="move" size={16} /> },
                      { value: "rotate3d", label: "Otoč", icon: <Icon name="rotate" size={16} /> },
                      { value: "roll", label: "Nakloň", icon: <Icon name="rotate" size={16} /> },
                    ]}
                  />
                </div>
              </div>
            ) : (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Segmented
                  value={mode}
                  onChange={(v) => setMode(v as Mode)}
                  items={[
                    { value: "move", label: "Posun", icon: <Icon name="move" size={16} /> },
                    { value: "rotate3d", label: "Otoč", icon: <Icon name="rotate" size={16} /> },
                    { value: "roll", label: "Nakloň", icon: <Icon name="rotate" size={16} /> },
                    { value: "resize", label: "Resize", icon: <Icon name="resize" size={16} /> },
                  ]}
                />

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <label style={{ ...btnStyle, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Icon name="upload" size={16} />
                      Nahraj fotku
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.target.files?.[0] || null;
                        setBgFile(f);
                        setPerspective(defaultPerspective(isMobileRef.current));
                        setError("");
                      }}
                    />
                  </label>

                  <select
                    value={pergolaType}
                    onChange={(e) => setPergolaType(e.target.value as PergolaType)}
                    style={{
                      padding: "10px 12px",
                      borderRadius: 12,
                      border: "1px solid rgba(0,0,0,0.12)",
                      background: "#fff",
                      color: "#111",
                      fontWeight: 800,
                    }}
                  >
                    <option value="bioklim">Bioklimatická pergola</option>
                    <option value="pevna">Pergola s pevnou strechou</option>
                    <option value="zimna">Zimná záhrada</option>
                  </select>

                  <button type="button" onClick={resetAll} disabled={loading} style={{ ...btnStyle, cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.6 : 1 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      <Icon name="reset" size={16} />
                      Reset
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={generate}
                    disabled={!canGenerate}
                    style={{
                      ...btnStyle,
                      background: !canGenerate ? "rgba(0,0,0,0.10)" : "#111",
                      color: !canGenerate ? "rgba(0,0,0,0.45)" : "#fff",
                      borderColor: !canGenerate ? "rgba(0,0,0,0.12)" : "#111",
                      cursor: !canGenerate ? "not-allowed" : "pointer",
                    }}
                  >
                    {loading ? "Generujem..." : variants.length >= MAX_VARIANTS ? `Limit ${MAX_VARIANTS}` : `Vygenerovať (${variants.length + 1}/${MAX_VARIANTS})`}
                  </button>
                </div>
              </div>
            )}

            {/* 4. riadok na mobile: Zoom / Hĺbka / Výška / Šírka (a na desktope ostáva ako bolo) */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => togglePanel("zoom")} style={{ ...chipStyle, background: panelOpen && panel === "zoom" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon name="zoom" size={16} />
                  Zoom
                </span>
              </button>
              <button type="button" onClick={() => togglePanel("x")} style={{ ...chipStyle, background: panelOpen && panel === "x" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                Hĺbka
              </button>
              <button type="button" onClick={() => togglePanel("y")} style={{ ...chipStyle, background: panelOpen && panel === "y" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                Výška
              </button>
              <button type="button" onClick={() => togglePanel("z")} style={{ ...chipStyle, background: panelOpen && panel === "z" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                Šírka
              </button>

              <button
                type="button"
                onClick={() => setPerspectiveOpen((o) => !o)}
                style={{
                  ...chipStyle,
                  background: perspectiveOpen ? "rgba(0,0,0,0.06)" : "#fff",
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon name="rotate" size={16} />
                  Perspektíva
                </span>
              </button>
            </div>

            {panelOpen ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 14,
                  padding: 12,
                }}
              >
                {sliderBox}
              </div>
            ) : null}

            {perspectiveOpen ? (
              <div
                style={{
                  background: "#fff",
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: 14,
                  padding: 12,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontSize: 12, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(0,0,0,0.60)" }}>
                    Zladiť perspektívu s fotkou
                  </div>
                  <button
                    type="button"
                    onClick={() => setPerspective(defaultPerspective(isMobileRef.current))}
                    style={{
                      padding: "8px 10px",
                      borderRadius: 999,
                      border: "1px solid rgba(0,0,0,0.12)",
                      background: "#fff",
                      fontWeight: 900,
                      cursor: "pointer",
                    }}
                  >
                    Reset perspektívy
                  </button>
                </div>

                <div style={{ fontSize: 13, fontWeight: 750, color: "rgba(0,0,0,0.70)", lineHeight: 1.35 }}>
                  Posuň čiaru <b>HORIZONT</b> na približnú výšku očí (miesto, kde sa „láme“ zem a obloha / vzdialený okraj terasy).
                  Potom dolaď <b>Hĺbku</b> (ako širokouhlá je fotka) a <b>Smer</b> (z ktorej strany je fotka).
                </div>

                <CustomSlider
                  min={10}
                  max={90}
                  step={1}
                  value={Math.round(perspective.horizonPct)}
                  onChange={(v) => setPerspective((p) => ({ ...p, horizonPct: v }))}
                  label="Horizont fotky"
                  suffix="%"
                />

                <CustomSlider
                  min={0}
                  max={100}
                  step={1}
                  value={Math.round(perspective.depthPct)}
                  onChange={(v) => setPerspective((p) => ({ ...p, depthPct: v }))}
                  label="Hĺbka pohľadu"
                  suffix="%"
                />

                <CustomSlider
                  min={-25}
                  max={25}
                  step={1}
                  value={Math.round(perspective.viewYawDeg)}
                  onChange={(v) => setPerspective((p) => ({ ...p, viewYawDeg: v }))}
                  label="Smer pohľadu"
                  suffix="°"
                />
              </div>
            ) : null}


            {/* Canvas */}
            <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 14, overflow: "hidden", padding: 10 }}>
              <div style={{ width: Math.round((canvasW * editorZoom) / 100), height: Math.round((canvasH * editorZoom) / 100) }}>
                <canvas
                  ref={canvasRef}
                  width={canvasW}
                  height={canvasH}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                  style={{
                    width: `${(canvasW * editorZoom) / 100}px`,
                    height: `${(canvasH * editorZoom) / 100}px`,
                    display: "block",
                    touchAction: "none",
                    background: "#fff",
                    borderRadius: 12,
                  }}
                />
              </div>
            </div>

            
            {stepCurrent === 2 && (!guideSeen.move || !guideSeen.roll || !guideSeen.resize) ? (
              <div style={{
                marginTop: 10,
                padding: "10px 12px",
                borderRadius: 14,
                border: "1px solid rgba(0,0,0,0.08)",
                background: "rgba(0,0,0,0.02)",
                fontSize: 13,
                fontWeight: 800,
                color: "rgba(0,0,0,0.7)",
              }}>
                <div style={{ fontWeight: 950, marginBottom: 4 }}>Tip:</div>
                {!guideSeen.move && <div>• Chyť pergolu a potiahni ju na správne miesto.</div>}
                {!guideSeen.roll && <div>• Skús režim Nakloň pre prirodzenejšie osadenie.</div>}
                {!guideSeen.resize && <div>• V režime Resize potiahni roh rámčeka.</div>}
              </div>
            ) : null}

            {error ? <div style={errorBoxStyle}>Chyba: {error}</div> : null}
          </div>
        </div>

        {/* Variants card */}
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 18, boxShadow: "0 10px 30px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 12, fontWeight: 950, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(0,0,0,0.55)" }}>
                Varianty (max {MAX_VARIANTS})
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(0,0,0,0.60)" }}>
                Zostáva: <b>{remaining}</b>/{MAX_VARIANTS} • sťahovanie: {leadSubmitted ? "✅ odomknuté" : "🔒 po formulári"}
              </div>
            </div>
            {!isMobile ? (
              <button type="button" onClick={onDownloadAllClick} disabled={variants.length === 0} style={{ ...btnStyle, opacity: variants.length === 0 ? 0.55 : 1, cursor: variants.length === 0 ? "not-allowed" : "pointer" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon name="download" size={16} />
                  Stiahnuť všetky ({variants.length})
                </span>
              </button>
            ) : null}
          </div>

          <div style={{ padding: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10 }} role="list" aria-label="Varianty vizualizácie">
              {Array.from({ length: MAX_VARIANTS }).map((_, i) => {
                const v = variants[i] || null;
                const selected = selectedVariantIndex === i;

                return (
                  <div key={i} style={{ display: "grid", gap: 0 }}>
                    <button
                      type="button"
                      onClick={() => {
                        if (!v) return;
                        setSelectedVariantIndex(i);
                        openPreview(i);
                      }}
                      disabled={!v}
                      style={{
                        border: selected ? "3px solid rgba(0,0,0,0.85)" : "1px solid rgba(0,0,0,0.10)",
                        background: selected ? "#fff" : "rgba(0,0,0,0.015)",
                        borderRadius: 14,
                        overflow: "hidden",
                        textAlign: "left",
                        padding: 0,
                        cursor: v ? "pointer" : "default",
                        opacity: v ? 1 : 0.75,
                      }}
                      aria-label={v ? `Vybrať variant ${i + 1}` : `Variant ${i + 1} (prázdny)`}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "10px 10px 8px", borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.02)" }}>
                        <div>
                          <div style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.75)" }}>Variant {i + 1}</div>
                          {v ? <div style={{ fontWeight: 900, fontSize: 12, color: "rgba(0,0,0,0.60)" }}>{typeLabel(v.type)}</div> : null}
                        </div>
                        {selected ? <div style={{ fontWeight: 950, fontSize: 12, color: "rgba(0,0,0,0.9)" }}>Vybrané</div> : null}
                      </div>

                      {v ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={`data:image/png;base64,${v.b64}`} alt={`Variant ${i + 1}`} style={{ width: "100%", height: 140, objectFit: "cover", display: "block" }} />
                      ) : (
                        <div style={{ padding: "14px 10px", fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.45)" }}>Zatiaľ nevygenerované</div>
                      )}
                    </button>

                    {v ? (
                      <div style={{ display: "flex", gap: 8, padding: 10, borderTop: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.015)" }}>
                        <button type="button" onClick={() => onDownloadOne(i)} style={smallBtnStyle}>
                          Stiahnuť
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedVariantIndex(i);
                            if (!leadSubmitted) {
                              setPendingAction({ kind: "single", index: i });
                              setLeadOpen(true);
                            }
                          }}
                          style={{
                            ...smallBtnStyle,
                            background: selected ? "#111" : "#fff",
                            color: selected ? "#fff" : "#111",
                            borderColor: selected ? "#111" : "rgba(0,0,0,0.14)",
                          }}
                        >
                          Vybrať do formulára
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile fixed bottom actions like screenshot */}
      {isMobile ? (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            background: "rgba(246,246,246,0.92)",
            backdropFilter: "blur(10px)",
            borderTop: "1px solid rgba(0,0,0,0.08)",
            padding: "12px 14px",
            zIndex: 55,
          }}
        >
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <button
              type="button"
              onClick={generate}
              disabled={!canGenerate}
              style={{
                height: 48,
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.14)",
                background: !canGenerate ? "rgba(0,0,0,0.10)" : "#111",
                color: !canGenerate ? "rgba(0,0,0,0.45)" : "#fff",
                fontWeight: 950,
                fontSize: 15,
                cursor: !canGenerate ? "not-allowed" : "pointer",
              }}
            >
              {loading ? "Generujem..." : variants.length >= MAX_VARIANTS ? `Limit ${MAX_VARIANTS}` : `Vygenerovať (${variants.length + 1}/${MAX_VARIANTS})`}
            </button>

            <button
              type="button"
              onClick={onDownloadAllClick}
              disabled={variants.length === 0}
              style={{
                height: 48,
                borderRadius: 999,
                border: "1px solid rgba(0,0,0,0.14)",
                background: "#fff",
                color: variants.length === 0 ? "rgba(0,0,0,0.45)" : "#111",
                fontWeight: 950,
                fontSize: 15,
                cursor: variants.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Stiahnuť všetky
            </button>
          </div>
        </div>
      ) : null}

      {/* Lead modal */}
      {leadOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) closeLeadForm();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "min(900px, 100%)",
              borderRadius: 18,
              background: "#fff",
              border: "1px solid rgba(0,0,0,0.12)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.22)",
              overflow: "hidden",
              maxHeight: "calc(100dvh - 32px)",
              display: "grid",
              gridTemplateRows: "auto 1fr",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(0,0,0,0.06)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 950, fontSize: 16 }}>Vyplň kontaktné údaje, poznámku a vyber vizualizáciu</div>
                <div style={{ marginTop: 6, color: "rgba(0,0,0,0.65)", fontWeight: 650, fontSize: 13 }}>
                  Pre odomknutie sťahovania je potrebné vyplniť formulár a vybrať <b>1 vizualizáciu</b>, ktorú nám pošleš.
                </div>
              </div>
              <button type="button" onClick={closeLeadForm} style={btnStyle}>
                ✕
              </button>
            </div>

            <div style={{ padding: "14px 16px 16px", overflow: "auto", WebkitOverflowScrolling: "touch" }}>
              <form onSubmit={submitLead} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <div style={labelStyle}>Vyber vizualizáciu *</div>

                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 10, marginTop: 10 }}>
                    {variants.map((v, i) => {
                      const sel = selectedVariantIndex === i;
                      return (
                        <button
                          type="button"
                          key={v.id}
                          onClick={() => setSelectedVariantIndex(i)}
                          style={{
                            borderRadius: 14,
                            overflow: "hidden",
                            border: sel ? "3px solid rgba(0,0,0,0.85)" : "1px solid rgba(0,0,0,0.14)",
                            background: sel ? "#fff" : "rgba(0,0,0,0.01)",
                            cursor: "pointer",
                            padding: 0,
                            textAlign: "left",
                          }}
                        >
                          <div style={{ padding: 10, borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.02)", display: "flex", justifyContent: "space-between" }}>
                            <div>
                              <b>Variant {i + 1}</b>
                              <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.6)", marginTop: 2 }}>{typeLabel(v.type)}</div>
                            </div>
                            <div style={{ fontSize: 12, fontWeight: 950, color: sel ? "rgba(0,0,0,0.9)" : "rgba(0,0,0,0.55)" }}>{sel ? "Vybrané" : ""}</div>
                          </div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={`data:image/png;base64,${v.b64}`} alt={`Variant ${i + 1}`} style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }} />
                        </button>
                      );
                    })}
                  </div>
                  {leadErr.selectedVariant ? <div style={errTextStyle}>{leadErr.selectedVariant}</div> : null}
                </div>

                <div>
                  <div style={labelStyle}>Meno a priezvisko *</div>
                  <input
                    value={lead.name}
                    onChange={(e) => setLead((p) => ({ ...p, name: e.target.value }))}
                    style={inputStyle}
                    placeholder="napr. Ján Novák"
                  />
                  {leadErr.name ? <div style={errTextStyle}>{leadErr.name}</div> : null}
                </div>

                <div>
                  <div style={labelStyle}>Mesto *</div>
                  <input
                    value={lead.city}
                    onChange={(e) => setLead((p) => ({ ...p, city: e.target.value }))}
                    style={inputStyle}
                    placeholder="napr. Prešov"
                  />
                  {leadErr.city ? <div style={errTextStyle}>{leadErr.city}</div> : null}
                </div>

                <div>
                  <div style={labelStyle}>Telefón *</div>
                  <input
                    value={lead.phone}
                    onChange={(e) => setLead((p) => ({ ...p, phone: e.target.value }))}
                    style={inputStyle}
                    placeholder="napr. +421 9xx xxx xxx"
                  />
                  {leadErr.phone ? <div style={errTextStyle}>{leadErr.phone}</div> : null}
                </div>

                <div>
                  <div style={labelStyle}>Email *</div>
                  <input
                    value={lead.email}
                    onChange={(e) => setLead((p) => ({ ...p, email: e.target.value }))}
                    style={inputStyle}
                    placeholder="napr. jan@novak.sk"
                  />
                  {leadErr.email ? <div style={errTextStyle}>{leadErr.email}</div> : null}
                </div>

                <div>
                  <div style={labelStyle}>Šírka (približne) *</div>
                  <input
                    value={lead.approxWidth}
                    onChange={(e) => setLead((p) => ({ ...p, approxWidth: e.target.value }))}
                    style={inputStyle}
                    placeholder="napr. 4.2 m"
                  />
                  {leadErr.approxWidth ? <div style={errTextStyle}>{leadErr.approxWidth}</div> : null}
                </div>

                <div>
                  <div style={labelStyle}>Hĺbka (približne) *</div>
                  <input
                    value={lead.approxDepth}
                    onChange={(e) => setLead((p) => ({ ...p, approxDepth: e.target.value }))}
                    style={inputStyle}
                    placeholder="napr. 3.0 m"
                  />
                  {leadErr.approxDepth ? <div style={errTextStyle}>{leadErr.approxDepth}</div> : null}
                </div>

                <div>
                  <div style={labelStyle}>Výška (približne) *</div>
                  <input
                    value={lead.approxHeight}
                    onChange={(e) => setLead((p) => ({ ...p, approxHeight: e.target.value }))}
                    style={inputStyle}
                    placeholder="napr. 2.6 m"
                  />
                  {leadErr.approxHeight ? <div style={errTextStyle}>{leadErr.approxHeight}</div> : null}
                </div>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <div style={labelStyle}>Poznámka (voliteľné)</div>
                  <textarea
                    value={lead.customerNote}
                    onChange={(e) => setLead((p) => ({ ...p, customerNote: e.target.value }))}
                    style={{ ...inputStyle, minHeight: 92, resize: "vertical" }}
                    placeholder="napr. chcem antracit, kotvenie do zateplenia, atď."
                  />
                </div>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end", alignItems: "center", paddingTop: 6, flexWrap: "wrap" }}>
                  <button type="button" onClick={closeLeadForm} disabled={leadSubmitting} style={{ ...btnStyle, opacity: leadSubmitting ? 0.6 : 1 }}>
                    Zrušiť
                  </button>
                  <button
                    type="submit"
                    disabled={leadSubmitting}
                    style={{
                      ...btnStyle,
                      background: "#111",
                      color: "#fff",
                      borderColor: "#111",
                      opacity: leadSubmitting ? 0.7 : 1,
                      cursor: leadSubmitting ? "not-allowed" : "pointer",
                    }}
                  >
                    {leadSubmitting ? "Odosielam..." : "Odoslať a odomknúť sťahovanie"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {/* Preview modal */}
      {previewOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) closePreview();
          }}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.70)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 9998,
          }}
        >
          <div
            style={{
              width: "min(980px, 100%)",
              borderRadius: 18,
              background: "#111",
              border: "1px solid rgba(255,255,255,0.14)",
              boxShadow: "0 30px 90px rgba(0,0,0,0.35)",
              overflow: "hidden",
              maxHeight: "calc(100dvh - 32px)",
              display: "grid",
              gridTemplateRows: "auto 1fr",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ color: "rgba(255,255,255,0.9)", fontWeight: 950 }}>
                Variant {previewIndex + 1} • {variants[previewIndex] ? typeLabel(variants[previewIndex].type) : ""}
              </div>
              <button type="button" onClick={closePreview} style={{ ...btnStyle, background: "rgba(255,255,255,0.10)", color: "#fff", borderColor: "rgba(255,255,255,0.12)" }}>
                ✕
              </button>
            </div>

            <div style={{ padding: 14, overflow: "auto", WebkitOverflowScrolling: "touch" }}>
              {variants[previewIndex]?.b64 ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`data:image/png;base64,${variants[previewIndex].b64}`}
                  alt={`Preview variant ${previewIndex + 1}`}
                  style={{ width: "100%", height: "auto", display: "block", borderRadius: 14 }}
                />
              ) : (
                <div style={{ color: "rgba(255,255,255,0.75)", padding: 18 }}>Nie je čo zobraziť.</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Stepper({ current }: { current: number }) {
  const items = [
    { id: 1, label: "Nahraj fotku" },
    { id: 2, label: "Umiestni pergolu" },
    { id: 3, label: "Vygeneruj vizualizácie" },
    { id: 4, label: "Odošli dopyt & stiahni PNG" },
  ];

  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {items.map((it) => {
        const done = it.id < current;
        const active = it.id === current;

        return (
          <div
            key={it.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.10)",
              background: active ? "#fff" : done ? "rgba(0,0,0,0.05)" : "transparent",
              boxShadow: active ? "0 12px 28px rgba(0,0,0,0.10)" : "none",
              fontWeight: 900,
              color: active ? "#111" : done ? "rgba(0,0,0,0.70)" : "rgba(0,0,0,0.45)",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <span
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                background: active ? "#111" : done ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.12)",
                color: active ? "#fff" : done ? "#111" : "rgba(0,0,0,0.55)",
                fontSize: 12,
                fontWeight: 950,
              }}
            >
              {it.id}
            </span>
            <span style={{ fontSize: 12, letterSpacing: "0.02em" }}>{it.label}</span>
          </div>
        );
      })}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const smallBtnStyle: React.CSSProperties = {
  flex: 1,
  padding: "10px 12px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
};

const chipStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "#fff",
  color: "#111",
  fontWeight: 900,
  cursor: "pointer",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "rgba(0,0,0,0.60)",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 12px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "#fff",
  color: "#111",
  outline: "none",
  fontWeight: 800,
  fontSize: 14,
};

const errorBoxStyle: React.CSSProperties = {
  background: "rgba(150,0,0,0.06)",
  border: "1px solid rgba(150,0,0,0.18)",
  color: "rgba(150,0,0,0.9)",
  borderRadius: 14,
  padding: "12px 12px",
  fontWeight: 850,
};

const errTextStyle: React.CSSProperties = {
  marginTop: 8,
  fontSize: 12,
  color: "rgba(150,0,0,0.9)",
  fontWeight: 850,
};
