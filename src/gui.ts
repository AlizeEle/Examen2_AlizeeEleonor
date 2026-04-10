// gui.ts — zero imports from main.ts (breaks circular dependency)
import type { SceneObject } from "./scene";

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

// ── Callbacks wired by main.ts after init ────────────────────────────────────
type Callbacks = {
  getScene:    () => SceneObject[];
  getSelected: () => SceneObject | null;
  setSelected: (o: SceneObject | null) => void;
  addObject:   (s: "sphere" | "cube") => void;
  removeSelected: () => void;
  getRenderState: () => { mode: number; lightColor: string; autoRot: boolean };
  loadOBJ:     (text: string, name: string) => void;
  loadTexture: (obj: SceneObject, url: string) => Promise<void>;
  resetCamera: () => void;
};

let CB: Callbacks | null = null;

export function wireCallbacks(cb: Callbacks) {
  CB = cb;
}

// ── Public API used by main.ts ────────────────────────────────────────────────
export const buildGUI = {
  init() {
    buildLeft();
    buildRight();
  },

  refreshScene() {
    const list = document.getElementById("scene-list");
    if (!list || !CB) return;
    const scene    = CB.getScene();
    const selected = CB.getSelected();
    list.innerHTML = "";
    for (const obj of scene) {
      const el = document.createElement("div");
      el.className = "scene-item" + (obj === selected ? " active" : "");
      el.textContent = obj.name;
      el.addEventListener("click", () => CB!.setSelected(obj));
      list.appendChild(el);
    }
    buildGUI.refreshProps();
  },

  refreshProps() {
    const panel = document.getElementById("props-panel");
    if (!panel || !CB) return;
    const selected = CB.getSelected();
    if (!selected) {
      panel.style.display = "none";
      const hint = document.getElementById("selection-hint");
      if (hint) hint.textContent = "NO SELECTION — DRAG ROTATES ALL";
      return;
    }
    panel.style.display = "";
    const hint = document.getElementById("selection-hint");
    if (hint) hint.textContent = `SELECTED: ${selected.name}`;

    function setSlider(id: string, val: number) {
      const el  = document.getElementById(id) as HTMLInputElement | null;
      const spn = document.getElementById(id + "-v") as HTMLElement | null;
      if (el)  el.value = String(val);
      if (spn) spn.textContent = val.toFixed(id === "m-shininess" ? 0 : 2);
    }

    setSlider("tx", selected.translate[0]);
    setSlider("ty", selected.translate[1]);
    setSlider("tz", selected.translate[2]);
    setSlider("rx", selected.rotate[0]);
    setSlider("ry", selected.rotate[1]);
    setSlider("rz", selected.rotate[2]);
    setSlider("sx", selected.scale[0]);
    setSlider("sy", selected.scale[1]);
    setSlider("sz", selected.scale[2]);
    setSlider("m-ambient",   selected.ambient);
    setSlider("m-diffuse",   selected.diffuse);
    setSlider("m-specular",  selected.specular);
    setSlider("m-shininess", selected.shininess);

    const col = document.getElementById("m-color") as HTMLInputElement | null;
    if (col) col.value = selected.color;

    const utex = document.getElementById("use-texture") as HTMLInputElement | null;
    if (utex) utex.checked = selected.useTexture;
  },
};

