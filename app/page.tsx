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
        <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(0,0,0,0.65)" }}>
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

  const [pos, setPos] = useState<Vec2>({ x: 0.5, y: 0.72 });
  const [rot2D, setRot2D] = useState(0);
  const [rot3D, setRot3D] = useState({ yaw: 0.35, pitch: -0.12 });
  const [scalePct, setScalePct] = useState({ x: 100, y: 100, z: 100 });

  // mobile defaults
  useEffect(() => {
    if (!isMobileRef.current) return;
    setScalePct({ x: 75, y: 75, z: 75 });
    setPos({ x: 0.5, y: 0.78 });
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

  const [prompt] = useState(FINAL_PROMPT_DEFAULT);

  // ===== Variants =====
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
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
    setError("");
    setPanel("zoom");
    setPanelOpen(false);
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
          rollMode: false,
        };
        return;
      }
    }

    let rollMode = false;
    if (mode === "rotate3d" && bboxRect) {
      const cx = bboxRect.x + bboxRect.w / 2;
      const edgeThreshold = Math.max(24, bboxRect.w * 0.35);
      rollMode = Math.abs(p.x - cx) > edgeThreshold;
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
      rollMode,
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
      if (dragRef.current.rollMode) {
        const roll = dragRef.current.startRot2D + dy * 0.01;
        setRot2D(roll);
      } else {
        const yaw = dragRef.current.startRot3D.yaw + dx * 0.01;
        const pitch = dragRef.current.startRot3D.pitch + dy * 0.01;
        setRot3D({ yaw, pitch: clamp(pitch, -1.25, 1.25) });
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
        <CustomSlider min={50} max={160} step={5} value={editorZoom} onChange={(v) => setEditorZoom(Math.round(v))} label="Zoom" suffix="%" />
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

  const stepCurrent = useMemo(() => {
    const hasAnyVariant = variants.length > 0;
    if (!bgImg) return 1;
    if (!hasAnyVariant) return 2;
    if (!leadSubmitted) return 4;
    return 5;
  }, [bgImg, variants.length, leadSubmitted]);

  return (
    <section style={{ background: "#f6f6f6", color: "#111", padding: "28px 16px 90px", fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto" }}>
      <div style={{ maxWidth: 1180, margin: "0 auto", display: "grid", gap: 14 }}>
        {/* Hero */}
        <div style={{ display: "grid", gap: 10 }}>
          <h2 style={{ margin: 0, fontSize: 34, lineHeight: 1.15, letterSpacing: "-0.02em" }}>Vizualizácia pergoly na vašom dome</h2>
          <p style={{ margin: 0, color: "rgba(0,0,0,0.70)", fontSize: 16, maxWidth: "110ch" }}>
            Nahrajte fotku, umiestnite pergolu a vytvorte si až <b>6 variantov</b>. <br />
            Sťahovanie PNG je dostupné až po vyplnení formulára a výbere jednej vizualizácie, ktorú nám odošlete (plus môžete dopísať poznámku).
          </p>

          <Stepper current={stepCurrent} />
        </div>

        {/* Editor card */}
        <div style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", borderRadius: 18, boxShadow: "0 10px 30px rgba(0,0,0,0.06)", overflow: "hidden" }}>
          <div style={{ padding: "14px 16px", borderBottom: "1px solid rgba(0,0,0,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <div style={{ fontSize: 18, fontWeight: 950 }}>Editor</div>
            <div style={{ fontSize: 14, fontWeight: 850, color: "rgba(0,0,0,0.55)" }}>
              Režim: <span style={{ color: "rgba(0,0,0,0.9)" }}>{mode === "move" ? "POSUN" : mode === "rotate3d" ? "OTOČ 3D" : "RESIZE"}</span>
            </div>
          </div>

          <div style={{ padding: 14, display: "grid", gap: 12 }}>
            {/* Mode controls like screenshot */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Segmented
                value={mode}
                onChange={(v) => setMode(v as Mode)}
                items={[
                  { value: "move", label: "Posun", icon: <Icon name="move" size={16} /> },
                  { value: "rotate3d", label: "Otoč 3D", icon: <Icon name="rotate" size={16} /> },
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

                {!isMobile ? (
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
                ) : null}
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => togglePanel("zoom")} style={{ ...chipStyle, background: panelOpen && panel === "zoom" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                  <Icon name="zoom" size={16} />
                  Zoom
                </span>
              </button>
              <button type="button" onClick={() => togglePanel("x")} style={{ ...chipStyle, background: panelOpen && panel === "x" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                Šírka
              </button>
              <button type="button" onClick={() => togglePanel("y")} style={{ ...chipStyle, background: panelOpen && panel === "y" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                Výška
              </button>
              <button type="button" onClick={() => togglePanel("z")} style={{ ...chipStyle, background: panelOpen && panel === "z" ? "rgba(0,0,0,0.06)" : "#fff" }}>
                Hĺbka
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
            <button type="button" onClick={onDownloadAllClick} disabled={variants.length === 0} style={{ ...btnStyle, opacity: variants.length === 0 ? 0.55 : 1, cursor: variants.length === 0 ? "not-allowed" : "pointer" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                <Icon name="download" size={16} />
                Stiahnuť všetky ({variants.length})
              </span>
            </button>
          </div>

          <div style={{ padding: 14 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)",
                gap: 10,
              }}
              role="list"
              aria-label="Varianty vizualizácie"
            >
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
                  Pre odomknutie sťahovania je potrebné vyplniť formulár a vybrať <b>1 vizualizáciu</b>, ktorú nám odošleš.
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

                <Field label="Meno *" error={leadErr.name}>
                  <input value={lead.name} onChange={(e) => setLead((p) => ({ ...p, name: e.target.value }))} placeholder="Meno a priezvisko" style={inputStyle} />
                </Field>

                <Field label="Mesto *" error={leadErr.city}>
                  <input value={lead.city} onChange={(e) => setLead((p) => ({ ...p, city: e.target.value }))} placeholder="Mesto" style={inputStyle} />
                </Field>

                <Field label="Telefón *" error={leadErr.phone}>
                  <input value={lead.phone} onChange={(e) => setLead((p) => ({ ...p, phone: e.target.value }))} placeholder="+421 9xx xxx xxx" inputMode="tel" style={inputStyle} />
                </Field>

                <Field label="Emailová adresa *" error={leadErr.email}>
                  <input value={lead.email} onChange={(e) => setLead((p) => ({ ...p, email: e.target.value }))} placeholder="meno@domena.sk" inputMode="email" style={inputStyle} />
                </Field>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <div style={labelStyle}>Približné rozmery pergoly *</div>
                  <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: 12, marginTop: 10 }}>
                    <Field label="Šírka" error={leadErr.approxWidth}>
                      <input value={lead.approxWidth} onChange={(e) => setLead((p) => ({ ...p, approxWidth: e.target.value }))} placeholder="napr. 4.0 m" style={inputStyle} />
                    </Field>
                    <Field label="Hĺbka" error={leadErr.approxDepth}>
                      <input value={lead.approxDepth} onChange={(e) => setLead((p) => ({ ...p, approxDepth: e.target.value }))} placeholder="napr. 3.5 m" style={inputStyle} />
                    </Field>
                    <Field label="Výška" error={leadErr.approxHeight}>
                      <input value={lead.approxHeight} onChange={(e) => setLead((p) => ({ ...p, approxHeight: e.target.value }))} placeholder="napr. 2.6 m" style={inputStyle} />
                    </Field>
                  </div>
                  {leadErr.approxWidth || leadErr.approxDepth || leadErr.approxHeight ? (
                    <div style={{ display: "grid", gap: 2, marginTop: 8 }}>
                      {leadErr.approxWidth ? <div style={errTextStyle}>{leadErr.approxWidth}</div> : null}
                      {leadErr.approxDepth ? <div style={errTextStyle}>{leadErr.approxDepth}</div> : null}
                      {leadErr.approxHeight ? <div style={errTextStyle}>{leadErr.approxHeight}</div> : null}
                    </div>
                  ) : null}
                </div>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1" }}>
                  <div style={labelStyle}>Poznámka (voliteľné)</div>
                  <textarea
                    value={lead.customerNote}
                    onChange={(e) => setLead((p) => ({ ...p, customerNote: e.target.value }))}
                    placeholder="Napr. farba, umiestnenie, poznámka k realizácii..."
                    style={{ ...inputStyle, minHeight: 96, resize: "vertical", paddingTop: 10 }}
                  />
                </div>

                <div style={{ gridColumn: isMobile ? "auto" : "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6, flexWrap: "wrap" }}>
                  <button type="button" onClick={closeLeadForm} style={{ ...btnStyle, background: "#fff" }}>
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
                      cursor: leadSubmitting ? "not-allowed" : "pointer",
                      opacity: leadSubmitting ? 0.7 : 1,
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
    </section>
  );
}

function Stepper({ current }: { current: number }) {
  const steps = [
    { n: 1, t: "Nahraj fotku" },
    { n: 2, t: "Umiestni pergolu" },
    { n: 3, t: "Vygeneruj varianty" },
    { n: 4, t: "Vyplň formulár" },
    { n: 5, t: "Stiahni PNG" },
  ];
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      {steps.map((s) => {
        const done = s.n < current;
        const active = s.n === current;
        return (
          <div
            key={s.n}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 10px",
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.10)",
              background: active ? "#fff" : "rgba(0,0,0,0.03)",
              boxShadow: active ? "0 10px 22px rgba(0,0,0,0.08)" : "none",
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                fontSize: 11,
                fontWeight: 950,
                background: done ? "#111" : "rgba(0,0,0,0.08)",
                color: done ? "#fff" : "rgba(0,0,0,0.70)",
              }}
            >
              {done ? "✓" : s.n}
            </div>
            <div style={{ fontSize: 12, fontWeight: 900, color: active ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.60)" }}>{s.t}</div>
          </div>
        );
      })}
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <div style={labelStyle}>{label}</div>
      {children}
      {error ? <div style={errTextStyle}>{error}</div> : null}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  height: 42,
  padding: "0 14px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const chipStyle: React.CSSProperties = {
  height: 38,
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.12)",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const smallBtnStyle: React.CSSProperties = {
  height: 34,
  padding: "0 12px",
  borderRadius: 999,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "#fff",
  fontWeight: 900,
  cursor: "pointer",
  userSelect: "none",
  WebkitUserSelect: "none",
};

const inputStyle: React.CSSProperties = {
  height: 42,
  padding: "0 12px",
  borderRadius: 12,
  border: "1px solid rgba(0,0,0,0.14)",
  background: "#fff",
  fontWeight: 800,
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 950,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "rgba(0,0,0,0.55)",
};

const errTextStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: "#b00020",
};

const errorBoxStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(176,0,32,0.25)",
  background: "rgba(176,0,32,0.06)",
  color: "rgba(176,0,32,0.95)",
  fontWeight: 850,
  fontSize: 13,
};
