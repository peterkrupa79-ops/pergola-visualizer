"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type PergolaType = "bioklim" | "pevna" | "zimna";
type Mode = "move" | "rotate3d" | "resize";
type Vec2 = { x: number; y: number };

type HandleId = "nw" | "ne" | "se" | "sw";
const HANDLE_R = 9;
const HANDLE_HIT = 18;

const SCALE_STEP = 0.5;
const SCALE_MIN = 1;
const SCALE_MAX = 200;

// auto-normalizácia veľkosti GLB (štartná veľkosť pri 100%)
const TARGET_MODEL_MAX_DIM_AT_100 = 1.7;

const FINAL_PROMPT_DEFAULT = `HARMONIZE ONLY. Keep the exact original geometry and perspective.
Do NOT change the pergola shape, size, thickness, leg width, proportions, spacing, angle, or any structural details.
Do NOT add/remove objects. Do NOT crop. Do NOT change camera position, lens, or viewpoint.
Only adjust lighting, shadows, reflections, color grading, noise, sharpness, and blending so the pergola looks photo-realistic in the scene.`;

const MAX_VARIANTS = 6;

const CANVAS_BG = "#0b0f16";

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
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
  name:
    | "upload"
    | "move"
    | "rotate"
    | "resize"
    | "reset"
    | "sparkles"
    | "download"
    | "zoom";
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

function SegBtn({
  active,
  onClick,
  children,
  title,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 12px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
        color: "rgba(255,255,255,0.92)",
        fontSize: 14,
        lineHeight: 1,
        userSelect: "none",
        WebkitUserSelect: "none",
      }}
    >
      {children}
    </button>
  );
}

function ChipBtn({
  active,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 12px",
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.12)",
        background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.05)",
        color: "rgba(255,255,255,0.92)",
        fontSize: 14,
        lineHeight: 1,
        userSelect: "none",
        WebkitUserSelect: "none",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </button>
  );
}