// ── Left panel ────────────────────────────────────────────────────────────────
function buildLeft() {
  const div = document.createElement("div");
  div.id = "panel-left";
  div.innerHTML = `
<div class="p-title">PIPELINE</div>

<div class="p-section">
  <div class="p-label">ADD OBJECT</div>
  <div class="btn-row">
    <button id="add-sphere">Sphere</button>
    <button id="add-cube">Cube</button>
  </div>
  <button id="btn-reset-cam" style="width:100%;margin-top:4px;font-size:10px;color:#aaa">Reset Camera View</button>
</div>

<div class="p-section">
  <div class="p-label">ADD OBJ MODEL</div>
  <input type="file" id="obj-file" accept=".obj">
</div>

<div class="p-section">
  <div class="p-label">RENDER MODE (GLOBAL)</div>
  <div class="btn-row">
    <button class="mode-btn active" data-mode="0">Phong</button>
    <button class="mode-btn" data-mode="1">Gouraud</button>
    <button class="mode-btn" data-mode="2">Normals</button>
  </div>
  <div class="btn-row">
    <button class="mode-btn" data-mode="3">Wireframe</button>
    <button class="mode-btn" data-mode="4">Depth</button>
    <button class="mode-btn" data-mode="5">Texture</button>
  </div>
  <div class="btn-row">
    <button class="mode-btn" data-mode="6">UV Coords</button>
  </div>
  <div id="mode-hint" class="p-hint">Phong: per-fragment lighting.</div>
</div>

<div class="p-section">
  <div class="p-label">GLOBAL LIGHT COLOR</div>
  <div class="color-row"><span>Light</span><input type="color" id="g-light-color" value="#ffffff"></div>
  <label class="chk-row"><input type="checkbox" id="g-auto-rot" checked> Auto-rotate light</label>
</div>

<div class="p-hint" style="margin-top:12px">
  No selection: drag rotates ALL objects<br>
  Object selected: drag rotates only that object<br>
  Scroll: zoom in/out<br>
  WASD/QE + arrows: fly camera
</div>`;
  document.body.appendChild(div);

  document.getElementById("add-sphere")!.addEventListener("click", () => CB?.addObject("sphere"));
  document.getElementById("add-cube")!.addEventListener("click",   () => CB?.addObject("cube"));
  document.getElementById("btn-reset-cam")!.addEventListener("click", () => CB?.resetCamera());

  (document.getElementById("obj-file") as HTMLInputElement).addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !CB) return;
    const text = await file.text();
    CB.loadOBJ(text, file.name.replace(/\.obj$/i, ""));
  });

  const modeHints: Record<number, string> = {
    0: "Phong: per-fragment lighting with specular.",
    1: "Gouraud: lighting computed per-vertex, interpolated.",
    2: "Normal buffer: world-space normals as RGB (R=X G=Y B=Z).",
    3: "Wireframe: real edges via barycentric coords.",
    4: "Depth: brighter = closer to camera.",
    5: "Texture: spherical UV mapping with checker pattern.",
    6: "UV Coords: U=red, V=green.",
  };

  document.querySelectorAll<HTMLButtonElement>(".mode-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      if (CB) CB.getRenderState().mode = Number(btn.dataset.mode);
      const hint = document.getElementById("mode-hint");
      if (hint) hint.textContent = modeHints[Number(btn.dataset.mode)] ?? "";
    });
  });

  (document.getElementById("g-light-color") as HTMLInputElement)
    .addEventListener("input", e => { if (CB) CB.getRenderState().lightColor = (e.target as HTMLInputElement).value; });
  (document.getElementById("g-auto-rot") as HTMLInputElement)
    .addEventListener("change", e => { if (CB) CB.getRenderState().autoRot = (e.target as HTMLInputElement).checked; });
}

// ── Right panel ───────────────────────────────────────────────────────────────
function sl(id: string, label: string, min: number, max: number, step: number, val: number) {
  return `<div class="slider-row">
    <span class="sl-label">${label}</span>
    <input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${val}">
    <span class="sl-val" id="${id}-v">${val}</span>
  </div>`;
}

