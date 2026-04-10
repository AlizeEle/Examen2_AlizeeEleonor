/// <reference types="@webgpu/types" />

import "./style.css";
import shaderCode from "./shader.wgsl?raw";
import { Camera } from "./camera";
import { mat4 } from "./math";
import type { Vec3 } from "./math";
import { SceneObject } from "./scene";
import type { ShapeKind } from "./scene";
import { hexToRgb, buildGUI, wireCallbacks } from "./gui";

// ─── WebGPU init ─────────────────────────────────────────────────────────────
if (!navigator.gpu) throw new Error("WebGPU not supported");
const canvas  = document.querySelector("#gfx-main") as HTMLCanvasElement;
const adapter = await navigator.gpu.requestAdapter();
if (!adapter) throw new Error("No adapter");
const device  = await adapter.requestDevice();
const context = canvas.getContext("webgpu")!;
const format  = navigator.gpu.getPreferredCanvasFormat();
let depthTex: GPUTexture | null = null;

function resize() {
  canvas.width  = Math.max(1, Math.floor(window.innerWidth  * devicePixelRatio));
  canvas.height = Math.max(1, Math.floor(window.innerHeight * devicePixelRatio));
  context.configure({ device, format, alphaMode: "premultiplied" });
  depthTex?.destroy();
  depthTex = device.createTexture({
    size: [canvas.width, canvas.height],
    format: "depth24plus",
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
}
resize();
window.addEventListener("resize", resize);

// ─── STRIDE = 11 floats = 44 bytes ───────────────────────────────────────────
// layout: [px py pz  nx ny nz  u v  bx by bz]
const STRIDE = 11;

function addBarycentrics(src: Float32Array): Float32Array {
  const triCount = src.length / (8 * 3);
  const dst = new Float32Array(triCount * 3 * STRIDE);
  const B: [number, number, number][] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let t = 0; t < triCount * 3; t++) {
    const s = t * 8, d = t * STRIDE;
    dst[d+0]=src[s+0]; dst[d+1]=src[s+1]; dst[d+2]=src[s+2];
    dst[d+3]=src[s+3]; dst[d+4]=src[s+4]; dst[d+5]=src[s+5];
    dst[d+6]=src[s+6]; dst[d+7]=src[s+7];
    const b = B[t % 3];
    dst[d+8]=b[0]; dst[d+9]=b[1]; dst[d+10]=b[2];
  }
  return dst;
}

// ─── Geometry generators ─────────────────────────────────────────────────────
function generateCube(): Float32Array {
  const faces: Array<{ n: Vec3; verts: number[][] }> = [
    { n:[0,0,1],  verts:[[-1,-1,1,0,1],[1,-1,1,1,1],[1,1,1,1,0],[-1,-1,1,0,1],[1,1,1,1,0],[-1,1,1,0,0]] },
    { n:[0,0,-1], verts:[[1,-1,-1,0,1],[-1,-1,-1,1,1],[-1,1,-1,1,0],[1,-1,-1,0,1],[-1,1,-1,1,0],[1,1,-1,0,0]] },
    { n:[-1,0,0], verts:[[-1,-1,-1,0,1],[-1,-1,1,1,1],[-1,1,1,1,0],[-1,-1,-1,0,1],[-1,1,1,1,0],[-1,1,-1,0,0]] },
    { n:[1,0,0],  verts:[[1,-1,1,0,1],[1,-1,-1,1,1],[1,1,-1,1,0],[1,-1,1,0,1],[1,1,-1,1,0],[1,1,1,0,0]] },
    { n:[0,1,0],  verts:[[-1,1,1,0,1],[1,1,1,1,1],[1,1,-1,1,0],[-1,1,1,0,1],[1,1,-1,1,0],[-1,1,-1,0,0]] },
    { n:[0,-1,0], verts:[[-1,-1,-1,0,1],[1,-1,-1,1,1],[1,-1,1,1,0],[-1,-1,-1,0,1],[1,-1,1,1,0],[-1,-1,1,0,0]] },
  ];
  const d: number[] = [];
  for (const f of faces) for (const v of f.verts) d.push(v[0],v[1],v[2], ...f.n, v[3],v[4]);
  return new Float32Array(d);
}

function generateSphere(stacks: number, slices: number): Float32Array {
  const d: number[] = [];
  for (let i = 0; i < stacks; i++) {
    const p0 = (i / stacks) * Math.PI, p1 = ((i+1)/stacks) * Math.PI;
    for (let j = 0; j < slices; j++) {
      const t0 = (j / slices) * 2 * Math.PI, t1 = ((j+1)/slices) * 2 * Math.PI;
      const corners: [number,number][] = [[p0,t0],[p1,t0],[p1,t1],[p0,t1]];
      for (const idx of [0,1,2,0,2,3]) {
        const [p,t] = corners[idx];
        const sp=Math.sin(p), cp=Math.cos(p), st=Math.sin(t), ct=Math.cos(t);
        const nx=sp*ct, ny=cp, nz=sp*st;
        d.push(nx,ny,nz, nx,ny,nz, t/(2*Math.PI), p/Math.PI);
      }
    }
  }
  return new Float32Array(d);
}

// ─── OBJ Loader ──────────────────────────────────────────────────────────────
function parseOBJ(text: string): Float32Array {
  const positions: number[][] = [], normals: number[][] = [], uvs: number[][] = [], verts: number[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("v "))       { const [,x,y,z]=line.split(/\s+/).map(Number); positions.push([x,y,z]); }
    else if (line.startsWith("vn ")) { const [,x,y,z]=line.split(/\s+/).map(Number); normals.push([x,y,z]); }
    else if (line.startsWith("vt ")) { const [,u,v]=line.split(/\s+/).map(Number); uvs.push([u,v??0]); }
    else if (line.startsWith("f ")) {
      const tokens = line.slice(2).trim().split(/\s+/);
      const parsed = tokens.map(tok => {
        const p=tok.split("/"); return {pi:p[0]?parseInt(p[0])-1:-1, ti:p[1]?parseInt(p[1])-1:-1, ni:p[2]?parseInt(p[2])-1:-1};
      });
      for (let i=1; i<parsed.length-1; i++) {
        const tri=[parsed[0],parsed[i],parsed[i+1]];
        const a=positions[tri[0].pi]??[0,0,0], b=positions[tri[1].pi]??[0,0,0], c=positions[tri[2].pi]??[0,0,0];
        const ab=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], ac=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
        const fx=ab[1]*ac[2]-ab[2]*ac[1], fy=ab[2]*ac[0]-ab[0]*ac[2], fz=ab[0]*ac[1]-ab[1]*ac[0];
        const fl=Math.hypot(fx,fy,fz)||1; const fn=[fx/fl,fy/fl,fz/fl];
        for (const {pi,ti,ni} of tri) {
          const pos=positions[pi]??[0,0,0], nor=(ni>=0&&normals[ni])?normals[ni]:fn;
          const uv=(ti>=0&&uvs[ti])?uvs[ti]:[0.5+Math.atan2(nor[2],nor[0])/(2*Math.PI), 0.5-Math.asin(Math.max(-1,Math.min(1,nor[1])))/Math.PI];
          verts.push(pos[0],pos[1],pos[2], nor[0],nor[1],nor[2], uv[0],uv[1]);
        }
      }
    }
  }
  return new Float32Array(verts);
}

