"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

type PergolaType = "bioklim" | "pevna" | "zimna";
type Mode = "move" | "rotate3d" | "setGround" | "resize";
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
function lineYAtX(a: Vec2, b: Vec2, x: number) {
  if (Math.abs(b.x - a.x) < 1e-6) return (a.y + b.y) / 2;
  const t = (x - a.x) / (b.x - a.x);
  return lerp(a.y, b.y, t);
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

type VariantItem = { type: PergolaType; b64: string };

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
  const [editorZoom, setEditorZoom] = useState(100);

  const [mode, setMode] = useState<Mode>("move");
  const [pos, setPos] = useState<Vec2>({ x: 0.5, y: 0.72 });
  const [rot2D, setRot2D] = useState(0);
  const [rot3D, setRot3D] = useState({ yaw: 0.35, pitch: -0.12 });
  const [scalePct, setScalePct] = useState({ x: 100, y: 100, z: 100 });

  const [groundA, setGroundA] = useState<Vec2 | null>(null);
  const [groundB, setGroundB] = useState<Vec2 | null>(null);

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

  // variants (max 3)
  const [variants, setVariants] = useState<VariantItem[]>([]);
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // lead gating
  const [leadOpen, setLeadOpen] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [pendingDownload, setPendingDownload] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);

  const [lead, setLead] = useState({
    name: "",
    city: "",
    phone: "",
    email: "",
    approxWidth: "",
    approxDepth: "",
    approxHeight: "",
  });

  const [leadErr, setLeadErr] = useState<{
    name?: string;
    city?: string;
    phone?: string;
    email?: string;
    approxWidth?: string;
    approxDepth?: string;
    approxHeight?: string;
  }>({});

  // mobile sheet
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetY, setSheetY] = useState(0);
  const sheetDragRef = useRef<{
    dragging: boolean;
    startY: number;
    startSheetY: number;
    maxDown: number;
  }>({ dragging: false, startY: 0, startSheetY: 0, maxDown: 0 });

  const isMobileRef = useRef(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 960px)");
    const apply = () => {
      isMobileRef.current = mq.matches;
      if (!mq.matches) {
        setSheetOpen(false);
        setSheetY(0);
      } else {
        setSheetOpen(false);
        setSheetY(0);
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

  const currentVariant = variants[selectedVariantIndex] || null;
  const currentB64 = currentVariant?.b64 || "";
  const remaining = Math.max(0, 3 - variants.length);

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

  function snapToGround() {
    if (!groundA || !groundB || !bboxRect) return;

    const leftX = bboxRect.x;
    const rightX = bboxRect.x + bboxRect.w;

    const yL = lineYAtX(groundA, groundB, leftX);
    const yR = lineYAtX(groundA, groundB, rightX);
    const yMid = (yL + yR) / 2;

    const bottom = bboxRect.y + bboxRect.h;
    const dyPx = yMid - bottom;
    const dyNorm = dyPx / canvasH;

    setPos((p) => ({ ...p, y: p.y + dyNorm }));
  }

  function bumpScaleAxis(axis: "x" | "y" | "z", delta: number) {
    setScalePct((prev) => {
      const next = { ...prev };
      next[axis] = clampPct(prev[axis] + delta);
      return next;
    });
  }
  function setScaleAxis(axis: "x" | "y" | "z", value: number) {
    setScalePct((prev) => ({ ...prev, [axis]: clampPct(value) }));
  }

  function resetAll() {
    setScalePct({ x: 100, y: 100, z: 100 });
    setRot3D({ yaw: 0.35, pitch: -0.12 });
    setRot2D(0);
    setPos({ x: 0.5, y: 0.72 });
    setGroundA(null);
    setGroundB(null);
    setError("");
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
  }, [bgImg, canvasW, canvasH, editorZoom, pos, rot2D, rot3D, scalePct, groundA, groundB]);

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
      const rw = canvasW / bgImg.width;
      const rh = canvasH / bgImg.height;
      const r = Math.min(rw, rh);
      const dw = bgImg.width * r;
      const dh = bgImg.height * r;
      const dx = (canvasW - dw) / 2;
      const dy = (canvasH - dh) / 2;
      ctx.drawImage(bgImg, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.fillStyle = "rgba(0,0,0,0.65)";
      ctx.font = "14px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
      ctx.fillText("Nahraj fotku (JPG/PNG)", 18, 28);
    }

    if (groundA && groundB) {
      ctx.save();
      ctx.strokeStyle = "rgba(0,140,110,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(groundA.x, groundA.y);
      ctx.lineTo(groundB.x, groundB.y);
      ctx.stroke();
      ctx.restore();
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
            ctx.fillStyle = "rgba(255,255,255,0.9)";
            ctx.arc(c.x, c.y, 11, 0, Math.PI * 2);
            ctx.fill();
            ctx.beginPath();
            ctx.fillStyle = "rgba(0,0,0,0.65)";
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
    if (leadSubmitted) return;
    if (variants.length >= 3) return;

    setLoading(true);
    setError("");

    try {
      
// --- EXPORT pre OpenAI: downscale + JPEG (aby sme nepadali na HTTP 413) ---
const MAX_DIM = 2048; // bezpečné pre Vercel request limity
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

// export ako JPEG (PNG býva obrovské a spôsobí 413)
const blob: Blob = await new Promise((res, rej) =>
  out.toBlob(
    (b) => (b ? res(b) : rej(new Error("toBlob vrátil null"))),
    "image/jpeg",
    0.9
  )
);

// voliteľné: log veľkosti exportu
// console.log("Export size (MB):", (blob.size / 1024 / 1024).toFixed(2));


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
        if (prev.length >= 3) return prev;
        return [...prev, { type: pergolaType, b64: j.b64 }];
      });

      setSelectedVariantIndex((prev) => clamp(prev, 0, 2));
      // auto-select newest slot
      setSelectedVariantIndex(() => clamp(variants.length, 0, 2));
    } catch (e: any) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }

  function downloadPNG() {
    if (!currentB64) return;
    const a = document.createElement("a");
    a.href = `data:image/png;base64,${currentB64}`;
    a.download = "vizualizacia.png";
    a.click();
  }

  function closeLeadForm() {
    setLeadOpen(false);
    setLeadSubmitting(false);
    setPendingDownload(false);
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

    setLeadErr(e);
    return Object.keys(e).length === 0;
  }

  async function submitLead(e: React.FormEvent) {
    e.preventDefault();
    if (leadSubmitting) return;
    if (!validateLead()) return;

    if (!currentVariant) {
      setLeadErr((prev) => ({
        ...prev,
        email: prev.email || "Najprv vyber vygenerovanú variantu, potom odošli formulár.",
      }));
      return;
    }

    setLeadSubmitting(true);
    try {
      const r = await fetch("/api/lead/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead,
          pergolaType: currentVariant.type,
          imageB64: currentVariant.b64,
          variantIndex: selectedVariantIndex + 1,
        }),
      });

      if (!r.ok) {
        const t = await r.text();
        throw new Error(t || `HTTP ${r.status}`);
      }

      setLeadSubmitted(true);
      setLeadOpen(false);
      setLeadSubmitting(false);

      if (pendingDownload) {
        setTimeout(() => downloadPNG(), 50);
        setPendingDownload(false);
      }
    } catch (err: any) {
      console.error(err);
      setLeadSubmitting(false);
      setLeadErr((prev) => ({
        ...prev,
        email: prev.email || "Nepodarilo sa odoslať formulár. Skús znova.",
      }));
    }
  }

  function onDownloadClick() {
    if (!currentB64) return;
    if (leadSubmitted) {
      downloadPNG();
      return;
    }
    setPendingDownload(true);
    setLeadErr({});
    setLeadOpen(true);
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault();
    const p = toCanvasXY(e);

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
        (e.currentTarget as any).setPointerCapture(e.pointerId);
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
    (e.currentTarget as any).setPointerCapture(e.pointerId);
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

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    setActiveHandle(null);

    if (mode === "resize") setMode("move");
    e.preventDefault();
  }

  function Stepper() {
    const hasAnyVariant = variants.length > 0;
    const current = !bgImg ? 1 : !hasAnyVariant ? 2 : !leadSubmitted ? 4 : 5;

    const steps = [
      { n: 1, text: "Nahraj fotku" },
      { n: 2, text: "Umiestni pergolu" },
      { n: 3, text: "Vygeneruj vizualizáciu" },
      { n: 4, text: "Vyplň kontaktné údaje a približné rozmery" },
      { n: 5, text: "Získaj vizualizáciu" },
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

  function ScaleRow({ label, value, axis }: { label: string; value: number; axis: "x" | "y" | "z" }) {
    return (
      <div className="scaleRow">
        <div className="scaleLbl">{label}</div>

        <button
          type="button"
          className="miniBtn"
          disabled={loading}
          onClick={() => bumpScaleAxis(axis, -SCALE_STEP)}
          aria-label={`Zmenšiť ${label}`}
        >
          −
        </button>

        <input
          className="range range--big"
          type="range"
          min={SCALE_MIN}
          max={SCALE_MAX}
          step={SCALE_STEP}
          value={value}
          disabled={loading}
          onChange={(e) => setScaleAxis(axis, Number(e.target.value))}
          aria-label={`Rozmer ${label}`}
        />

        <button
          type="button"
          className="miniBtn"
          disabled={loading}
          onClick={() => bumpScaleAxis(axis, SCALE_STEP)}
          aria-label={`Zväčšiť ${label}`}
        >
          +
        </button>

        <div className="scaleVal">{value.toFixed(1)}%</div>
      </div>
    );
  }

  const canGenerate = !!bgImg && !loading && !leadSubmitted && variants.length < 3;

  const getSheetMaxDown = () => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    const openPeek = Math.round(vh * 0.72);
    const openTop = vh - openPeek;

    const collapsedPeek = 92;
    const collapsedTop = vh - collapsedPeek;

    return Math.max(0, collapsedTop - openTop);
  };

  const openSheet = () => {
    setSheetOpen(true);
    setSheetY(0);
  };
  const closeSheet = () => {
    setSheetOpen(false);
    setSheetY(getSheetMaxDown());
  };

  useEffect(() => {
    if (!isMobileRef.current) return;
    setSheetY(getSheetMaxDown());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onHandlePointerDown = (e: React.PointerEvent) => {
    if (!isMobileRef.current) return;
    e.preventDefault();

    const maxDown = getSheetMaxDown();
    sheetDragRef.current = {
      dragging: true,
      startY: e.clientY,
      startSheetY: sheetOpen ? sheetY : maxDown,
      maxDown,
    };

    (e.currentTarget as any).setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    if (!sheetDragRef.current.dragging) return;
    e.preventDefault();
    const dy = e.clientY - sheetDragRef.current.startY;
    const next = clamp(sheetDragRef.current.startSheetY + dy, 0, sheetDragRef.current.maxDown);
    setSheetY(next);
    setSheetOpen(next < sheetDragRef.current.maxDown * 0.5);
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    if (!sheetDragRef.current.dragging) return;
    e.preventDefault();
    sheetDragRef.current.dragging = false;

    const maxDown = sheetDragRef.current.maxDown;
    const shouldOpen = sheetY < maxDown * 0.5;
    if (shouldOpen) openSheet();
    else closeSheet();
  };

  return (
    <section className="ter-wrap">
      {/* range global styling (väčší track + thumb) */}
      <style jsx global>{`
        .ter-wrap :global(input.range--big) {
          width: 100%;
          height: 42px;
          accent-color: #111;
        }
        .ter-wrap :global(input.range--big::-webkit-slider-runnable-track) {
          height: 10px;
          border-radius: 999px;
        }
        .ter-wrap :global(input.range--big::-webkit-slider-thumb) {
          width: 22px;
          height: 22px;
          margin-top: -6px;
        }
        .ter-wrap :global(input.range--big::-moz-range-track) {
          height: 10px;
          border-radius: 999px;
        }
        .ter-wrap :global(input.range--big::-moz-range-thumb) {
          width: 22px;
          height: 22px;
          border: none;
        }
      `}</style>

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
          min-width: 860px;
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
          min-width: 150px;
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
          max-width: 220px;
          margin: 0;
        }
        .ter-wrap .ter-stepper .stepText.active {
          color: rgba(0, 0, 0, 0.9);
          font-weight: 800;
        }
        @media (max-width: 960px) {
          .ter-wrap .ter-stepper .stepperBar {
            min-width: 740px;
          }
        }
      `}</style>

      <style jsx>{`
        .ter-wrap {
          background: #f6f6f6;
          color: #111;
          padding: 48px 16px;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto;
        }
        .container {
          max-width: 1320px;
          margin: 0 auto;
        }
        .hero {
          display: grid;
          gap: 10px;
          margin-bottom: 18px;
        }
        h2 {
          margin: 0;
          font-size: 34px;
          line-height: 1.15;
          letter-spacing: -0.02em;
        }
        .sub {
          margin: 0;
          color: rgba(0, 0, 0, 0.7);
          font-size: 16px;
          max-width: 95ch;
        }

        .grid {
          display: grid;
          grid-template-columns: 2.2fr 0.8fr;
          gap: 18px;
          margin-top: 18px;
          align-items: start;
        }
        .card {
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 18px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.06);
          overflow: hidden;
        }
        .cardHeader {
          padding: 14px 16px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
        }
        .cardTitle {
          font-size: 16px;
          font-weight: 900;
          letter-spacing: -0.01em;
        }
        .hint {
          font-size: 12px;
          color: rgba(0, 0, 0, 0.55);
          font-weight: 700;
        }
        .cardBody {
          padding: 14px 16px;
        }

        .canvasWrap {
          display: grid;
          gap: 10px;
        }
        .canvasShell {
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.08);
          border-radius: 14px;
          overflow: auto;
          padding: 10px;
        }
        canvas {
          border-radius: 12px;
          display: block;
          background: #fff;
        }

        .toolbar {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
          justify-content: space-between;
        }
        .tabs {
          display: inline-flex;
          border: 1px solid rgba(0, 0, 0, 0.1);
          background: rgba(0, 0, 0, 0.03);
          border-radius: 999px;
          padding: 4px;
          gap: 4px;
        }
        .tab {
          border: none;
          background: transparent;
          border-radius: 999px;
          padding: 9px 12px;
          font-weight: 800;
          font-size: 13px;
          cursor: pointer;
          color: rgba(0, 0, 0, 0.7);
        }
        .tab.active {
          background: #fff;
          color: #111;
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.06);
        }

        .row {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
        }

        .ter-btn {
          border-radius: 12px;
          padding: 11px 12px;
          font-weight: 900;
          cursor: pointer;
          border: 1px solid rgba(0, 0, 0, 0.14);
          background: #fff;
          color: #111;
        }
        .ter-btn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .ter-btn--primary {
          background: #111;
          color: #fff;
          border-color: #111;
        }
        .ter-btn--ghost {
          background: rgba(0, 0, 0, 0.03);
          border-color: rgba(0, 0, 0, 0.12);
          color: #111;
        }

        .miniBtn {
          width: 34px;
          height: 34px;
          min-width: 34px;
          min-height: 34px;
          border-radius: 10px;
          border: 1px solid rgba(0, 0, 0, 0.16);
          background: rgba(0, 0, 0, 0.03);
          color: #111;
          font-weight: 950;
          font-size: 18px;
          line-height: 1;
          display: inline-grid;
          place-items: center;
          cursor: pointer;
          user-select: none;
        }
        .miniBtn:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }

        .field {
          display: grid;
          gap: 6px;
        }
        .label {
          font-size: 12px;
          font-weight: 900;
          color: rgba(0, 0, 0, 0.65);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .input,
        .select {
          width: 100%;
          padding: 11px 12px;
          border-radius: 12px;
          border: 1px solid rgba(0, 0, 0, 0.12);
          background: #fff;
          outline: none;
          font-weight: 700;
          color: #111;
        }

        .scaleBlock {
          display: grid;
          gap: 12px;
          margin-top: 6px;
        }
        .scaleRow {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .scaleLbl {
          width: 18px;
          font-weight: 900;
          color: rgba(0, 0, 0, 0.75);
          flex: 0 0 auto;
        }
        .scaleVal {
          width: 76px;
          text-align: right;
          font-variant-numeric: tabular-nums;
          font-weight: 900;
          color: rgba(0, 0, 0, 0.7);
          flex: 0 0 auto;
        }

        .sticky {
          position: sticky;
          top: 16px;
        }
        .sectionTitle {
          font-size: 12px;
          font-weight: 900;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: rgba(0, 0, 0, 0.55);
          margin: 2px 0 10px;
        }
        .divider {
          height: 1px;
          background: rgba(0, 0, 0, 0.08);
          margin: 14px 0;
        }

        .note {
          font-size: 13px;
          color: rgba(0, 0, 0, 0.65);
          font-weight: 650;
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
        .outputPreview {
          border-radius: 14px;
          border: 1px solid rgba(0, 0, 0, 0.08);
          overflow: hidden;
          background: #fff;
        }
        .outputPreview img {
          display: block;
          width: 100%;
          height: auto;
        }

        /* Variants thumbnails under photo */
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
        .variantCard.has:hover {
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.08);
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
          height: 120px;
          object-fit: cover;
          display: block;
        }
        .variantEmpty {
          padding: 14px 10px;
          font-size: 12px;
          font-weight: 800;
          color: rgba(0, 0, 0, 0.45);
        }

        .mobileBar {
          display: none;
        }
        @media (max-width: 960px) {
          .grid {
            grid-template-columns: 1fr;
          }
          h2 {
            font-size: 28px;
          }
          .sticky {
            position: static;
          }
          .desktopOnly {
            display: none;
          }
          .variantsGrid {
            grid-template-columns: 1fr;
          }
          .variantCard img {
            height: 160px;
          }
          .mobileBar {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            padding: 12px 16px;
            background: rgba(246, 246, 246, 0.92);
            backdrop-filter: blur(10px);
            border-top: 1px solid rgba(0, 0, 0, 0.08);
            z-index: 60;
          }
          .mobileSpacer {
            height: 70px;
          }
        }

        .sheet {
          display: none;
        }
        @media (max-width: 960px) {
          .sheet {
            display: block;
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            z-index: 55;
            pointer-events: auto;
          }
          .sheetCard {
            border-top-left-radius: 18px;
            border-top-right-radius: 18px;
            background: #fff;
            border: 1px solid rgba(0, 0, 0, 0.1);
            box-shadow: 0 -16px 60px rgba(0, 0, 0, 0.14);
            overflow: hidden;
          }
          .sheetHandleRow {
            padding: 10px 16px 6px;
            display: grid;
            gap: 6px;
          }
          .handle {
            width: 46px;
            height: 5px;
            border-radius: 999px;
            background: rgba(0, 0, 0, 0.18);
            margin: 0 auto;
          }
          .sheetTopLine {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
          }
          .sheetTitle {
            font-weight: 950;
            letter-spacing: -0.01em;
            font-size: 13px;
            color: rgba(0, 0, 0, 0.7);
          }
          .sheetToggle {
            font-weight: 900;
            border: 1px solid rgba(0, 0, 0, 0.12);
            background: rgba(0, 0, 0, 0.03);
            border-radius: 999px;
            padding: 8px 10px;
            cursor: pointer;
          }
          .sheetBody {
            padding: 10px 16px 90px;
            max-height: 72vh;
            overflow: auto;
          }
          .sheetGrid {
            display: grid;
            gap: 12px;
          }
          .sheetBlock {
            border: 1px solid rgba(0, 0, 0, 0.08);
            border-radius: 14px;
            padding: 12px;
            background: rgba(0, 0, 0, 0.015);
          }
        }

        .modalOverlay {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.55);
          display: grid;
          place-items: center;
          padding: 16px;
          z-index: 9999;
        }
        .modalCard {
          width: min(820px, 100%);
          border-radius: 18px;
          background: #fff;
          border: 1px solid rgba(0, 0, 0, 0.12);
          box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
          overflow: hidden;
        }
        .modalHead {
          padding: 14px 16px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.06);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
        }
        .modalTitle {
          font-weight: 1000;
          letter-spacing: -0.01em;
          margin: 0;
          font-size: 16px;
        }
        .modalSub {
          margin: 6px 0 0;
          color: rgba(0, 0, 0, 0.65);
          font-weight: 650;
          font-size: 13px;
        }
        .modalBody {
          padding: 14px 16px 16px;
        }
        .formGrid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        .span2 {
          grid-column: 1 / -1;
        }
        .errText {
          color: rgba(160, 0, 0, 0.9);
          font-size: 12px;
          font-weight: 800;
        }
        .dimsGrid {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 720px) {
          .formGrid {
            grid-template-columns: 1fr;
          }
          .dimsGrid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="container">
        <div className="hero">
          <h2>Vizualizácia pergoly na vašom dome</h2>
          <p className="sub">
            Nahrajte fotku, umiestnite pergolu a vytvorte si až <b>3 varianty</b>. Nakoniec vyberte jednu, vyplňte formulár a stiahnite PNG.
          </p>
          <Stepper />
        </div>

        <div className="grid">
          {/* LEFT */}
          <div className="card">
            <div className="cardHeader">
              <div className="cardTitle">Editor</div>
              <div className="hint">
                Režim: <b>{mode === "move" ? "POSUN" : mode === "rotate3d" ? "OTOČ 3D" : mode.toUpperCase()}</b>
              </div>
            </div>

            <div className="cardBody">
              <div className="canvasWrap">
                <div className="toolbar">
                  <div className="tabs" role="tablist" aria-label="Režimy">
                    <button type="button" className={`tab ${mode === "move" ? "active" : ""}`} onClick={() => setMode("move")}>
                      Posun
                    </button>
                    <button type="button" className={`tab ${mode === "rotate3d" ? "active" : ""}`} onClick={() => setMode("rotate3d")}>
                      Otoč 3D
                    </button>
                  </div>

                  <div className="row desktopOnly">
                    <div className="field" style={{ minWidth: 260 }}>
                      <div className="label">Zoom</div>
                      <input
                        className="range range--big"
                        type="range"
                        min={50}
                        max={160}
                        step={5}
                        value={editorZoom}
                        onChange={(e) => setEditorZoom(Number(e.target.value))}
                      />
                    </div>
                    <div className="note" style={{ fontVariantNumeric: "tabular-nums" }}>
                      {editorZoom}%
                    </div>
                    <button type="button" className="ter-btn ter-btn--ghost" onClick={resetAll}>
                      Reset
                    </button>
                  </div>
                </div>

                <div className="canvasShell">
                  <div style={{ width: Math.round((canvasW * editorZoom) / 100), height: Math.round((canvasH * editorZoom) / 100) }}>
                    <canvas
                      ref={canvasRef}
                      width={canvasW}
                      height={canvasH}
                      style={{ width: `${(canvasW * editorZoom) / 100}px`, height: `${(canvasH * editorZoom) / 100}px`, touchAction: "none" }}
                      onPointerDown={onPointerDown}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                    />
                  </div>
                </div>

                {/* ✅ 3 náhľady variantov */}
                <div className="variantsWrap">
                  <div className="variantsHead">
                    <div className="variantsTitle">Varianty (max 3)</div>
                    <div className="variantsNote">
                      Zostáva: <b>{remaining}</b>/3 • typ sa môže meniť, existujúce varianty ostanú
                    </div>
                  </div>

                  <div className="variantsGrid" role="list" aria-label="Varianty vizualizácie">
                    {[0, 1, 2].map((i) => {
                      const v = variants[i] || null;
                      const selected = selectedVariantIndex === i;

                      return (
                        <button
                          key={i}
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

                          {v ? (
                            <img src={`data:image/png;base64,${v.b64}`} alt={`Variant ${i + 1}`} />
                          ) : (
                            <div className="variantEmpty">Zatiaľ nevygenerované</div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div className="note">Tip: posuň • otoč 3D • rohy pre zmenu veľkosti</div>
                  <button type="button" className="ter-btn ter-btn--ghost" onClick={snapToGround}>
                    Zarovnať na zem
                  </button>
                </div>

                <div className="mobileSpacer" />
              </div>
            </div>
          </div>

          {/* RIGHT sticky */}
          <div className="card sticky desktopOnly">
            <div className="cardHeader">
              <div className="cardTitle">Ovládanie</div>
              <div className="hint">{leadSubmitted ? "✅ Stiahnutie odomknuté" : "Stiahnutie po vyplnení"}</div>
            </div>

            <div className="cardBody">
              <div className="sectionTitle">Krok 1</div>

              <div className="field">
                <div className="label">Fotka</div>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null;
                    setBgFile(f);

                    // nový obrázok = nové varianty
                    setVariants([]);
                    setSelectedVariantIndex(0);

                    setError("");
                    setLeadSubmitted(false);
                  }}
                />
              </div>

              <div style={{ height: 10 }} />

              <div className="field">
                <div className="label">Typ (pre ďalšiu generáciu)</div>
                <select className="select" value={pergolaType} onChange={(e) => setPergolaType(e.target.value as PergolaType)}>
                  <option value="bioklim">Bioklimatická pergola</option>
                  <option value="pevna">Pergola s pevnou strechou</option>
                  <option value="zimna">Zimná záhrada</option>
                </select>
              </div>

              <div className="divider" />

              {/* ✅ Slidre presunuté do sticky */}
              <div className="sectionTitle">Rozmery (1% – 200%)</div>
              <div className="scaleBlock">
                <ScaleRow label="X" axis="x" value={scalePct.x} />
                <ScaleRow label="Y" axis="y" value={scalePct.y} />
                <ScaleRow label="Z" axis="z" value={scalePct.z} />
              </div>

              <div className="divider" />

              {error ? <div className="errorBox">Chyba: {error}</div> : null}

              <div className="divider" />

              <div className="sectionTitle">Krok 3</div>

              <div className="row" style={{ justifyContent: "space-between" }}>
                <button type="button" className="ter-btn ter-btn--primary" onClick={generate} disabled={!canGenerate}>
                  {loading ? "Generujem..." : variants.length >= 3 ? "Limit 3 varianty" : `Vygenerovať variant (${variants.length + 1}/3)`}
                </button>

                <button type="button" className="ter-btn" onClick={onDownloadClick} disabled={!currentB64}>
                  Stiahnuť PNG
                </button>
              </div>

              {currentVariant ? (
                <div style={{ marginTop: 10 }} className="note">
                  Vybrané: <b>Variant {selectedVariantIndex + 1}</b> • {typeLabel(currentVariant.type)}
                </div>
              ) : (
                <div style={{ marginTop: 10 }} className="note">
                  Najprv vygeneruj aspoň 1 variantu.
                </div>
              )}

              {currentB64 ? (
                <div style={{ marginTop: 14 }} className="outputPreview">
                  <img src={`data:image/png;base64,${currentB64}`} alt="Vybraná vizualizácia" />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* Mobile action bar */}
      <div className="mobileBar">
        <button type="button" className="ter-btn ter-btn--primary" onClick={generate} disabled={!canGenerate}>
          {loading ? "Generujem..." : variants.length >= 3 ? "Limit 3 varianty" : `Vygenerovať (${variants.length + 1}/3)`}
        </button>

        <button type="button" className="ter-btn" onClick={onDownloadClick} disabled={!currentB64}>
          Stiahnuť PNG
        </button>
      </div>

      {/* Mobile bottom-sheet */}
      <div className="sheet" aria-hidden={!isMobileRef.current}>
        <div
          className="sheetCard"
          style={{
            transform: `translateY(${sheetY}px)`,
            transition: sheetDragRef.current.dragging ? "none" : "transform 220ms ease",
          }}
        >
          <div
            className="sheetHandleRow"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
          >
            <div className="handle" />
            <div className="sheetTopLine">
              <div className="sheetTitle">Nastavenia (typ / zoom / rozmery)</div>
              <button type="button" className="sheetToggle" onClick={() => (sheetOpen ? closeSheet() : openSheet())}>
                {sheetOpen ? "Zavrieť" : "Otvoriť"}
              </button>
            </div>
          </div>

          <div className="sheetBody">
            {error ? <div className="errorBox">Chyba: {error}</div> : null}

            <div className="sheetGrid">
              <div className="sheetBlock">
                <div className="sectionTitle">Fotka</div>
                <div className="field">
                  <div className="label">Nahraj</div>
                  <input
                    className="input"
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0] || null;
                      setBgFile(f);

                      setVariants([]);
                      setSelectedVariantIndex(0);

                      setError("");
                      setLeadSubmitted(false);
                    }}
                  />
                </div>
              </div>

              <div className="sheetBlock">
                <div className="sectionTitle">Typ (pre ďalšiu generáciu)</div>
                <div className="field">
                  <div className="label">Vyber</div>
                  <select className="select" value={pergolaType} onChange={(e) => setPergolaType(e.target.value as PergolaType)}>
                    <option value="bioklim">Bioklimatická pergola</option>
                    <option value="pevna">Pergola s pevnou strechou</option>
                    <option value="zimna">Zimná záhrada</option>
                  </select>
                </div>
              </div>

              <div className="sheetBlock">
                <div className="sectionTitle">Zoom</div>
                <input
                  className="range range--big"
                  type="range"
                  min={50}
                  max={160}
                  step={5}
                  value={editorZoom}
                  onChange={(e) => setEditorZoom(Number(e.target.value))}
                />
              </div>

              <div className="sheetBlock">
                <div className="sectionTitle">Rozmery (1% – 200%)</div>
                <div className="scaleBlock">
                  <ScaleRow label="X" axis="x" value={scalePct.x} />
                  <ScaleRow label="Y" axis="y" value={scalePct.y} />
                  <ScaleRow label="Z" axis="z" value={scalePct.z} />
                </div>
              </div>

              <div className="sheetBlock">
                <button type="button" className="ter-btn ter-btn--ghost" onClick={resetAll}>
                  Reset
                </button>
              </div>

              <div className="sheetBlock">
                <div className="note">
                  Pozn.: Hold/drag na slidere sú vypnuté. Použi klasický slider a kliky na +/−.
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lead modal */}
      {leadOpen ? (
        <div
          className="modalOverlay"
          role="dialog"
          aria-modal="true"
          onMouseDown={(ev) => {
            if (ev.target === ev.currentTarget) closeLeadForm();
          }}
        >
          <div className="modalCard">
            <div className="modalHead">
              <div>
                <p className="modalTitle">Vyplň kontaktné údaje a približné rozmery</p>
                <p className="modalSub">Po odoslaní formulára sa vizualizácia sprístupní na stiahnutie.</p>
              </div>
              <button type="button" className="ter-btn ter-btn--ghost" onClick={closeLeadForm}>
                ✕
              </button>
            </div>

            <div className="modalBody">
              <form onSubmit={submitLead} className="formGrid">
                <div className="field">
                  <div className="label">Meno *</div>
                  <input className="input" value={lead.name} onChange={(e) => setLead((p) => ({ ...p, name: e.target.value }))} placeholder="Meno a priezvisko" />
                  {leadErr.name ? <div className="errText">{leadErr.name}</div> : null}
                </div>

                <div className="field">
                  <div className="label">Mesto *</div>
                  <input className="input" value={lead.city} onChange={(e) => setLead((p) => ({ ...p, city: e.target.value }))} placeholder="Mesto" />
                  {leadErr.city ? <div className="errText">{leadErr.city}</div> : null}
                </div>

                <div className="field">
                  <div className="label">Telefón *</div>
                  <input className="input" value={lead.phone} onChange={(e) => setLead((p) => ({ ...p, phone: e.target.value }))} placeholder="+421 9xx xxx xxx" inputMode="tel" />
                  {leadErr.phone ? <div className="errText">{leadErr.phone}</div> : null}
                </div>

                <div className="field">
                  <div className="label">Emailová adresa *</div>
                  <input className="input" value={lead.email} onChange={(e) => setLead((p) => ({ ...p, email: e.target.value }))} placeholder="meno@domena.sk" inputMode="email" />
                  {leadErr.email ? <div className="errText">{leadErr.email}</div> : null}
                </div>

                <div className="span2" style={{ marginTop: 4 }}>
                  <div className="sectionTitle">Približné rozmery pergoly *</div>
                  <div className="dimsGrid">
                    <div className="field">
                      <div className="label">Šírka</div>
                      <input className="input" value={lead.approxWidth} onChange={(e) => setLead((p) => ({ ...p, approxWidth: e.target.value }))} placeholder="napr. 4.0 m" />
                      {leadErr.approxWidth ? <div className="errText">{leadErr.approxWidth}</div> : null}
                    </div>

                    <div className="field">
                      <div className="label">Hĺbka</div>
                      <input className="input" value={lead.approxDepth} onChange={(e) => setLead((p) => ({ ...p, approxDepth: e.target.value }))} placeholder="napr. 3.5 m" />
                      {leadErr.approxDepth ? <div className="errText">{leadErr.approxDepth}</div> : null}
                    </div>

                    <div className="field">
                      <div className="label">Výška</div>
                      <input className="input" value={lead.approxHeight} onChange={(e) => setLead((p) => ({ ...p, approxHeight: e.target.value }))} placeholder="napr. 2.5 m" />
                      {leadErr.approxHeight ? <div className="errText">{leadErr.approxHeight}</div> : null}
                    </div>
                  </div>
                </div>

                <div className="span2" style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                  <button type="button" className="ter-btn ter-btn--ghost" onClick={closeLeadForm} disabled={leadSubmitting}>
                    Zrušiť
                  </button>

                  <button type="submit" className="ter-btn ter-btn--primary" disabled={leadSubmitting}>
                    {leadSubmitting ? "Odosielam..." : "Odoslať a stiahnuť"}
                  </button>
                </div>

                <div className="span2 note" style={{ marginTop: 6 }}>
                  Odoslaním formulára súhlasíte so spracovaním osobných údajov.
                </div>
              </form>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