function buildRight() {
  const div = document.createElement("div");
  div.id = "panel-right";
  div.innerHTML = `
<div class="p-title">SCENE</div>
<div id="scene-list"></div>
<div id="selection-hint" class="p-hint" style="margin:6px 0;color:#aaa">NO SELECTION — DRAG ROTATES ALL</div>
<button id="btn-deselect" style="width:100%;margin-bottom:4px">Deselect</button>
<button id="btn-remove"   style="width:100%;margin-bottom:8px;color:#f55">Remove</button>

<div id="props-panel" style="display:none">
  <div class="p-label">TRANSFORM</div>
  ${sl("tx", "Translate X", -10, 10, 0.1, 0)}
  ${sl("ty", "Translate Y", -10, 10, 0.1, 0)}
  ${sl("tz", "Translate Z", -10, 10, 0.1, 0)}
  ${sl("rx", "Rotate X", -3.14, 3.14, 0.01, 0)}
  ${sl("ry", "Rotate Y", -3.14, 3.14, 0.01, 0)}
  ${sl("rz", "Rotate Z", -3.14, 3.14, 0.01, 0)}
  ${sl("sx", "Scale X", 0.1, 5, 0.05, 1)}
  ${sl("sy", "Scale Y", 0.1, 5, 0.05, 1)}
  ${sl("sz", "Scale Z", 0.1, 5, 0.05, 1)}

  <div class="p-label" style="margin-top:10px">MATERIAL</div>
  ${sl("m-ambient",   "Ambient (Ka)",  0, 1,   0.01, 0.12)}
  ${sl("m-diffuse",   "Diffuse (Kd)",  0, 1,   0.01, 0.75)}
  ${sl("m-specular",  "Specular (Ks)", 0, 1,   0.01, 0.55)}
  ${sl("m-shininess", "Shininess (n)", 1, 256, 1,    48)}
  <div class="color-row" style="margin-top:6px">
    <span>Object color</span>
    <input type="color" id="m-color" value="#4a9eff">
  </div>

  <div class="p-label" style="margin-top:10px">TEXTURE (SPHERICAL UV)</div>
  <input type="file" id="tex-file" accept="image/*" style="margin-bottom:4px">
  <label class="chk-row"><input type="checkbox" id="use-texture"> Use texture</label>
</div>`;
  document.body.appendChild(div);

  document.getElementById("btn-deselect")!.addEventListener("click", () => CB?.setSelected(null));
  document.getElementById("btn-remove")!.addEventListener("click",   () => CB?.removeSelected());

  function wire(id: string, set: (v: number) => void) {
    const el  = document.getElementById(id) as HTMLInputElement | null;
    const spn = document.getElementById(id + "-v") as HTMLElement | null;
    if (!el) return;
    el.addEventListener("input", () => {
      const v = parseFloat(el.value);
      set(v);
      if (spn) spn.textContent = v.toFixed(id === "m-shininess" ? 0 : 2);
    });
  }

  wire("tx", v => { if (CB) { const s = CB.getSelected(); if (s) s.translate[0] = v; } });
  wire("ty", v => { if (CB) { const s = CB.getSelected(); if (s) s.translate[1] = v; } });
  wire("tz", v => { if (CB) { const s = CB.getSelected(); if (s) s.translate[2] = v; } });
  wire("rx", v => { if (CB) { const s = CB.getSelected(); if (s) s.rotate[0] = v; } });
  wire("ry", v => { if (CB) { const s = CB.getSelected(); if (s) s.rotate[1] = v; } });
  wire("rz", v => { if (CB) { const s = CB.getSelected(); if (s) s.rotate[2] = v; } });
  wire("sx", v => { if (CB) { const s = CB.getSelected(); if (s) s.scale[0] = v; } });
  wire("sy", v => { if (CB) { const s = CB.getSelected(); if (s) s.scale[1] = v; } });
  wire("sz", v => { if (CB) { const s = CB.getSelected(); if (s) s.scale[2] = v; } });
  wire("m-ambient",   v => { if (CB) { const s = CB.getSelected(); if (s) s.ambient   = v; } });
  wire("m-diffuse",   v => { if (CB) { const s = CB.getSelected(); if (s) s.diffuse   = v; } });
  wire("m-specular",  v => { if (CB) { const s = CB.getSelected(); if (s) s.specular  = v; } });
  wire("m-shininess", v => { if (CB) { const s = CB.getSelected(); if (s) s.shininess = v; } });

  (document.getElementById("m-color") as HTMLInputElement)
    .addEventListener("input", e => {
      if (CB) { const s = CB.getSelected(); if (s) s.color = (e.target as HTMLInputElement).value; }
    });

  (document.getElementById("tex-file") as HTMLInputElement).addEventListener("change", async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file || !CB) return;
    const s = CB.getSelected();
    if (s) await CB.loadTexture(s, URL.createObjectURL(file));
  });

  (document.getElementById("use-texture") as HTMLInputElement)
    .addEventListener("change", e => {
      if (CB) { const s = CB.getSelected(); if (s) s.useTexture = (e.target as HTMLInputElement).checked; }
    });
}