// ─── GPU helpers ─────────────────────────────────────────────────────────────
function makeVertexBuffer(data: Float32Array): { buf: GPUBuffer; count: number } {
  const buf = device.createBuffer({
    size: Math.max(data.byteLength, 4),
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buf, 0, data);
  return { buf, count: data.length / STRIDE };
}

// ─── GPU Pipeline (created before any SceneObject) ───────────────────────────
const shaderMod = device.createShaderModule({ code: shaderCode });

const pipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: shaderMod, entryPoint: "vs_main",
    buffers: [{
      arrayStride: STRIDE * 4,
      attributes: [
        { shaderLocation: 0, offset: 0,  format: "float32x3" },
        { shaderLocation: 1, offset: 12, format: "float32x3" },
        { shaderLocation: 2, offset: 24, format: "float32x2" },
        { shaderLocation: 3, offset: 32, format: "float32x3" },
      ],
    }],
  },
  fragment: { module: shaderMod, entryPoint: "fs_main", targets: [{ format }] },
  primitive: { topology: "triangle-list", cullMode: "back" },
  depthStencil: { format: "depth24plus", depthWriteEnabled: true, depthCompare: "less" },
});

// ─── Scene object factory ─────────────────────────────────────────────────────
function makeSceneObject(shape: ShapeKind, offset: Vec3 = [0, 0, 0]): SceneObject {
  const raw  = shape === "cube" ? generateCube() : generateSphere(64, 64);
  const data = addBarycentrics(raw);
  const { buf, count } = makeVertexBuffer(data);
  // Pass device + pipeline so the object can create its own uniform buffer & bind group
  return new SceneObject(shape, buf, count, offset, device, pipeline);
}

// ─── Scene state ──────────────────────────────────────────────────────────────
const scene: SceneObject[] = [];
let selected: SceneObject | null = null;

function setSelected(obj: SceneObject | null) {
  selected = obj;
  buildGUI.refreshScene();
  buildGUI.refreshProps();
}

