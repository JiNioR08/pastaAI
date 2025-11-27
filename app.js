// app/static/app.js (FULL)

// ⚠️ 만약 이 파일 안에 ":contentReference[oaicite:0]{index=0}" 같은 줄이 생기면
// 그 줄은 JS가 아니니까 무조건 삭제해야 함.

const $ = (id) => document.getElementById(id);

const els = {
  file: $("file"),
  stage: $("stage"),
  canvas: $("canvas"),
  hint: $("hint"),

  undo: $("undo"),
  redo: $("redo"),
  auto: $("auto"),
  compare: $("compare"),
  compareBar: $("compareBar"),
  comparePos: $("comparePos"),

  flipH: $("flipH"),
  flipV: $("flipV"),
  reset: $("reset"),
  crop: $("crop"),

  rotate: $("rotate"),
  scale: $("scale"),
  brightness: $("brightness"),
  contrast: $("contrast"),
  saturation: $("saturation"),
  sharpness: $("sharpness"),
  blur: $("blur"),
  grayscale: $("grayscale"),
  invert: $("invert"),

  fmt: $("fmt"),
  quality: $("quality"),
  download: $("download"),

  cropOverlay: $("cropOverlay"),
  cropBox: $("cropBox"),

  openSettings: $("openSettings"),
  closeSettings: $("closeSettings"),
  overlay: $("overlay"),
  drawer: $("settingsDrawer"),
  theme: $("theme"),
  accent: $("accent"),
  reduceMotion: $("reduceMotion"),
  compact: $("compact"),
  resetSettings: $("resetSettings"),
};

const state = {
  flip_h: false,
  flip_v: false,
  rotate: 0,      // deg
  scale: 1,       // 1.0 = 100%

  brightness: 1,
  contrast: 1,
  saturation: 1,
  sharpness: 1,   // 1.0 = default
  blur: 0,
  grayscale: false,
  invert: false,

  compare: false,
  compare_pos: 50,
};

/* ---------- working image (crop bakes into this blob) ---------- */
let workingBlob = null;
let workingName = "image.png";
let loadedBlob = null;

let bitmap = null;
let imgW = 0;
let imgH = 0;

/* ---------------- General Settings ---------------- */
const SKEY = "mini_editor_general_v1";
const ACCENTS = { blue:"#2c5cff", green:"#19b37a", purple:"#8b5cf6", orange:"#f59e0b", pink:"#ec4899" };
const defaultGeneral = { theme:"system", accent:"blue", reduceMotion:false, compact:false };

function loadGeneral() { try { return { ...defaultGeneral, ...(JSON.parse(localStorage.getItem(SKEY)) || {}) }; } catch { return { ...defaultGeneral }; } }
function saveGeneral(g) { localStorage.setItem(SKEY, JSON.stringify(g)); }

let general = loadGeneral();
let mq = matchMedia("(prefers-color-scheme: dark)");
mq.addEventListener?.("change", () => { if (general.theme === "system") applyGeneral(general); });

function applyGeneral(g) {
  const root = document.documentElement;
  const sysDark = mq.matches;
  root.dataset.theme = (g.theme === "system") ? (sysDark ? "dark" : "light") : g.theme;
  root.style.setProperty("--accent", ACCENTS[g.accent] || ACCENTS.blue);
  root.dataset.reduceMotion = String(!!g.reduceMotion);
  root.dataset.compact = String(!!g.compact);

  els.theme.value = g.theme;
  els.accent.value = g.accent;
  els.reduceMotion.checked = !!g.reduceMotion;
  els.compact.checked = !!g.compact;
}

function openDrawer() {
  els.drawer.classList.add("open");
  els.drawer.setAttribute("aria-hidden", "false");
  els.overlay.hidden = false;
  els.openSettings.setAttribute("aria-expanded", "true");
}
function closeDrawer() {
  els.drawer.classList.remove("open");
  els.drawer.setAttribute("aria-hidden", "true");
  els.overlay.hidden = true;
  els.openSettings.setAttribute("aria-expanded", "false");
}

els.openSettings.onclick = () => (els.drawer.classList.contains("open") ? closeDrawer() : openDrawer());
els.closeSettings.onclick = closeDrawer;
els.overlay.onclick = closeDrawer;
window.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });

els.theme.addEventListener("change", () => { general.theme = els.theme.value; saveGeneral(general); applyGeneral(general); });
els.accent.addEventListener("change", () => { general.accent = els.accent.value; saveGeneral(general); applyGeneral(general); });
els.reduceMotion.addEventListener("change", () => { general.reduceMotion = els.reduceMotion.checked; saveGeneral(general); applyGeneral(general); scheduleDraw(); });
els.compact.addEventListener("change", () => { general.compact = els.compact.checked; saveGeneral(general); applyGeneral(general); scheduleDraw(); });
els.resetSettings.onclick = () => { general = { ...defaultGeneral }; saveGeneral(general); applyGeneral(general); };

applyGeneral(general);

/* ---------------- Canvas Rendering ---------------- */
const mainCtx = els.canvas.getContext("2d", { willReadFrequently: true });
const beforeC = document.createElement("canvas");
const afterC  = document.createElement("canvas");
const beforeCtx = beforeC.getContext("2d", { willReadFrequently: true });
const afterCtx  = afterC.getContext("2d", { willReadFrequently: true });

let queued = false;
function stageRect() { return els.stage.getBoundingClientRect(); }

function resizeCanvasesFor(cw, ch) {
  for (const c of [els.canvas, beforeC, afterC]) {
    if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
  }
}
function resizeAllCanvases() {
  const r = stageRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.floor(r.width * dpr));
  const h = Math.max(1, Math.floor(r.height * dpr));
  resizeCanvasesFor(w, h);
}
function scheduleDraw() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; draw(); });
}

function fxFilterString() {
  return [
    `brightness(${state.brightness})`,
    `contrast(${state.contrast})`,
    `saturate(${state.saturation})`,
    `blur(${state.blur}px)`,
    state.grayscale ? "grayscale(1)" : "",
    state.invert ? "invert(1)" : "",
  ].filter(Boolean).join(" ");
}

function geometryParams(cw, ch) {
  const rad = (state.rotate * Math.PI) / 180;
  const flipX = state.flip_h ? -1 : 1;
  const flipY = state.flip_v ? -1 : 1;

  const margin = 0.08;
  const fitW = cw * (1 - margin);
  const fitH = ch * (1 - margin);
  const baseScale = Math.min(fitW / imgW, fitH / imgH);
  const s = baseScale * state.scale;

  return { rad, flipX, flipY, s };
}

/* simple sharpen (3x3) – small & fast enough */
function applySharpen(ctx, sharpness) {
  const amount = Math.max(0, Math.min(2, sharpness - 1)); // 0..2
  if (amount <= 0.001) return;

  const w = ctx.canvas.width, h = ctx.canvas.height;
  const src = ctx.getImageData(0, 0, w, h);
  const data = src.data;
  const out = new Uint8ClampedArray(data.length);

  // classic: center (1+4a), neighbors (-a)
  const a = amount * 0.6;

  // copy edges
  out.set(data);

  for (let y = 1; y < h - 1; y++) {
    let row = y * w * 4;
    for (let x = 1; x < w - 1; x++) {
      const i = row + x * 4;

      for (let c = 0; c < 3; c++) {
        const center = data[i + c];
        const up     = data[i + c - w * 4];
        const down   = data[i + c + w * 4];
        const left   = data[i + c - 4];
        const right  = data[i + c + 4];

        let v = center * (1 + 4 * a) - a * (up + down + left + right);
        v = v < 0 ? 0 : v > 255 ? 255 : v;
        out[i + c] = v;
      }
    }
  }

  src.data.set(out);
  ctx.putImageData(src, 0, 0);
}

function renderLayer(ctx, mode) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  if (!bitmap) return;

  const { rad, flipX, flipY, s } = geometryParams(cw, ch);

  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.scale(s * flipX, s * flipY);

  ctx.filter = (mode === "before") ? "none" : fxFilterString();
  ctx.drawImage(bitmap, -imgW / 2, -imgH / 2, imgW, imgH);

  ctx.restore();

  if (mode === "after") applySharpen(ctx, state.sharpness);
}