function PrimaryBtn({
  onClick,
  children,
  icon,
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.14)",
        background: disabled
          ? "rgba(255,255,255,0.08)"
          : "linear-gradient(135deg, rgba(63,181,255,0.24), rgba(255,255,255,0.06))",
        color: "rgba(255,255,255,0.95)",
        fontSize: 14,
        fontWeight: 650,
        userSelect: "none",
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function GhostBtn({
  onClick,
  children,
  icon,
  disabled,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "12px 14px",
        borderRadius: 12,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
        color: "rgba(255,255,255,0.92)",
        fontSize: 14,
        fontWeight: 650,
        userSelect: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      {icon}
      {children}
    </button>
  );
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
    // avoid float artefacts
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
    <div
      style={{
        display: "grid",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 14,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.04)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>{label ?? "Hodnota"}</div>
        <div style={{ color: "rgba(255,255,255,0.95)", fontSize: 13, fontWeight: 700 }}>
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
          height: 22,
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
          outline: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${clamp(pct, 0, 100)}%`,
            borderRadius: 999,
            background: "rgba(63,181,255,0.45)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${clamp(pct, 0, 100)}%`,
            transform: "translate(-50%, -50%)",
            width: 18,
            height: 18,
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            boxShadow: "0 6px 18px rgba(0,0,0,0.35)",
          }}
        />
      </div>
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

  // ======================
  // BG upload
  // ======================
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

  // ======================
  // Pergola type / model
  // ======================
  const [pergolaType, setPergolaType] = useState<PergolaType>("bioklim");
  const glbPath = useMemo(() => {
    if (pergolaType === "bioklim") return "/models/bioklim.glb";
    if (pergolaType === "pevna") return "/models/pevna.glb";
    return "/models/zimna.glb";
  }, [pergolaType]);

  // ======================
  // Canvas sizing (responsive)
  // ======================
  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({ w: 980, h: 560 });
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const compute = () => {
      const availW = Math.max(320, Math.floor(window.innerWidth - 28));
      const maxW = Math.min(1100, availW);
      const h = Math.max(240, Math.round((maxW * 560) / 980));
      setCanvasSize({ w: maxW, h });
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  const canvasW = canvasSize.w;
  const canvasH = canvasSize.h;

  // ======================
  // Editor state (like page3)
  // ======================
  const [mode, setMode] = useState<Mode>("move");
  const [panel, setPanel] = useState<"zoom" | "x" | "y" | "z">("zoom");

  const [editorZoom, setEditorZoom] = useState(100);

  const [pos, setPos] = useState<Vec2>({ x: 0.5, y: 0.72 });
  const [rot2D, setRot2D] = useState(0);
  const [rot3D, setRot3D] = useState({ yaw: 0.35, pitch: -0.12 });
  const [scalePct, setScalePct] = useState({ x: 100, y: 100, z: 100 });

  // mobile default smaller
  useEffect(() => {
    if (!isMobileRef.current) return;
    setScalePct({ x: 75, y: 75, z: 75 });
    setPos({ x: 0.5, y: 0.78 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [bboxRect, setBboxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [activeHandle, setActiveHandle] = useState<HandleId | null>(null);

  // ======================
  // Three.js refs (render to 2D canvas)
  // ======================
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const threeReadyRef = useRef(false);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const rootRef = useRef<any>(null);
  const baseScaleRef = useRef<number>(1);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [prompt] = useState(FINAL_PROMPT_DEFAULT);

  // ======================
  // Variants (max 6)
  // ======================
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  const remaining = Math.max(0, MAX_VARIANTS - variants.length);
  const canGenerate = !!bgImg && !loading && variants.length < MAX_VARIANTS;

  // ======================
  // Lead gating
  // ======================
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

  // ======================
  // Helpers
  // ======================
  function setScaleAxis(axis: "x" | "y" | "z", value: number) {
    setScalePct((prev) => ({ ...prev, [axis]: clampPct(value) }));
  }

  function resetAll() {
    setScalePct(isMobileRef.current ? { x: 75, y: 75, z: 75 } : { x: 100, y: 100, z: 100 });
    setRot3D({ yaw: 0.35, pitch: -0.12 });
    setRot2D(0);
    setPos(isMobileRef.current ? { x: 0.5, y: 0.78 } : { x: 0.5, y: 0.72 });
    setError("");
    setPanel("zoom");
    setSelectedVariantIndex(0);
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

  // ======================
  // THREE INIT / RELOAD
  // ======================
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

        const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.9);
        scene.add(hemi);

        const dir = new THREE.DirectionalLight(0xffffff, 1.05);
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

        // normalize
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
  }, [bgImg, canvasW, canvasH, editorZoom, pos, rot2D, rot3D, scalePct, mode]);

  function applyTransformsForCurrentState(width: number, height: number) {
    if (!threeReadyRef.current || !cameraRef.current || !rootRef.current) return;

    const camera = cameraRef.current;
    const root = rootRef.current;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();

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

    // clear + dark bg
    ctx.clearRect(0, 0, canvasW, canvasH);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvasW, canvasH);

    // background photo (cover)
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
      ctx.fillStyle = "rgba(255,255,255,0.75)";
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

          // dashed bbox
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.55)";
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

  // ===========================
  // ✅ 1 PRST = VŽDY EDIT CANVAS
  // ===========================
  const dragRef = useRef<{
    active: boolean;
    start: Vec2;
    startPos: Vec2;
    startRot3D: { yaw: number; pitch: number };
    startRot2D: number;
    startScalePct: { x: number; y: number; z: number };
    handle: HandleId | null;
    modeAtDown: Mode;
  }>({
    active: false,
    start: { x: 0, y: 0 },
    startPos: { x: 0.5, y: 0.72 },
    startRot3D: { yaw: 0.35, pitch: -0.12 },
    startRot2D: 0,
    startScalePct: { x: 100, y: 100, z: 100 },
    handle: null,
    modeAtDown: "move",
  });

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = toCanvasXY(e);

    e.preventDefault();
    (e.currentTarget as any).setPointerCapture(e.pointerId);

    if (mode === "resize" && bboxRect) {
      const h = hitHandle(p, bboxRect);
      if (h) {
        setActiveHandle(h);
        dragRef.current = {
          active: true,
          start: p,
          startPos: pos,
          startRot3D: rot3D,
          startRot2D: rot2D,
          startScalePct: scalePct,
          handle: h,
          modeAtDown: "resize",
        };
        return;
      }
    }

    dragRef.current = {
      active: true,
      start: p,
      startPos: pos,
      startRot3D: rot3D,
      startRot2D: rot2D,
      startScalePct: scalePct,
      handle: null,
      modeAtDown: mode,
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
      const yaw = dragRef.current.startRot3D.yaw + dx * 0.01;
      const pitch = dragRef.current.startRot3D.pitch + dy * 0.01;
      setRot3D({ yaw, pitch: clamp(pitch, -1.25, 1.25) });
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
    setActiveHandle(null);

    try {
      (e.currentTarget as any).releasePointerCapture?.(e.pointerId);
    } catch {}
  }

  // ======================
  // Generate (real API)
  // ======================
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

      if (!threeReadyRef.current || !rendererRef.current || !sceneRef.current || !cameraRef.current || !rootRef.current) {
        throw new Error("3D renderer nie je pripravený.");
      }

      const renderer = rendererRef.current;
      const scene = sceneRef.current;

      applyTransformsForCurrentState(outW, outH);
      renderer.setSize(outW, outH, false);
      renderer.render(scene, cameraRef.current);

      const glTemp = renderer.domElement;
      octx.drawImage(glTemp, 0, 0);

      const blob: Blob = await new Promise((res, rej) =>
        out.toBlob((b) => (b ? res(b) : rej(new Error("toBlob vrátil null"))), "image/jpeg", 0.9)
      );

      const form = new FormData();
      form.append("image", blob, "collage.jpg");
      form.append("prompt", prompt);

      const r = await fetch("/api/render/openai", { method: "POST", body: form });

      const j = await r.json().catch(async () => {
        const t = await r.text().catch(() => "");
        return { error: t || `HTTP ${r.status}` };
      });

      if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`);
      if (!j?.b64) throw new Error("API nevrátilo b64.");

      setVariants((prev) => {
        if (prev.length >= MAX_VARIANTS) return prev;
        const next = [...prev, { id: makeId(), type: pergolaType, b64: j.b64, createdAt: Date.now() }];
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
      return (
        <CustomSlider
          min={50}
          max={160}
          step={5}
          value={editorZoom}
          onChange={(v) => setEditorZoom(Math.round(v))}
          label="Zoom"
          suffix="%"
        />
      );
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

  return (
    <div
      ref={containerRef}
      style={{
        minHeight: "100vh",
        background: "#070a10",
        color: "white",
      }}
    >
      {/* Top bar 1 */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 30,
          padding: "12px 12px",
          background: "rgba(7,10,16,0.78)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 12,
              border: "1px solid rgba(255,255,255,0.12)",
              background: "rgba(255,255,255,0.04)",
              cursor: "pointer",
              userSelect: "none",
              WebkitUserSelect: "none",
            }}
          >
            <Icon name="upload" />
            <span style={{ fontSize: 14 }}>Upload fotky</span>
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setBgFile(f);
                setError("");
              }}
            />
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ opacity: 0.75, fontSize: 13, marginLeft: 4 }}>Typ pergoly:</span>
            <ChipBtn active={pergolaType === "bioklim"} onClick={() => setPergolaType("bioklim")}>
              Bioklimatická
            </ChipBtn>
            <ChipBtn active={pergolaType === "pevna"} onClick={() => setPergolaType("pevna")}>
              Pevná
            </ChipBtn>
            <ChipBtn active={pergolaType === "zimna"} onClick={() => setPergolaType("zimna")}>
              Zimná
            </ChipBtn>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <GhostBtn onClick={resetAll} icon={<Icon name="reset" />} disabled={loading}>
            Reset
          </GhostBtn>
          <PrimaryBtn onClick={generate} disabled={!canGenerate} icon={<Icon name="sparkles" />}>
            {loading ? "Generujem…" : variants.length >= MAX_VARIANTS ? `Limit ${MAX_VARIANTS}` : `Generate (${variants.length + 1}/${MAX_VARIANTS})`}
          </PrimaryBtn>
        </div>
      </div>

      {/* Top bar 2 */}
      <div
        style={{
          position: "sticky",
          top: 62,
          zIndex: 29,
          padding: "10px 12px",
          background: "rgba(7,10,16,0.72)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid rgba(255,255,255,0.08)",
          display: "flex",
          gap: 10,
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <SegBtn active={mode === "move"} onClick={() => setMode("move")} title="Posun">
            <Icon name="move" />
            Posun
          </SegBtn>
          <SegBtn active={mode === "rotate3d"} onClick={() => setMode("rotate3d")} title="Otoč 3D">
            <Icon name="rotate" />
            Otoč 3D
          </SegBtn>
          <SegBtn active={mode === "resize"} onClick={() => setMode("resize")} title="Resize">
            <Icon name="resize" />
            Resize
          </SegBtn>

          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.12)" }} />

          <ChipBtn active={panel === "zoom"} onClick={() => setPanel("zoom")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icon name="zoom" size={16} />
              Zoom
            </span>
          </ChipBtn>
          <ChipBtn active={panel === "x"} onClick={() => setPanel("x")}>
            Šírka
          </ChipBtn>
          <ChipBtn active={panel === "y"} onClick={() => setPanel("y")}>
            Výška
          </ChipBtn>
          <ChipBtn active={panel === "z"} onClick={() => setPanel("z")}>
            Hĺbka
          </ChipBtn>
        </div>

        <div style={{ opacity: 0.7, fontSize: 13 }}>
          1 prst = edit (na canvase) • zostáva {remaining}/{MAX_VARIANTS}
        </div>
      </div>

      {/* Main */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: isMobile ? "1fr" : "1fr 420px",
          gap: 14,
          padding: 14,
          alignItems: "start",
        }}
      >
        {/* Canvas */}
        <div
          style={{
            borderRadius: 18,
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.10)",
            background: "rgba(255,255,255,0.03)",
          }}
        >
          <div style={{ width: "100%", overflow: "auto" }}>
            <div
              style={{
                width: Math.round((canvasW * editorZoom) / 100),
                maxWidth: "100%",
              }}
            >
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
                  background: CANVAS_BG,
                }}
              />
            </div>
          </div>
        </div>

        {/* Right panel */}
        <div style={{ display: "grid", gap: 14 }}>
          {sliderBox}

          {error ? (
            <div
              style={{
                padding: "12px 12px",
                borderRadius: 16,
                border: "1px solid rgba(255,80,80,0.35)",
                background: "rgba(255,80,80,0.08)",
                color: "rgba(255,255,255,0.92)",
                fontSize: 13,
                fontWeight: 650,
              }}
            >
              Chyba: {error}
            </div>
          ) : null}

          <div
            style={{
              padding: "12px 12px",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
              <div style={{ fontSize: 14, fontWeight: 800 }}>Varianty (max {MAX_VARIANTS})</div>
              <div style={{ opacity: 0.75, fontSize: 12 }}>{leadSubmitted ? "✅ sťahovanie odomknuté" : "🔒 po formulári"}</div>
            </div>

            {variants.length === 0 ? (
              <div style={{ opacity: 0.72, fontSize: 13, marginTop: 10 }}>Zatiaľ nie sú vygenerované varianty.</div>
            ) : (
              <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                {variants.map((v, i) => {
                  const sel = selectedVariantIndex === i;
                  return (
                    <div
                      key={v.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "96px 1fr",
                        gap: 10,
                        alignItems: "center",
                        padding: 10,
                        borderRadius: 14,
                        border: sel ? "1px solid rgba(255,255,255,0.35)" : "1px solid rgba(255,255,255,0.10)",
                        background: sel ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.04)",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedVariantIndex(i)}
                        style={{
                          width: 96,
                          height: 72,
                          borderRadius: 12,
                          overflow: "hidden",
                          background: "rgba(255,255,255,0.06)",
                          border: "1px solid rgba(255,255,255,0.10)",
                          padding: 0,
                          cursor: "pointer",
                        }}
                        aria-label={`Vybrať variant ${i + 1}`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`data:image/png;base64,${v.b64}`}
                          alt={`Variant ${i + 1}`}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                        />
                      </button>

                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 800 }}>
                            Variant {i + 1} {sel ? "• vybrané" : ""}
                          </div>
                          <div style={{ opacity: 0.72, fontSize: 12 }}>{typeLabel(v.type)}</div>
                        </div>

                        <GhostBtn onClick={() => onDownloadOne(i)} icon={<Icon name="download" />}>
                          Stiahnuť
                        </GhostBtn>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {variants.length > 0 ? (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                <GhostBtn onClick={onDownloadAllClick} icon={<Icon name="download" />}>
                  Stiahnuť všetky ({variants.length})
                </GhostBtn>
              </div>
            ) : null}
          </div>
        </div>
      </div>

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
            background: "rgba(0,0,0,0.62)",
            display: "grid",
            placeItems: "center",
            padding: 16,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "min(940px, 100%)",
              borderRadius: 18,
              background: "#0b0f16",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 24px 80px rgba(0,0,0,0.45)",
              overflow: "hidden",
              color: "white",
            }}
          >
            <div
              style={{
                padding: "14px 16px",
                borderBottom: "1px solid rgba(255,255,255,0.10)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 900, fontSize: 15 }}>Vyplň kontaktné údaje, poznámku a vyber vizualizáciu</div>
                <div style={{ marginTop: 6, opacity: 0.78, fontSize: 13 }}>
                  Pre odomknutie sťahovania je potrebné vyplniť formulár a vybrať <b>1 vizualizáciu</b>, ktorú nám odošleš.
                </div>
              </div>
              <GhostBtn onClick={closeLeadForm}>✕</GhostBtn>
            </div>

            <div style={{ padding: "14px 16px 16px" }}>
              <form onSubmit={submitLead} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: 12 }}>
                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.8 }}>
                    Vyber vizualizáciu *
                  </div>

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
                            border: sel ? "2px solid rgba(255,255,255,0.85)" : "1px solid rgba(255,255,255,0.14)",
                            background: sel ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
                            cursor: "pointer",
                            padding: 0,
                            textAlign: "left",
                          }}
                        >
                          <div style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,0.10)", display: "flex", justifyContent: "space-between" }}>
                            <div style={{ fontWeight: 900, fontSize: 13 }}>Variant {i + 1}</div>
                            <div style={{ fontWeight: 900, fontSize: 12, opacity: sel ? 1 : 0.65 }}>{sel ? "Vybrané" : ""}</div>
                          </div>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={`data:image/png;base64,${v.b64}`}
                            alt={`Variant ${i + 1}`}
                            style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }}
                          />
                        </button>
                      );
                    })}
                  </div>
                  {leadErr.selectedVariant ? <div style={{ marginTop: 8, color: "rgba(255,140,140,0.95)", fontSize: 12, fontWeight: 800 }}>{leadErr.selectedVariant}</div> : null}
                </div>

                {/** inputs */}
                <Field label="Meno *" error={leadErr.name}>
                  <input
                    value={lead.name}
                    onChange={(e) => setLead((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Meno a priezvisko"
                    style={inputStyle}
                  />
                </Field>

                <Field label="Mesto *" error={leadErr.city}>
                  <input value={lead.city} onChange={(e) => setLead((p) => ({ ...p, city: e.target.value }))} placeholder="Mesto" style={inputStyle} />
                </Field>

                <Field label="Telefón *" error={leadErr.phone}>
                  <input
                    value={lead.phone}
                    onChange={(e) => setLead((p) => ({ ...p, phone: e.target.value }))}
                    placeholder="+421 9xx xxx xxx"
                    inputMode="tel"
                    style={inputStyle}
                  />
                </Field>

                <Field label="Emailová adresa *" error={leadErr.email}>
                  <input
                    value={lead.email}
                    onChange={(e) => setLead((p) => ({ ...p, email: e.target.value }))}
                    placeholder="meno@domena.sk"
                    inputMode="email"
                    style={inputStyle}
                  />
                </Field>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.8 }}>
                    Približné rozmery pergoly *
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12, marginTop: 10 }}>
                    <Field label="Šírka" error={leadErr.approxWidth}>
                      <input value={lead.approxWidth} onChange={(e) => setLead((p) => ({ ...p, approxWidth: e.target.value }))} placeholder="napr. 4.0 m" style={inputStyle} />
                    </Field>
                    <Field label="Hĺbka" error={leadErr.approxDepth}>
                      <input value={lead.approxDepth} onChange={(e) => setLead((p) => ({ ...p, approxDepth: e.target.value }))} placeholder="napr. 3.5 m" style={inputStyle} />
                    </Field>
                    <Field label="Výška" error={leadErr.approxHeight}>
                      <input value={lead.approxHeight} onChange={(e) => setLead((p) => ({ ...p, approxHeight: e.target.value }))} placeholder="napr. 2.5 m" style={inputStyle} />
                    </Field>
                  </div>
                </div>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.8 }}>
                    Poznámka zákazníka (voliteľné)
                  </div>
                  <textarea
                    value={lead.customerNote}
                    onChange={(e) => setLead((p) => ({ ...p, customerNote: e.target.value }))}
                    placeholder="Sem môžete dopísať doplňujúce informácie (napr. špecifiká terasy, požiadavky, termín, farba...)."
                    style={{
                      ...inputStyle,
                      minHeight: 110,
                      resize: "vertical",
                      lineHeight: 1.35,
                    }}
                  />
                </div>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                  <GhostBtn onClick={closeLeadForm} disabled={leadSubmitting}>
                    Zrušiť
                  </GhostBtn>
                  <PrimaryBtn disabled={leadSubmitting} icon={<Icon name="sparkles" />}>
                    {leadSubmitting ? "Odosielam..." : "Odoslať a odomknúť sťahovanie"}
                  </PrimaryBtn>
                </div>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1", marginTop: 6, fontSize: 13, opacity: 0.75, fontWeight: 650 }}>
                  Odoslaním formulára súhlasíte so spracovaním osobných údajov.
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// -------- small helper components/styles (outside Page to keep JSX clean) --------

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 12px",
  borderRadius: 12,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.04)",
  outline: "none",
  fontWeight: 700,
  color: "rgba(255,255,255,0.92)",
};

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", opacity: 0.8 }}>{label}</div>
      {children}
      {error ? <div style={{ color: "rgba(255,140,140,0.95)", fontSize: 12, fontWeight: 800 }}>{error}</div> : null}
    </div>
  );
}