const SLOTS: Vec3[] = [
  [-2, 0, 0], [ 2, 0, 0],
  [ 0, 2, 0], [ 0,-2, 0],
  [-4, 0, 0], [ 4, 0, 0],
  [-2, 2, 0], [ 2, 2, 0],
];

function addObject(shape: ShapeKind) {
  const idx = scene.length % SLOTS.length;
  const s   = SLOTS[idx];
  const obj = makeSceneObject(shape, [s[0], s[1], s[2]]);
  scene.push(obj);
  buildGUI.refreshScene();
}

function removeSelected() {
  if (!selected) return;
  const idx = scene.indexOf(selected);
  if (idx !== -1) { scene[idx].destroy(); scene.splice(idx, 1); }
  selected = null;
  buildGUI.refreshScene();
  buildGUI.refreshProps();
}

function loadOBJIntoScene(text: string, name: string) {
  const raw = parseOBJ(text);
  if (raw.length === 0) { alert("OBJ parse error or empty mesh"); return; }
  const data = addBarycentrics(raw);
  const { buf, count } = makeVertexBuffer(data);
  let minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
  for (let i=0;i<raw.length;i+=8) {
    minX=Math.min(minX,raw[i]); maxX=Math.max(maxX,raw[i]);
    minY=Math.min(minY,raw[i+1]); maxY=Math.max(maxY,raw[i+1]);
    minZ=Math.min(minZ,raw[i+2]); maxZ=Math.max(maxZ,raw[i+2]);
  }
  const cx=(minX+maxX)/2, cy=(minY+maxY)/2, cz=(minZ+maxZ)/2;
  const sc=3.5/(Math.max(maxX-minX,maxY-minY,maxZ-minZ)||1);
  const obj = new SceneObject("obj", buf, count, [0,0,0], device, pipeline);
  obj.name = `${obj.id}. ${name}`;
  obj.scale = [sc,sc,sc];
  obj.translate = [-cx*sc,-cy*sc,-cz*sc];
  scene.push(obj);
  buildGUI.refreshScene();
  setSelected(obj);
}

async function loadTexture(obj: SceneObject, url: string) {
  const img = new Image(); img.src = url; await img.decode();
  const bitmap = await createImageBitmap(img);
  const tex = device.createTexture({
    size: [bitmap.width, bitmap.height], format: "rgba8unorm",
    usage: GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT,
  });
  device.queue.copyExternalImageToTexture({ source: bitmap }, { texture: tex }, [bitmap.width, bitmap.height]);
  obj.texture = tex;
  obj.sampler = device.createSampler({ magFilter:"linear", minFilter:"linear" });
  obj.useTexture = true;
  const cb = document.getElementById("use-texture") as HTMLInputElement|null;
  if (cb) cb.checked = true;
}

// ─── Camera ───────────────────────────────────────────────────────────────────
const camera = new Camera();
camera.position = [0, 0, 8];

function resetCamera() {
  camera.position = [0, 0, 8];
  camera.yaw   = -Math.PI / 2;
  camera.pitch = 0;
}

// ─── Render state ─────────────────────────────────────────────────────────────
const renderState = {
  mode: 0,
  lightColor: "#ffffff",
  autoRot: true,
  lightPos: [3.0, 4.0, 3.0] as Vec3,
};

// ─── Wire GUI callbacks ───────────────────────────────────────────────────────
wireCallbacks({
  getScene:       () => scene,
  getSelected:    () => selected,
  setSelected,
  addObject,
  removeSelected,
  getRenderState: () => renderState,
  loadOBJ:        loadOBJIntoScene,
  loadTexture,
  resetCamera,
});

// ─── Input ────────────────────────────────────────────────────────────────────
const keys = new Set<string>();
window.addEventListener("keydown", e => keys.add(e.key));
window.addEventListener("keyup",   e => keys.delete(e.key));

// ─── Arcball ──────────────────────────────────────────────────────────────────
let arcDragging = false;
let arcLast: [number,number,number] | null = null;

function projectArcball(mx: number, my: number): [number,number,number] {
  const dim = Math.min(canvas.width, canvas.height);
  const x = (2*mx - canvas.width) / dim, y = (canvas.height - 2*my) / dim;
  const r2 = x*x + y*y;
  if (r2 <= 1) return [x, y, Math.sqrt(1-r2)];
  const r = Math.sqrt(r2); return [x/r, y/r, 0];
}
function cross3(a:[number,number,number], b:[number,number,number]):[number,number,number] {
  return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
}
function dot3(a:[number,number,number], b:[number,number,number]) { return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]; }
function norm3(v:[number,number,number]):[number,number,number] { const l=Math.hypot(...v)||1; return [v[0]/l,v[1]/l,v[2]/l]; }
function axisAngleMat(axis:[number,number,number], angle:number): Float32Array {
  const [x,y,z]=norm3(axis), c=Math.cos(angle), s=Math.sin(angle), t=1-c;
  return new Float32Array([t*x*x+c,t*x*y+s*z,t*x*z-s*y,0, t*x*y-s*z,t*y*y+c,t*y*z+s*x,0, t*x*z+s*y,t*y*z-s*x,t*z*z+c,0, 0,0,0,1]);
}