function draw() {
  resizeAllCanvases();
  const cw = els.canvas.width, ch = els.canvas.height;

  mainCtx.clearRect(0, 0, cw, ch);
  if (!bitmap) return;

  renderLayer(beforeCtx, "before");
  renderLayer(afterCtx, "after");

  if (!state.compare) {
    mainCtx.drawImage(afterC, 0, 0);
    return;
  }

  mainCtx.drawImage(beforeC, 0, 0);

  const x = Math.floor((cw * state.compare_pos) / 100);
  mainCtx.save();
  mainCtx.beginPath();
  mainCtx.rect(x, 0, cw - x, ch);
  mainCtx.clip();
  mainCtx.drawImage(afterC, 0, 0);
  mainCtx.restore();

  // divider
  mainCtx.save();
  mainCtx.globalAlpha = 0.9;
  mainCtx.lineWidth = Math.max(2, Math.floor((window.devicePixelRatio || 1) * 2));
  mainCtx.strokeStyle = "#ffffff";
  mainCtx.beginPath();
  mainCtx.moveTo(x + 0.5, 0);
  mainCtx.lineTo(x + 0.5, ch);
  mainCtx.stroke();
  mainCtx.restore();
}

new ResizeObserver(() => scheduleDraw()).observe(els.stage);
window.addEventListener("resize", () => scheduleDraw());

/* ---------------- Undo/Redo (state + blob) ---------------- */
const MAX_HISTORY = 40;
let history = [];
let future = [];
let commitTimer = null;

const cloneState = () => JSON.parse(JSON.stringify(state));
const snap = () => ({ st: cloneState(), blob: workingBlob, name: workingName });

function sameSnap(a, b) {
  if (!a || !b) return false;
  if (a.blob !== b.blob) return false;
  return JSON.stringify(a.st) === JSON.stringify(b.st);
}

function updateUndoRedoUI() {
  els.undo.disabled = history.length <= 1;
  els.redo.disabled = future.length === 0;
}

async function loadBlob(blob, name = "image.png") {
  workingBlob = blob;
  workingName = name || "image.png";
  loadedBlob = blob;

  bitmap?.close?.();
  bitmap = await createImageBitmap(blob);
  imgW = bitmap.width;
  imgH = bitmap.height;

  els.hint.style.display = "none";
  els.download.disabled = false;
  scheduleDraw();
}

async function applySnap(s) {
  Object.assign(state, s.st);
  if (s.blob && s.blob !== loadedBlob) await loadBlob(s.blob, s.name);
  syncUI();
  scheduleDraw();
  updateUndoRedoUI();
}

function commitHistory(immediate = false) {
  if (commitTimer) clearTimeout(commitTimer);
  const doCommit = () => {
    const s = snap();
    const last = history[history.length - 1];
    if (!last || !sameSnap(last, s)) {
      history.push(s);
      if (history.length > MAX_HISTORY) history.shift();
      future = [];
      updateUndoRedoUI();
    }
  };
  if (immediate) doCommit();
  else commitTimer = setTimeout(doCommit, 220);
}

function undo() {
  if (history.length <= 1) return;
  const cur = history.pop();
  future.push(cur);
  applySnap(history[history.length - 1]).catch(console.error);
}
function redo() {
  if (!future.length) return;
  const s = future.pop();
  history.push(s);
  applySnap(s).catch(console.error);
}

els.undo.onclick = undo;
els.redo.onclick = redo;

window.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if (e.ctrlKey && k === "z" && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (e.ctrlKey && (k === "y" || (k === "z" && e.shiftKey))) { e.preventDefault(); redo(); }
});

/* ---------------- UI Sync + Controls ---------------- */
function syncUI() {
  els.rotate.value = String(state.rotate);
  els.scale.value = String(Math.round(state.scale * 100));

  els.brightness.value = String(Math.round(state.brightness * 100));
  els.contrast.value = String(Math.round(state.contrast * 100));
  els.saturation.value = String(Math.round(state.saturation * 100));
  els.sharpness.value = String(Math.round(state.sharpness * 100));
  els.blur.value = String(Math.round(state.blur));

  els.grayscale.checked = !!state.grayscale;
  els.invert.checked = !!state.invert;

  els.comparePos.value = String(state.compare_pos);
  els.compare.classList.toggle("on", !!state.compare);
  els.compare.setAttribute("aria-pressed", String(!!state.compare));
  els.compareBar.hidden = !state.compare;

  // crop toggle UI (small button)
  els.crop.classList.toggle("on", !!cropMode);
  els.crop.setAttribute("aria-pressed", String(!!cropMode));
}

