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
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
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

type VariantItem = {
  id: string;
  type: PergolaType;
  b64: string; // PNG
  createdAt: number;
};

function makeId() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

async function b64PngToBlob(b64: string): Promise<Blob> {
  const r = await fetch(`data:image/png;base64,${b64}`);
  return await r.blob();
}

type SliderPanel = "zoom" | "x" | "y" | "z";

export default function Page() {
  const [bgFile, setBgFile] = useState<File | null>(null);
  const bgUrl = useMemo(() => (bgFile ? URL.createObjectURL(bgFile) : ""), [bgFile]);
  const [bgImg, setBgImg] = useState<HTMLImageElement | null>(null);

  const [pergolaType, setPergolaType] = useState<PergolaType>("bioklim");
  const glbPath = useMemo(() => {
    if (pergolaType === "bioklim") return "/models/bioklim.glb";
    if (pergolaType === "pevna") return "/models/pevna.glb";
    return "/models/zimna.glb";
  }, [pergolaType]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasW] = useState(980);
  const [canvasH] = useState(560);

  const [editorZoom, setEditorZoom] = useState(110);

  const [mode, setMode] = useState<Mode>("move");
  const [pos, setPos] = useState<Vec2>({ x: 0.5, y: 0.72 });
  const [rot2D, setRot2D] = useState(0);
  const [rot3D, setRot3D] = useState({ yaw: 0.35, pitch: -0.12 });

  // menšie defaulty -> na mobile viditeľnejšie
  const [scalePct, setScalePct] = useState({ x: 88, y: 88, z: 88 });

  const [bboxRect, setBboxRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [activeHandle, setActiveHandle] = useState<HandleId | null>(null);

  // three.js refs
  const threeReadyRef = useRef(false);
  const rendererRef = useRef<any>(null);
  const sceneRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const rootRef = useRef<any>(null);
  const baseScaleRef = useRef<number>(1);

  const [prompt] = useState(FINAL_PROMPT_DEFAULT);

  // variants (max 6)
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // lead gating
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);

  // čo chce user spraviť po odomknutí
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

  // UI selection for bottom slider panel
  const [panel, setPanel] = useState<SliderPanel>("zoom");

  // mobile
  const isMobileRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 960px)");
    const apply = () => {
      isMobileRef.current = mq.matches;
      if (mq.matches) {
        setScalePct((s) => ({ x: Math.min(s.x, 82), y: Math.min(s.y, 82), z: Math.min(s.z, 82) }));
        setEditorZoom((z) => Math.min(Math.max(z, 105), 125));
      }
    };
    apply();
    mq.addEventListener?.("change", apply);
    return () => mq.removeEventListener?.("change", apply);
  }, []);

  // canvas drag ref
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

  const selectedVariant = variants[selectedVariantIndex] || null;
  const remaining = Math.max(0, MAX_VARIANTS - variants.length);

  function toCanvasXY(e: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * canvasW) / rect.width;
    const y = ((e.clientY - rect.top) * canvasH) / rect.height;
    return { x, y };
  }

  function computeProjectedRect() {
    return bboxRect;
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

  function setScaleAxis(axis: "x" | "y" | "z", value: number) {
    setScalePct((prev) => ({ ...prev, [axis]: clampPct(value) }));
  }

  function resetAll() {
    setScalePct({ x: isMobileRef.current ? 82 : 100, y: isMobileRef.current ? 82 : 100, z: isMobileRef.current ? 82 : 100 });
    setRot3D({ yaw: 0.35, pitch: -0.12 });
    setRot2D(0);
    setPos({ x: 0.5, y: 0.72 });
    setError("");
    setPanel("zoom");
    setMode("move");
  }

  // background image load
  useEffect(() => {
    if (!bgUrl) {
      setBgImg(null);
      return;
    }
    const img = new Image();
    img.onload = () => setBgImg(img);
    img.src = bgUrl;
  }, [bgUrl]);

  // init / reload three when model changes
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
      } catch (e: any) {
        console.error(e);
        setError(String(e?.message || e));
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
  }, [bgImg, canvasW, canvasH, editorZoom, pos, rot2D, rot3D, scalePct]);

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

    ctx.clearRect(0, 0, canvasW, canvasH);

    if (bgImg) {
      // COVER: vyplň celé okno (bez bielych pruhov)
      const rw = canvasW / bgImg.width;
      const rh = canvasH / bgImg.height;
      const r = Math.max(rw, rh);
      const dw = bgImg.width * r;
      const dh = bgImg.height * r;
      const dx = (canvasW - dw) / 2;
      const dy = (canvasH - dh) / 2;
      ctx.drawImage(bgImg, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText("Nahraj fotku (JPG/PNG)", 18, 28);
    }

    if (threeReadyRef.current && rendererRef.current && sceneRef.current && cameraRef.current && rootRef.current) {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;

      applyTransformsForCurrentState(canvasW, canvasH);

      renderer.setSize(canvasW, canvasH, false);
      renderer.render(scene, cameraRef.current);

      const glCanvas = renderer.domElement;
      ctx.drawImage(glCanvas, 0, 0);

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

          const corners: Record<HandleId, Vec2> = {
            nw: { x: rect.x, y: rect.y },
            ne: { x: rect.x + rect.w, y: rect.y },
            se: { x: rect.x + rect.w, y: rect.y + rect.h },
            sw: { x: rect.x, y: rect.y + rect.h },
          };
          for (const id of Object.keys(corners) as HandleId[]) {
            const c = corners[id];
            ctx.beginPath();
            ctx.fillStyle = "rgba(255,255,255,0.92)";
            ctx.arc(c.x, c.y, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.fillStyle = "rgba(0,0,0,0.72)";
            ctx.arc(c.x, c.y, HANDLE_R, 0, Math.PI * 2);
            ctx.fill();
          }

          ctx.restore();
        } else {
          setBboxRect(null);
        }
      } catch {}
    }
  }

  async function generate() {
    if (!bgImg) return;
    if (variants.length >= MAX_VARIANTS) return;

    setLoading(true);
    setError("");

    try {
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

      // rovnaký cover výpočet aj pri exporte
      const rw = outW / bgImg.width;
      const rh = outH / bgImg.height;
      const r = Math.max(rw, rh);
      const dw = bgImg.width * r;
      const dh = bgImg.height * r;
      const dx = (outW - dw) / 2;
      const dy = (outH - dh) / 2;
      octx.drawImage(bgImg, dx, dy, dw, dh);

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

      const r2 = await fetch("/api/render/openai", { method: "POST", body: form });

      const j = await r2.json().catch(async () => {
        const t = await r2.text().catch(() => "");
        return { error: t || `HTTP ${r2.status}` };
      });

      if (!r2.ok) throw new Error(j?.error || `HTTP ${r2.status}`);
      if (!j?.b64) throw new Error("API nevrátilo b64.");

      setVariants((prev) => {
        if (prev.length >= MAX_VARIANTS) return prev;
        const next = [...prev, { id: makeId(), type: pergolaType, b64: j.b64, createdAt: Date.now() }];
        return next;
      });

      setSelectedVariantIndex(() => clamp(variants.length, 0, MAX_VARIANTS - 1));
    } catch (e: any) {
      console.error(e);
      setError(String(e?.message || e));
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

      const r = await fetch("/api/lead/submit", { method: "POST", body: fd });

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

  // ✅ 1 prst = vždy edit (canvas)
  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    const p = toCanvasXY(e);

    e.preventDefault();
    (e.currentTarget as any).setPointerCapture(e.pointerId);

    const rect = computeProjectedRect();
    if (rect) {
      const h = hitHandle(p, rect);
      if (h) {
        setMode("resize");
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

      const wRatio = newW / rect.w;
      const hRatio = newH / rect.h;

      const nextX = clampPct(dragRef.current.startScalePct.x * wRatio);
      const nextY = clampPct(dragRef.current.startScalePct.y * hRatio);

      setScalePct((s) => ({ ...s, x: nextX, y: nextY }));
      return;
    }
  }

  function onPointerUp() {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setActiveHandle(null);

    if (mode === "resize") setMode("move");
  }

  function Stepper() {
    const hasAnyVariant = variants.length > 0;
    const current = !bgImg ? 1 : !hasAnyVariant ? 2 : !leadSubmitted ? 4 : 5;

    const steps = [
      { n: 1, text: "Nahraj fotku" },
      { n: 2, text: "Umiestni pergolu" },
      { n: 3, text: "Vygeneruj vizualizácie" },
      { n: 4, text: "Vyplň údaje + poznámku + vyber vizualizáciu" },
      { n: 5, text: "Stiahni PNG" },
    ];

    return (
      <div className="ter-stepper stepperWrap" aria-label="Postup">
        <div className="stepperBar">
          <div className="stepperTrack" aria-hidden="true" />
          {steps.map((s) => {
            const on = current >= s.n;
            const active = current === s.n;
            return (
              <div className="stepItem" key={s.n}>
                <div className={`stepCircle ${on ? "on" : ""} ${active ? "active" : ""}`}>{s.n}</div>
                <div className={`stepText ${active ? "active" : ""}`}>{s.text}</div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const canGenerate = !!bgImg && !loading && variants.length < MAX_VARIANTS;

  // ✅ slider render: rovnaké ako zoom (jednoduché input + hodnota)
  function SliderBlock({
    title,
    valueLabel,
    min,
    max,
    step,
    value,
    onChange,
  }: {
    title: string;
    valueLabel: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
  }) {
    return (
      <>
        <div className="sliderTitle">{title}</div>
        <div className="sliderRow">
          <input
            className="rangeBig"
            type="range"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
          />
          <div className="sliderVal">{valueLabel}</div>
        </div>
      </>
    );
  }

  return (
    <section className="ter-wrap">
      {/* Stepper global */}
      <style jsx global>{`
        .ter-wrap .ter-stepper.stepperWrap {
          overflow-x: auto;
          padding: 14px 0 6px;
        }
        .ter-wrap .ter-stepper .stepperBar {
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 18px;
          padding: 6px 2px;
          min-width: 980px;
        }
        .ter-wrap .ter-stepper .stepperTrack {
          position: absolute;
          left: 26px;
          right: 26px;
          top: 29px;
          height: 2px;
          background: rgba(0, 0, 0, 0.12);
          z-index: 0;
        }
        .ter-wrap .ter-stepper .stepItem {
          position: relative;
          z-index: 1;
          display: grid;
          justify-items: center;
          gap: 10px;
          flex: 1 1 0;
          min-width: 170px;
        }
        .ter-wrap .ter-stepper .stepCircle {
          width: 46px;
          height: 46px;
          border-radius: 999px;
          display: grid;
          place-items: center;
          font-weight: 900;
          font-size: 16px;
          background: #e9e9e9;
          color: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(0, 0, 0, 0.06);
        }
        .ter-wrap .ter-stepper .stepCircle.on {
          background: #111;
          color: #fff;
          border-color: #111;
        }
        .ter-wrap .ter-stepper .stepCircle.active {
          box-shadow: 0 12px 26px rgba(0, 0, 0, 0.18);
        }
        .ter-wrap .ter-stepper .stepText {
          font-size: 14px;
          color: rgba(0, 0, 0, 0.55);
          font-weight: 650;
          text-align: center;
          line-height: 1.2;
          max-width: 260px;
          margin: 0;
        }
        .ter-wrap .ter-stepper .stepText.active {
          color: rgba(0, 0, 0, 0.9);
          font-weight: 800;
        }
        @media (max-width: 960px) {
          .ter-wrap .ter-stepper .stepperBar {
            min-width: 920px;
          }
        }
      `}</style>

      {/* ✅ Range styling: musí podporovať drag (mobile) + viditeľné (desktop) */}
      <style jsx global>{`
        .ter-wrap :global(input.rangeBig) {
          width: 100%;
          height: 42px;
          -webkit-appearance: none;
          appearance: none;
          background: transparent;
          touch-action: pan-x;
        }
        .ter-wrap :global(input.rangeBig::-webkit-slider-runnable-track) {
          height: 12px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.18);
        }
        .ter-wrap :global(input.rangeBig::-webkit-slider-thumb) {
          -webkit-appearance: none;
          appearance: none;
          width: 26px;
          height: 26px;
          margin-top: -7px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.95);
          border: 2px solid rgba(255, 255, 255, 0.95);
          box-shadow: 0 6px 14px rgba(0, 0, 0, 0.18);
        }
        .ter-wrap :global(input.rangeBig::-moz-range-track) {
          height: 12px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.18);
        }
        .ter-wrap :global(input.rangeBig::-moz-range-thumb) {
          width: 26px;
          height: 26px;
          border-radius: 999px;
          background: rgba(0, 0, 0, 0.95);
          border: 2px solid rgba(255, 255, 255, 0.95);
          box-shadow: 0 6px 14px rgba(0, 0, 0, 0.18);
        }
      `}</style>

      <style jsx>{`
        .ter-wrap {
          background: #f6f6f6;
          color: #111;
          padding: 28px 12px 40px;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
        }
        .container {
          max-width: 1100px;
          margin: 0 auto;
        }

        .hero {
          display: grid;
          gap: 10px;
          margin-bottom: 10px;
        }
        h2 {
          margin: 0;
          font-size: 32px;
          line-height: 1.15;
          letter-spacing: -0.02em;
        }
        .sub {
          margin: 0;
          color: rgba(0, 0, 0, 0.7);
          font-size: 16px;
          max-width: 110ch;
        }

        .topBars {
          display: grid;
          gap: 10px;
          margin-bottom: 12px;
        }

        .bar {
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 16px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
          padding: 10px;
        }

        .barRow {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .fieldInline {
          display: flex;
          gap: 8px;
          align-items: center;
          flex: 1 1 auto;
          min-width: 260px;
        }

        .label {
          font-size: 12px;
          font-weight: 900;
          color: rgba(0, 0, 0, 0.65);
          text-transform: uppercase;
          letter-spacing: 0.06em;
          white-space: nowrap;
        }
        .input,
        .select {
          width: 100%;
          padding: 10px 12px;
          border-radius: 12px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: #fff;
          outline: none;
          font-weight: 700;
          color: #111;
        }

        .tabs {
          display: inline-flex;
          border: 1px solid rgba(0, 0, 0, 0.1);
          background: rgba(0, 0, 0, 0.03);
          border-radius: 999px;
          padding: 4px;
          gap: 4px;
          flex-wrap: wrap;
        }

        .tab {
          border: none;
          background: transparent;
          border-radius: 999px;
          padding: 9px 12px;
          font-weight: 900;
          font-size: 13px;
          cursor: pointer;
          color: rgba(0, 0, 0, 0.7);
          white-space: nowrap;
        }
        .tab.active {
          background: #fff;
          color: #111;
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
        }

        .actionsRight {
          margin-left: auto;
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
        }

        .btn {
          border-radius: 12px;
          padding: 10px 12px;
          font-weight: 950;
          cursor: pointer;
          border: 1px solid rgba(0, 0, 0, 0.14);
          background: #fff;
          color: #111;
        }
        .btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .btnPrimary {
          background: #111;
          color: #fff;
          border-color: #111;
        }

        .sliderPanel {
          margin-top: 10px;
          display: grid;
          gap: 6px;
        }
        .sliderTitle {
          font-size: 12px;
          font-weight: 950;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: rgba(0, 0, 0, 0.6);
        }
        .sliderRow {
          display: flex;
          gap: 10px;
          align-items: center;
        }
        .sliderVal {
          width: 84px;
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-weight: 950;
          color: rgba(0, 0, 0, 0.7);
          flex: 0 0 auto;
        }

        .canvasCard {
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
          overflow: hidden;
        }
        .canvasBody {
          padding: 12px;
        }

        .canvasShell {
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 14px;
          overflow: hidden;
          padding: 10px;
          background: #fff;
        }
        canvas {
          border-radius: 12px;
          display: block;
          background: #fff;
        }

        .variantsWrap {
          display: grid;
          gap: 10px;
          margin-top: 12px;
        }
        .variantsHead {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 12px;
          flex-wrap: wrap;
        }
        .variantsTitle {
          font-size: 12px;
          font-weight: 950;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(0, 0, 0, 0.55);
        }
        .variantsNote {
          font-size: 12px;
          color: rgba(0, 0, 0, 0.6);
          font-weight: 700;
        }
        .variantsGrid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 10px;
        }
        .variantCard {
          border: 1px solid rgba(0, 0, 0, 0.1);
          background: rgba(0, 0, 0, 0.015);
          border-radius: 14px;
          overflow: hidden;
          text-align: left;
          padding: 0;
          cursor: pointer;
          display: grid;
          grid-template-rows: auto 1fr;
          min-height: 120px;
        }
        .variantCard:disabled {
          cursor: default;
          opacity: 0.75;
        }
        .variantCard.selected {
          outline: 3px solid rgba(0, 0, 0, 0.85);
          outline-offset: 0;
          border-color: rgba(0, 0, 0, 0.85);
          background: #fff;
        }
        .variantTop {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          gap: 10px;
          padding: 10px 10px 8px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          background: rgba(0, 0, 0, 0.02);
        }
        .variantBadge {
          font-weight: 950;
          font-size: 12px;
          color: rgba(0, 0, 0, 0.75);
        }
        .variantType {
          font-weight: 900;
          font-size: 12px;
          color: rgba(0, 0, 0, 0.6);
        }
        .variantSelected {
          font-weight: 950;
          font-size: 12px;
          color: rgba(0, 0, 0, 0.9);
        }
        .variantCard img {
          width: 100%;
          height: 140px;
          object-fit: cover;
          display: block;
        }
        .variantEmpty {
          padding: 14px 10px;
          font-size: 12px;
          font-weight: 800;
          color: rgba(0, 0, 0, 0.45);
        }

        .variantActions {
          display: flex;
          gap: 8px;
          padding: 10px;
          border-top: 1px solid rgba(0, 0, 0, 0.06);
          background: rgba(0, 0, 0, 0.015);
        }

        .smallBtn {
          border-radius: 10px;
          padding: 9px 10px;
          font-weight: 900;
          cursor: pointer;
          border: 1px solid rgba(0, 0, 0, 0.14);
          background: #fff;
          color: #111;
          font-size: 12px;
        }
        .smallBtn.primary {
          background: #111;
          border-color: #111;
          color: #fff;
        }

        .errorBox {
          margin-top: 10px;
          padding: 12px;
          border-radius: 14px;
          border: 1px solid rgba(160, 0, 0, 0.25);
          background: rgba(210, 0, 0, 0.06);
          color: rgba(120, 0, 0, 0.95);
          font-weight: 800;
        }

        @media (max-width: 960px) {
          h2 {
            font-size: 26px;
          }
          .variantsGrid {
            grid-template-columns: 1fr;
          }
          .variantCard img {
            height: 180px;
          }
        }
      `}</style>

      <div className="container">
        {/* HERO + STEPPER (vrátené) */}
        <div className="hero">
          <h2>Vizualizácia pergoly na vašom dome</h2>
          <p className="sub">
            Nahrajte fotku, umiestnite pergolu a vytvorte si až <b>6 variantov</b>.
            <br />
            Sťahovanie PNG je dostupné až po vyplnení formulára a výbere jednej vizualizácie, ktorú nám odošlete.
          </p>
          <Stepper />
        </div>

        {/* TOP BARS */}
        <div className="topBars">
          {/* BAR 1: upload + type */}
          <div className="bar">
            <div className="barRow">
              <div className="fieldInline" style={{ minWidth: 260 }}>
                <div className="label">Nahraj fotku</div>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setBgFile(f);
                    setError("");
                  }}
                />
              </div>

              <div className="fieldInline">
                <div className="label">Typ pergoly</div>
                <select className="select" value={pergolaType} onChange={(e) => setPergolaType(e.target.value as PergolaType)}>
                  <option value="bioklim">Bioklimatická</option>
                  <option value="pevna">Pevná strecha</option>
                  <option value="zimna">Zimná záhrada</option>
                </select>
              </div>
            </div>
          </div>

          {/* BAR 2: mode + panels + actions */}
          <div className="bar">
            <div className="barRow">
              <div className="tabs" role="tablist" aria-label="Režimy a ovládanie">
                <button type="button" className={`tab ${mode === "move" ? "active" : ""}`} onClick={() => setMode("move")}>
                  Posun
                </button>

                <button type="button" className={`tab ${mode === "rotate3d" ? "active" : ""}`} onClick={() => setMode("rotate3d")}>
                  Otoč 3D
                </button>

                {/* zoom musí byť vždy dostupný */}
                <button type="button" className={`tab ${panel === "zoom" ? "active" : ""}`} onClick={() => setPanel("zoom")}>
                  Zoom
                </button>

                <button type="button" className={`tab ${panel === "x" ? "active" : ""}`} onClick={() => setPanel("x")}>
                  Šírka
                </button>
                <button type="button" className={`tab ${panel === "y" ? "active" : ""}`} onClick={() => setPanel("y")}>
                  Výška
                </button>
                <button type="button" className={`tab ${panel === "z" ? "active" : ""}`} onClick={() => setPanel("z")}>
                  Hĺbka
                </button>
              </div>

              <div className="actionsRight">
                <button type="button" className="btn" onClick={resetAll} disabled={loading}>
                  Reset
                </button>

                <button type="button" className={`btn btnPrimary`} onClick={generate} disabled={!canGenerate}>
                  {loading ? "Generujem..." : variants.length >= MAX_VARIANTS ? `Limit ${MAX_VARIANTS}` : `Vygenerovať (${variants.length + 1}/${MAX_VARIANTS})`}
                </button>
              </div>
            </div>

            {/* SLIDER PANEL — X/Y/Z rovnako ako ZOOM */}
            <div className="sliderPanel">
              {panel === "zoom" ? (
                <SliderBlock title="Zoom" value={editorZoom} valueLabel={`${editorZoom}%`} min={50} max={160} step={5} onChange={setEditorZoom} />
              ) : panel === "x" ? (
                <SliderBlock
                  title="Šírka (X)"
                  value={scalePct.x}
                  valueLabel={`${scalePct.x.toFixed(1)}%`}
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step={SCALE_STEP}
                  onChange={(v) => setScaleAxis("x", v)}
                />
              ) : panel === "y" ? (
                <SliderBlock
                  title="Výška (Y)"
                  value={scalePct.y}
                  valueLabel={`${scalePct.y.toFixed(1)}%`}
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step={SCALE_STEP}
                  onChange={(v) => setScaleAxis("y", v)}
                />
              ) : (
                <SliderBlock
                  title="Hĺbka (Z)"
                  value={scalePct.z}
                  valueLabel={`${scalePct.z.toFixed(1)}%`}
                  min={SCALE_MIN}
                  max={SCALE_MAX}
                  step={SCALE_STEP}
                  onChange={(v) => setScaleAxis("z", v)}
                />
              )}
            </div>

            {error ? <div className="errorBox">Chyba: {error}</div> : null}
          </div>
        </div>

        {/* CANVAS */}
        <div className="canvasCard">
          <div className="canvasBody">
            <div className="canvasShell">
              <div style={{ width: Math.round((canvasW * editorZoom) / 100), height: Math.round((canvasH * editorZoom) / 100) }}>
                <canvas
                  ref={canvasRef}
                  width={canvasW}
                  height={canvasH}
                  style={{
                    width: `${(canvasW * editorZoom) / 100}px`,
                    height: `${(canvasH * editorZoom) / 100}px`,
                    touchAction: "none",
                  }}
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={onPointerUp}
                  onPointerCancel={onPointerUp}
                />
              </div>
            </div>

            {/* VARIANTS */}
            <div className="variantsWrap">
              <div className="variantsHead">
                <div className="variantsTitle">Varianty (max {MAX_VARIANTS})</div>
                <div className="variantsNote">
                  Zostáva: <b>{remaining}</b>/{MAX_VARIANTS} • sťahovanie: {leadSubmitted ? "✅ odomknuté" : "🔒 po formulári"}
                </div>
              </div>

              <div className="variantsGrid" role="list" aria-label="Varianty vizualizácie">
                {Array.from({ length: MAX_VARIANTS }).map((_, i) => {
                  const v = variants[i] || null;
                  const selected = selectedVariantIndex === i;

                  return (
                    <div key={i} style={{ display: "grid", gap: 0 }}>
                      <button
                        type="button"
                        className={`variantCard ${selected ? "selected" : ""} ${v ? "has" : ""}`}
                        onClick={() => {
                          if (!v) return;
                          setSelectedVariantIndex(i);
                        }}
                        disabled={!v}
                        aria-label={v ? `Vybrať variant ${i + 1}` : `Variant ${i + 1} (prázdny)`}
                      >
                        <div className="variantTop">
                          <div>
                            <div className="variantBadge">Variant {i + 1}</div>
                            {v ? <div className="variantType">{typeLabel(v.type)}</div> : null}
                          </div>
                          {selected ? <div className="variantSelected">Vybrané</div> : null}
                        </div>

                        {v ? <img src={`data:image/png;base64,${v.b64}`} alt={`Variant ${i + 1}`} /> : <div className="variantEmpty">Zatiaľ nevygenerované</div>}
                      </button>

                      {v ? (
                        <div className="variantActions">
                          <button type="button" className="smallBtn" onClick={() => onDownloadOne(i)}>
                            Stiahnuť
                          </button>
                          <button
                            type="button"
                            className={`smallBtn ${selected ? "primary" : ""}`}
                            onClick={() => {
                              setSelectedVariantIndex(i);
                              if (!leadSubmitted) {
                                setPendingAction({ kind: "single", index: i });
                                setLeadOpen(true);
                              }
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

              {/* Stiahnuť všetky iba dole */}
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 6 }}>
                <button type="button" className="btn" onClick={onDownloadAllClick} disabled={variants.length === 0}>
                  Stiahnuť všetky ({variants.length})
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Lead modal */}
        {leadOpen ? (
          <div
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.55)",
              display: "grid",
              placeItems: "center",
              padding: 16,
              zIndex: 9999,
            }}
            role="dialog"
            aria-modal="true"
            onMouseDown={(ev) => {
              if (ev.target === ev.currentTarget) closeLeadForm();
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
                  <p style={{ fontWeight: 1000, letterSpacing: "-0.01em", margin: 0, fontSize: 16 }}>Vyplň kontaktné údaje, poznámku a vyber vizualizáciu</p>
                  <p style={{ margin: "6px 0 0", color: "rgba(0,0,0,0.65)", fontWeight: 650, fontSize: 13 }}>
                    Pre odomknutie sťahovania je potrebné vyplniť formulár a vybrať <b>1 vizualizáciu</b>, ktorú nám odošleš.
                  </p>
                </div>
                <button type="button" className="btn" onClick={closeLeadForm}>
                  ✕
                </button>
              </div>

              <div style={{ padding: "14px 16px 16px" }}>
                <form onSubmit={submitLead} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(0,0,0,0.55)", margin: "2px 0 10px" }}>
                      Vyber vizualizáciu, ktorú odošleš *
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
                      {variants.map((v, i) => {
                        const sel = selectedVariantIndex === i;
                        return (
                          <div
                            key={v.id}
                            onClick={() => setSelectedVariantIndex(i)}
                            role="button"
                            tabIndex={0}
                            style={{
                              border: "1px solid rgba(0,0,0,0.1)",
                              borderRadius: 14,
                              overflow: "hidden",
                              cursor: "pointer",
                              background: "rgba(0,0,0,0.01)",
                              outline: sel ? "3px solid rgba(0,0,0,0.85)" : "none",
                            }}
                          >
                            <div style={{ padding: "10px 10px 8px", borderBottom: "1px solid rgba(0,0,0,0.06)", background: "rgba(0,0,0,0.02)", display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div>
                                <b style={{ fontSize: 12 }}>Variant {i + 1}</b>
                                <div style={{ fontSize: 12, fontWeight: 800, color: "rgba(0,0,0,0.6)", marginTop: 2 }}>{typeLabel(v.type)}</div>
                              </div>
                              <div style={{ fontSize: 12, fontWeight: 950, color: sel ? "rgba(0,0,0,0.9)" : "rgba(0,0,0,0.55)" }}>{sel ? "Vybrané" : ""}</div>
                            </div>
                            <img src={`data:image/png;base64,${v.b64}`} alt={`Variant ${i + 1}`} style={{ width: "100%", height: 130, objectFit: "cover", display: "block" }} />
                          </div>
                        );
                      })}
                    </div>

                    {leadErr.selectedVariant ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800, marginTop: 8 }}>{leadErr.selectedVariant}</div> : null}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="label">Meno *</div>
                    <input className="input" value={lead.name} onChange={(e) => setLead((p) => ({ ...p, name: e.target.value }))} placeholder="Meno a priezvisko" />
                    {leadErr.name ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800 }}>{leadErr.name}</div> : null}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="label">Mesto *</div>
                    <input className="input" value={lead.city} onChange={(e) => setLead((p) => ({ ...p, city: e.target.value }))} placeholder="Mesto" />
                    {leadErr.city ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800 }}>{leadErr.city}</div> : null}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="label">Telefón *</div>
                    <input className="input" value={lead.phone} onChange={(e) => setLead((p) => ({ ...p, phone: e.target.value }))} placeholder="+421 9xx xxx xxx" inputMode="tel" />
                    {leadErr.phone ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800 }}>{leadErr.phone}</div> : null}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <div className="label">Email *</div>
                    <input className="input" value={lead.email} onChange={(e) => setLead((p) => ({ ...p, email: e.target.value }))} placeholder="meno@domena.sk" inputMode="email" />
                    {leadErr.email ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800 }}>{leadErr.email}</div> : null}
                  </div>

                  <div style={{ gridColumn: "1 / -1", marginTop: 4 }}>
                    <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(0,0,0,0.55)", margin: "2px 0 10px" }}>
                      Približné rozmery pergoly *
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
                      <div style={{ display: "grid", gap: 6 }}>
                        <div className="label">Šírka</div>
                        <input className="input" value={lead.approxWidth} onChange={(e) => setLead((p) => ({ ...p, approxWidth: e.target.value }))} placeholder="napr. 4.0 m" />
                        {leadErr.approxWidth ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800 }}>{leadErr.approxWidth}</div> : null}
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div className="label">Hĺbka</div>
                        <input className="input" value={lead.approxDepth} onChange={(e) => setLead((p) => ({ ...p, approxDepth: e.target.value }))} placeholder="napr. 3.5 m" />
                        {leadErr.approxDepth ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800 }}>{leadErr.approxDepth}</div> : null}
                      </div>

                      <div style={{ display: "grid", gap: 6 }}>
                        <div className="label">Výška</div>
                        <input className="input" value={lead.approxHeight} onChange={(e) => setLead((p) => ({ ...p, approxHeight: e.target.value }))} placeholder="napr. 2.5 m" />
                        {leadErr.approxHeight ? <div style={{ color: "rgba(160,0,0,0.9)", fontSize: 12, fontWeight: 800 }}>{leadErr.approxHeight}</div> : null}
                      </div>
                    </div>
                  </div>

                  <div style={{ gridColumn: "1 / -1" }}>
                    <div style={{ fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.08em", color: "rgba(0,0,0,0.55)", margin: "2px 0 10px" }}>
                      Poznámka zákazníka (voliteľné)
                    </div>
                    <textarea
                      value={lead.customerNote}
                      onChange={(e) => setLead((p) => ({ ...p, customerNote: e.target.value }))}
                      placeholder="Sem môžete dopísať doplňujúce informácie (napr. špecifiká terasy, požiadavky, termín, farba...)."
                      style={{
                        width: "100%",
                        padding: "11px 12px",
                        borderRadius: 12,
                        border: "1px solid rgba(0,0,0,0.12)",
                        background: "#fff",
                        outline: "none",
                        fontWeight: 700,
                        color: "#111",
                        minHeight: 96,
                        resize: "vertical",
                        lineHeight: 1.35,
                      }}
                    />
                  </div>

                  <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                    <button type="button" className="btn" onClick={closeLeadForm} disabled={leadSubmitting}>
                      Zrušiť
                    </button>

                    <button type="submit" className="btn btnPrimary" disabled={leadSubmitting}>
                      {leadSubmitting ? "Odosielam..." : "Odoslať a odomknúť sťahovanie"}
                    </button>
                  </div>

                  <div style={{ gridColumn: "1 / -1", color: "rgba(0,0,0,0.65)", fontWeight: 650, fontSize: 13, marginTop: 6 }}>
                    Odoslaním formulára súhlasíte so spracovaním osobných údajov.
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