canvas.addEventListener("mousedown", (e) => {
  if (e.button !== 0) return;
  arcDragging = true;
  const rect = canvas.getBoundingClientRect();
  arcLast = projectArcball(
    (e.clientX-rect.left)*(canvas.width/rect.width),
    (e.clientY-rect.top)*(canvas.height/rect.height),
  );
});
window.addEventListener("mouseup", () => { arcDragging=false; arcLast=null; });
window.addEventListener("mousemove", (e) => {
  if (!arcDragging || !arcLast) return;
  const rect = canvas.getBoundingClientRect();
  const cur = projectArcball(
    (e.clientX-rect.left)*(canvas.width/rect.width),
    (e.clientY-rect.top)*(canvas.height/rect.height),
  );
  const axis = cross3(arcLast, cur);
  if (Math.hypot(...axis) > 1e-6) {
    const angle = Math.acos(Math.max(-1, Math.min(1, dot3(arcLast,cur)))) * 2;
    const rot = axisAngleMat(axis, angle);
    if (selected) {
      selected.arcball = mat4.multiply(rot, selected.arcball);
    } else {
      for (const obj of scene) {
        obj.arcball = mat4.multiply(rot, obj.arcball);
      }
    }
  }
  arcLast = cur;
});
canvas.addEventListener("contextmenu", e => e.preventDefault());
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const fwd = camera.getForward(), spd = e.deltaY * 0.02;
  camera.position = [
    camera.position[0]-fwd[0]*spd,
    camera.position[1]-fwd[1]*spd,
    camera.position[2]-fwd[2]*spd,
  ];
}, { passive: false });

// ─── Render loop ──────────────────────────────────────────────────────────────
let lastTime = performance.now();
const startTime = performance.now();

function frame(now: number) {
  const dt = Math.min(0.033, (now-lastTime)/1000); lastTime = now;
  const t  = (now-startTime)/1000;

  camera.update(keys, dt);

  const proj = mat4.perspective(Math.PI/3, canvas.width/canvas.height, 0.1, 200);
  const view = camera.getViewMatrix();

  // Compute light position
  let [lx, ly, lz] = renderState.lightPos;
  if (renderState.autoRot) { lx=Math.cos(t*0.8)*4.5; lz=Math.sin(t*0.8)*4.5; ly=4.0; }
  const lightPos: [number,number,number] = [lx, ly, lz];
  const lightColor = hexToRgb(renderState.lightColor) as [number,number,number];

  // ── Upload each object's uniforms into its OWN buffer BEFORE the render pass
  // This is the key fix: all writeBuffer calls happen before beginRenderPass,
  // so there is no aliasing between objects.
  for (const obj of scene) {
    obj.uploadUniforms(
      device,
      view,
      proj,
      camera.position,
      lightPos,
      lightColor,
      renderState.mode,
      t,
    );
  }

  // ── Record render pass
  const encoder = device.createCommandEncoder();
  const clearColor = renderState.mode === 3
    ? { r:1, g:1, b:1, a:1 }
    : { r:0.05, g:0.05, b:0.08, a:1 };

  const pass = encoder.beginRenderPass({
    colorAttachments: [{
      view: context.getCurrentTexture().createView(),
      clearValue: clearColor,
      loadOp: "clear",
      storeOp: "store",
    }],
    depthStencilAttachment: {
      view: depthTex!.createView(),
      depthClearValue: 1,
      depthLoadOp: "clear",
      depthStoreOp: "store",
    },
  });

  pass.setPipeline(pipeline);

  // Each object binds its OWN bind group → its own uniform buffer → correct data
  for (const obj of scene) {
    pass.setBindGroup(0, obj.bindGroup);
    pass.setVertexBuffer(0, obj.buf);
    pass.draw(obj.count);
  }

  pass.end();
  device.queue.submit([encoder.finish()]);
  requestAnimationFrame(frame);
}

// ─── Init ─────────────────────────────────────────────────────────────────────
buildGUI.init();

scene.push(makeSceneObject("sphere", [-2, 0, 0]));
scene.push(makeSceneObject("cube",   [ 2, 0, 0]));
buildGUI.refreshScene();

requestAnimationFrame(frame);