function bindRange(id, key, div = 100) {
  els[id].addEventListener("input", () => {
    state[key] = Number(els[id].value) / div;
    syncUI();
    scheduleDraw();
    commitHistory(false);
  });
}
bindRange("rotate", "rotate", 1);
bindRange("scale", "scale", 100);
bindRange("brightness", "brightness", 100);
bindRange("contrast", "contrast", 100);
bindRange("saturation", "saturation", 100);
bindRange("sharpness", "sharpness", 100);
bindRange("blur", "blur", 1);

els.grayscale.addEventListener("change", () => { state.grayscale = els.grayscale.checked; syncUI(); scheduleDraw(); commitHistory(true); });
els.invert.addEventListener("change", () => { state.invert = els.invert.checked; syncUI(); scheduleDraw(); commitHistory(true); });

els.flipH.onclick = () => { state.flip_h = !state.flip_h; syncUI(); scheduleDraw(); commitHistory(true); };
els.flipV.onclick = () => { state.flip_v = !state.flip_v; syncUI(); scheduleDraw(); commitHistory(true); };

els.compare.onclick = () => {
  state.compare = !state.compare;
  if (state.compare) { state.compare_pos = 50; els.comparePos.value = "50"; }
  syncUI();
  scheduleDraw();
};

els.comparePos.addEventListener("input", () => {
  state.compare_pos = Number(els.comparePos.value);
  scheduleDraw();
});

els.auto.onclick = () => {
  state.brightness = 1.05;
  state.contrast = 1.12;
  state.saturation = 1.08;
  state.sharpness = 1.15;
  state.blur = 0;
  state.grayscale = false;
  state.invert = false;
  syncUI();
  scheduleDraw();
  commitHistory(true);
};

els.reset.onclick = () => {
  Object.assign(state, {
    flip_h:false, flip_v:false, rotate:0, scale:1,
    brightness:1, contrast:1, saturation:1, sharpness:1,
    blur:0, grayscale:false, invert:false,
    compare:false, compare_pos:50,
  });
  syncUI();
  scheduleDraw();
  commitHistory(true);
};

/* ---------------- Crop (mouse drag + rule-of-thirds grid) ---------------- */
let cropMode = false;
let cropRect = null; // {x,y,w,h} in CSS px relative to stage
let dragging = false;
let moving = false;
let sx = 0, sy = 0, ox = 0, oy = 0;

function setCropBox(r) {
  cropRect = r;
  els.cropBox.style.left = `${r.x}px`;
  els.cropBox.style.top = `${r.y}px`;
  els.cropBox.style.width = `${r.w}px`;
  els.cropBox.style.height = `${r.h}px`;
}

function defaultCropRect() {
  const r = stageRect();
  const w = Math.max(140, r.width * 0.72);
  const h = Math.max(140, r.height * 0.72);
  return { x:(r.width - w)/2, y:(r.height - h)/2, w, h };
}

function toggleCrop(on) {
  cropMode = on;
  els.cropOverlay.hidden = !on;
  els.crop.classList.toggle("on", on);
  els.crop.setAttribute("aria-pressed", String(on));
  if (on) setCropBox(defaultCropRect());
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
}

function clampRect(r) {
  const sr = stageRect();
  const minW = 40, minH = 40;

  r.w = Math.max(minW, r.w);
  r.h = Math.max(minH, r.h);

  r.x = Math.max(0, Math.min(sr.width - r.w, r.x));
  r.y = Math.max(0, Math.min(sr.height - r.h, r.y));
  return r;
}

els.crop.onclick = () => {
  if (!bitmap) return;
  if (!cropMode) {
    toggleCrop(true);
  } else {
    applyCrop().catch(console.error);
  }
  syncUI();
};

els.cropOverlay.addEventListener("pointerdown", (e) => {
  if (!cropMode) return;
  const sr = stageRect();
  const x = e.clientX - sr.left;
  const y = e.clientY - sr.top;

  dragging = true;
  els.cropOverlay.setPointerCapture(e.pointerId);

  if (cropRect && pointInRect(x, y, cropRect)) {
    moving = true;
    ox = x - cropRect.x;
    oy = y - cropRect.y;
  } else {
    moving = false;
    sx = x; sy = y;
    setCropBox(clampRect({ x:sx, y:sy, w:1, h:1 }));
  }
});

els.cropOverlay.addEventListener("pointermove", (e) => {
  if (!cropMode || !dragging) return;
  const sr = stageRect();
  const x = e.clientX - sr.left;
  const y = e.clientY - sr.top;

  if (moving) {
    setCropBox(clampRect({ ...cropRect, x: x - ox, y: y - oy }));
  } else {
    const left = Math.min(sx, x);
    const top = Math.min(sy, y);
    const w = Math.abs(x - sx);
    const h = Math.abs(y - sy);
    setCropBox(clampRect({ x:left, y:top, w, h }));
  }
});

