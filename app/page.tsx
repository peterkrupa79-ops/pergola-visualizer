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

const FINAL_PROMPT_DEFAULT =
  "Pergola variant render. Photorealistic, crisp edges, realistic lighting, keep proportions, no extra objects, match camera perspective.";

const CANVAS_BG = ""#ffffff"";
const DEFAULT_CANVAS_W = 1200;
const DEFAULT_CANVAS_H = 1200;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const roundStep = (v: number, step: number) => Math.round(v / step) * step;

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
    | "type"
    | "move"
    | "rotate"
    | "resize"
    | "reset"
    | "sparkles"
    | "download"
    | "close"
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
    case "type":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 6h16" />
          <path d="M9 6v14" />
          <path d="M15 6v14" />
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
    case "close":
      return (
        <svg {...common} fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M6 6l12 12" />
          <path d="M18 6l-12 12" />
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
        fontWeight: 600,
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
}: {
  onClick?: () => void;
  children: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
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
        fontWeight: 600,
        userSelect: "none",
        cursor: "pointer",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

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

  const pct = (value - min) / (max - min);
  const pctClamped = clamp(pct, 0, 1);

  const snap = (v: number) => {
    const stepped = roundStep(v, step);
    return clamp(stepped, min, max);
  };

  const setFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const t = (clientX - rect.left) / rect.width;
    const next = min + clamp(t, 0, 1) * (max - min);
    onChange(snap(next));
  };

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
        <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 13 }}>
          {label ?? "Hodnota"}
        </div>
        <div style={{ color: "rgba(255,255,255,0.95)", fontSize: 13, fontWeight: 600 }}>
          {value}
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
            (e.currentTarget as any).releasePointerCapture(e.pointerId);
          } catch {}
        }}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          height: 22,
          borderRadius: 999,
          background: "rgba(255,255,255,0.10)",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${pctClamped * 100}%`,
            borderRadius: 999,
            background: "rgba(63,181,255,0.45)",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: `${pctClamped * 100}%`,
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

/* ------------------------- 3D / Editor State ------------------------- */

type PergolaState = {
  pos: Vec2;
  yaw: number; // 2D rotácia
  pitch: number; // 3D rotácia okolo X
  roll: number; // 3D rotácia okolo Z
  w: number;
  h: number;
  d: number;
  zoom: number;
};

const DEFAULT_STATE: PergolaState = {
  pos: { x: 0, y: 0 },
  yaw: 0,
  pitch: 0,
  roll: 0,
  w: 400,
  h: 260,
  d: 340,
  zoom: 1,
};

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

/* ---------------------------- MAIN PAGE ----------------------------- */

export default function Page() {
  const isMobile = useMedia("(max-width: 920px)");

  const [bgImage, setBgImage] = useState<string | null>(null);
  const [pergolaType, setPergolaType] = useState<PergolaType>("bioklim");
  const [mode, setMode] = useState<Mode>("move");
  const [activeSlider, setActiveSlider] = useState<"w" | "h" | "d" | "zoom" | null>(
    "zoom"
  );

  const [state, setState] = useState<PergolaState>(DEFAULT_STATE);

  const [variants, setVariants] = useState<
    { id: string; label: string; url: string }[]
  >([]);

  const [loading, setLoading] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // --- Canvas interaction state
  const pointerDownRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const lastRef = useRef<Vec2 | null>(null);
  const activeHandleRef = useRef<HandleId | null>(null);

  const [canvasSize, setCanvasSize] = useState<{ w: number; h: number }>({
    w: DEFAULT_CANVAS_W,
    h: DEFAULT_CANVAS_H,
  });

  // maintain aspect ratio based on bg image
  useEffect(() => {
    if (!bgImage) return;
    const img = new Image();
    img.onload = () => {
      const ratio = img.width / img.height;
      const base = 1200;
      const w = base;
      const h = Math.round(base / ratio);
      setCanvasSize({ w, h });
    };
    img.src = bgImage;
  }, [bgImage]);

  const hitTestHandle = (p: Vec2) => {
    const { pos, w, h, yaw } = state;
    const cx = canvasSize.w / 2 + pos.x;
    const cy = canvasSize.h / 2 + pos.y;

    // Convert p into pergola-local coords (inverse rotation about center)
    const dx = p.x - cx;
    const dy = p.y - cy;
    const a = -degToRad(yaw);
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);

    const hw = w / 2;
    const hh = h / 2;
    const corners: Record<HandleId, Vec2> = {
      nw: { x: -hw, y: -hh },
      ne: { x: hw, y: -hh },
      se: { x: hw, y: hh },
      sw: { x: -hw, y: hh },
    };

    const hit = (id: HandleId) => {
      const c = corners[id];
      const dd = Math.hypot(lx - c.x, ly - c.y);
      return dd <= HANDLE_HIT;
    };

    if (hit("nw")) return "nw";
    if (hit("ne")) return "ne";
    if (hit("se")) return "se";
    if (hit("sw")) return "sw";
    return null;
  };

  const onCanvasPointerDown = (e: React.PointerEvent) => {
    if (!canvasRef.current) return;

    // enforce 1-finger edit (no scroll while on canvas)
    e.preventDefault();

    pointerDownRef.current = true;
    pointerIdRef.current = e.pointerId;
    canvasRef.current.setPointerCapture(e.pointerId);

    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasSize.w;
    const y = ((e.clientY - rect.top) / rect.height) * canvasSize.h;
    const p = { x, y };

    if (mode === "resize") {
      const h = hitTestHandle(p);
      activeHandleRef.current = h;
    } else {
      activeHandleRef.current = null;
    }

    lastRef.current = p;
  };

  const onCanvasPointerMove = (e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    if (!pointerDownRef.current) return;
    if (pointerIdRef.current !== e.pointerId) return;

    e.preventDefault();

    const rect = canvasRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvasSize.w;
    const y = ((e.clientY - rect.top) / rect.height) * canvasSize.h;
    const p = { x, y };

    const last = lastRef.current;
    if (!last) {
      lastRef.current = p;
      return;
    }

    const dx = p.x - last.x;
    const dy = p.y - last.y;

    setState((s) => {
      if (mode === "move") {
        return { ...s, pos: { x: s.pos.x + dx, y: s.pos.y + dy } };
      }
      if (mode === "rotate3d") {
        return {
          ...s,
          yaw: s.yaw + dx * 0.25,
          pitch: clamp(s.pitch + dy * 0.2, -80, 80),
        };
      }
      if (mode === "resize") {
        const handle = activeHandleRef.current;
        if (!handle) return s;
        const next = { ...s };
        // simple resize in screen space
        const dw = dx * (handle === "ne" || handle === "se" ? 1 : -1);
        const dh = dy * (handle === "se" || handle === "sw" ? 1 : -1);
        next.w = clamp(s.w + dw * 2, 80, 1200);
        next.h = clamp(s.h + dh * 2, 80, 1200);
        return next;
      }
      return s;
    });

    lastRef.current = p;
  };

  const onCanvasPointerUp = (e: React.PointerEvent) => {
    if (!canvasRef.current) return;
    if (pointerIdRef.current !== e.pointerId) return;

    e.preventDefault();

    pointerDownRef.current = false;
    pointerIdRef.current = null;
    lastRef.current = null;
    activeHandleRef.current = null;

    try {
      canvasRef.current.releasePointerCapture(e.pointerId);
    } catch {}
  };

  // --- Draw 2D representation (simple overlay) to emulate 3D
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d");
    if (!ctx) return;

    // draw background
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h);
    ctx.fillStyle = CANVAS_BG;
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);

    if (bgImage) {
      const img = new Image();
      img.onload = () => {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.drawImage(img, 0, 0, canvasSize.w, canvasSize.h);
        ctx.restore();
        drawPergola(ctx);
      };
      img.src = bgImage;
    } else {
      drawPergola(ctx);
    }

    function drawPergola(ctx2: CanvasRenderingContext2D) {
      const { pos, w, h, yaw, zoom } = state;
      const cx = canvasSize.w / 2 + pos.x;
      const cy = canvasSize.h / 2 + pos.y;
      const ww = w * zoom;
      const hh = h * zoom;

      ctx2.save();
      ctx2.translate(cx, cy);
      ctx2.rotate(degToRad(yaw));
      ctx2.translate(-cx, -cy);

      ctx2.strokeStyle = "rgba(255,255,255,0.9)";
      ctx2.lineWidth = 2;
      ctx2.fillStyle = "rgba(63,181,255,0.18)";
      ctx2.beginPath();
      ctx2.rect(cx - ww / 2, cy - hh / 2, ww, hh);
      ctx2.fill();
      ctx2.stroke();

      if (mode === "resize") {
        const pts: Vec2[] = [
          { x: cx - ww / 2, y: cy - hh / 2 },
          { x: cx + ww / 2, y: cy - hh / 2 },
          { x: cx + ww / 2, y: cy + hh / 2 },
          { x: cx - ww / 2, y: cy + hh / 2 },
        ];
        ctx2.fillStyle = "rgba(255,255,255,0.95)";
        for (const p of pts) {
          ctx2.beginPath();
          ctx2.arc(p.x, p.y, HANDLE_R, 0, Math.PI * 2);
          ctx2.fill();
        }
      }

      ctx2.restore();
    }
  }, [bgImage, state, canvasSize, mode]);

  const uploadPhoto = async (file: File) => {
    const url = URL.createObjectURL(file);
    setBgImage(url);
  };

  const resetAll = () => {
    setState(DEFAULT_STATE);
    setVariants([]);
  };

  const gen = async () => {
    // placeholder: simulate generation
    setLoading(true);
    try {
      await new Promise((r) => setTimeout(r, 700));
      setVariants([
        {
          id: "v1",
          label: "Variant A",
          url: bgImage ?? "",
        },
        {
          id: "v2",
          label: "Variant B",
          url: bgImage ?? "",
        },
        {
          id: "v3",
          label: "Variant C",
          url: bgImage ?? "",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const sliderBox = useMemo(() => {
    if (!activeSlider) return null;

    if (activeSlider === "w") {
      return (
        <CustomSlider
          min={100}
          max={1200}
          step={10}
          value={Math.round(state.w)}
          onChange={(v) => setState((s) => ({ ...s, w: v }))}
          label="Šírka (X)"
          suffix=" px"
        />
      );
    }
    if (activeSlider === "h") {
      return (
        <CustomSlider
          min={100}
          max={1200}
          step={10}
          value={Math.round(state.h)}
          onChange={(v) => setState((s) => ({ ...s, h: v }))}
          label="Výška (Y)"
          suffix=" px"
        />
      );
    }
    if (activeSlider === "d") {
      return (
        <CustomSlider
          min={100}
          max={1200}
          step={10}
          value={Math.round(state.d)}
          onChange={(v) => setState((s) => ({ ...s, d: v }))}
          label="Hĺbka (Z)"
          suffix=" px"
        />
      );
    }
    return (
      <CustomSlider
        min={0.2}
        max={3}
        step={0.05}
        value={Math.round(state.zoom * 100) / 100}
        onChange={(v) => setState((s) => ({ ...s, zoom: v }))}
        label="Zoom"
        suffix="×"
      />
    );
  }, [activeSlider, state]);

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
            }}
          >
            <Icon name="upload" />
            <span style={{ fontSize: 14 }}>Upload fotky</span>
            <input
              type="file"
              accept="image/*"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadPhoto(f);
              }}
            />
          </label>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ opacity: 0.75, fontSize: 13, marginLeft: 4 }}>
              Typ pergoly:
            </span>
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
          <GhostBtn onClick={resetAll} icon={<Icon name="reset" />}>
            Reset
          </GhostBtn>
          <PrimaryBtn onClick={gen} disabled={loading} icon={<Icon name="sparkles" />}>
            {loading ? "Generujem…" : "Generate"}
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
          <SegBtn
            active={mode === "rotate3d"}
            onClick={() => setMode("rotate3d")}
            title="Otoč 3D"
          >
            <Icon name="rotate" />
            Otoč 3D
          </SegBtn>
          <SegBtn active={mode === "resize"} onClick={() => setMode("resize")} title="Resize">
            <Icon name="resize" />
            Resize
          </SegBtn>

          <div style={{ width: 1, height: 28, background: "rgba(255,255,255,0.12)" }} />

          <ChipBtn active={activeSlider === "w"} onClick={() => setActiveSlider("w")}>
            Šírka
          </ChipBtn>
          <ChipBtn active={activeSlider === "h"} onClick={() => setActiveSlider("h")}>
            Výška
          </ChipBtn>
          <ChipBtn active={activeSlider === "d"} onClick={() => setActiveSlider("d")}>
            Hĺbka
          </ChipBtn>
          <ChipBtn active={activeSlider === "zoom"} onClick={() => setActiveSlider("zoom")}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Icon name="zoom" size={16} />
              Zoom
            </span>
          </ChipBtn>
        </div>

        <div style={{ opacity: 0.7, fontSize: 13 }}>
          1 prst = edit (na canvase)
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
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={onCanvasPointerUp}
            style={{
              width: "100%",
              height: "auto",
              display: "block",
              touchAction: "none",
              background: CANVAS_BG,
            }}
          />
        </div>

        {/* Right panel */}
        <div style={{ display: "grid", gap: 14 }}>
          {sliderBox}

          <div
            style={{
              padding: "12px 12px",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.10)",
              background: "rgba(255,255,255,0.03)",
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>
              Varianty
            </div>

            {variants.length === 0 ? (
              <div style={{ opacity: 0.72, fontSize: 13 }}>
                Zatiaľ nie sú vygenerované varianty.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {variants.map((v) => (
                  <div
                    key={v.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "96px 1fr",
                      gap: 10,
                      alignItems: "center",
                      padding: 10,
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,0.10)",
                      background: "rgba(255,255,255,0.04)",
                    }}
                  >
                    <div
                      style={{
                        width: 96,
                        height: 72,
                        borderRadius: 12,
                        overflow: "hidden",
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.10)",
                      }}
                    >
                      {v.url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={v.url}
                          alt={v.label}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : null}
                    </div>

                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700 }}>{v.label}</div>
                        <div style={{ opacity: 0.72, fontSize: 12 }}>
                          {FINAL_PROMPT_DEFAULT.slice(0, 72)}…
                        </div>
                      </div>

                      <GhostBtn
                        onClick={() => {
                          // fake download
                          alert(`Download: ${v.label}`);
                        }}
                        icon={<Icon name="download" />}
                      >
                        Stiahnuť
                      </GhostBtn>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {variants.length > 0 ? (
            <GhostBtn
              onClick={() => alert("Stiahnuť všetky (placeholder)")}
              icon={<Icon name="download" />}
            >
              Stiahnuť všetky
            </GhostBtn>
          ) : null}
        </div>
      </div>
    </div>
  );
}