els.cropOverlay.addEventListener("pointerup", (e) => {
  if (!cropMode) return;
  dragging = false;
  moving = false;
  try { els.cropOverlay.releasePointerCapture(e.pointerId); } catch {}
});

window.addEventListener("keydown", (e) => {
  if (!cropMode) return;
  if (e.key === "Escape") {
    e.preventDefault();
    toggleCrop(false);
    syncUI();
  } else if (e.key === "Enter") {
    e.preventDefault();
    applyCrop().catch(console.error);
  }
});

function renderGeometryOnlyTo(ctx) {
  const cw = ctx.canvas.width, ch = ctx.canvas.height;
  ctx.clearRect(0, 0, cw, ch);
  if (!bitmap) return;

  const { rad, flipX, flipY, s } = geometryParams(cw, ch);

  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  ctx.rotate(rad);
  ctx.scale(s * flipX, s * flipY);
  ctx.filter = "none";
  ctx.drawImage(bitmap, -imgW / 2, -imgH / 2, imgW, imgH);
  ctx.restore();
}

async function applyCrop() {
  if (!bitmap || !cropRect) return;

  // bake canvas size (higher => less blurry crop)
  const sr = stageRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const baseCW = Math.max(1, Math.floor(sr.width * dpr));
  const baseCH = Math.max(1, Math.floor(sr.height * dpr));

  const up = Math.min(3, Math.max(1, Math.floor(Math.min(imgW, imgH) / 900)));
  const cw = baseCW * up;
  const ch = baseCH * up;

  // CSS px -> baked canvas px
  const sxScale = cw / Math.max(1, sr.width);
  const syScale = ch / Math.max(1, sr.height);

  const rx = Math.max(0, Math.floor(cropRect.x * sxScale));
  const ry = Math.max(0, Math.floor(cropRect.y * syScale));
  const rw = Math.max(2, Math.floor(cropRect.w * sxScale));
  const rh = Math.max(2, Math.floor(cropRect.h * syScale));

  // bake geometry to big canvas
  const geoC = document.createElement("canvas");
  geoC.width = cw; geoC.height = ch;
  const gctx = geoC.getContext("2d", { willReadFrequently: true });
  renderGeometryOnlyTo(gctx);

  // crop out
  const outC = document.createElement("canvas");
  outC.width = rw; outC.height = rh;
  const octx = outC.getContext("2d");
  octx.drawImage(geoC, rx, ry, rw, rh, 0, 0, rw, rh);

  const blob = await new Promise((res) => outC.toBlob(res, "image/png", 1));
  if (!blob) return;

  // bake geometry into image, reset geometry controls (filters stay adjustable)
  Object.assign(state, { flip_h:false, flip_v:false, rotate:0, scale:1 });
  await loadBlob(blob, "cropped.png");

  toggleCrop(false);
  syncUI();
  commitHistory(true);
}

/* ---------------- Load Image ---------------- */
els.file.addEventListener("change", async () => {
  const f = els.file.files?.[0];
  if (!f) return;
  await loadBlob(f, f.name);

  history = [snap()];
  future = [];
  updateUndoRedoUI();
  syncUI();
});

/* ---------------- Download (server render) ---------------- */
els.download.onclick = async () => {
  if (!workingBlob) return alert("이미지를 먼저 선택하세요!");

  const fd = new FormData();
  const fileLike = new File([workingBlob], workingName || "image.png", { type: workingBlob.type || "image/png" });
  fd.append("file", fileLike);

  fd.append("fmt", els.fmt.value);
  fd.append("quality", els.quality.value);

  const payload = { ...state };
  delete payload.compare;
  delete payload.compare_pos;

  for (const [k, v] of Object.entries(payload)) fd.append(k, String(v));

  const res = await fetch("/api/render", { method: "POST", body: fd });
  if (!res.ok) return alert("렌더링 실패 😵");

  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `edited.${els.fmt.value === "jpeg" ? "jpg" : els.fmt.value}`;
  a.click();
  URL.revokeObjectURL(a.href);
};

/* init */
syncUI();
updateUndoRedoUI();
scheduleDraw();
