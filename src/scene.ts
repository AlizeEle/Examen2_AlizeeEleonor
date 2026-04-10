import { mat4 } from "./math";
import type { Vec3, Mat4 } from "./math";

export type ShapeKind = "cube" | "sphere" | "obj";

let idCounter = 1;

export class SceneObject {
  id: number;
  name: string;
  shape: ShapeKind;

  translate: Vec3 = [0, 0, 0];
  rotate:    Vec3 = [0, 0, 0];
  scale:     Vec3 = [1, 1, 1];

  arcball: Float32Array = mat4.identity();

  ambient   = 0.12;
  diffuse   = 0.75;
  specular  = 0.55;
  shininess = 48;
  color     = "#4a9eff";

  useTexture = false;
  texture:  GPUTexture | null = null;
  sampler:  GPUSampler | null = null;

  buf:   GPUBuffer;
  count: number;

  // ── Per-object GPU resources ──────────────────────────────────────────────
  // Each object gets its own uniform buffer + bind group so multiple objects
  // can be drawn in one render pass without overwriting each other's data.
  uniformBuf: GPUBuffer;
  bindGroup:  GPUBindGroup;

  private uAB  = new ArrayBuffer(288);
  private uF   = new Float32Array(this.uAB);
  private uU32 = new Uint32Array(this.uAB);

  constructor(
    shape: ShapeKind,
    buf: GPUBuffer,
    count: number,
    offset: Vec3 = [0, 0, 0],
    device: GPUDevice,
    pipeline: GPURenderPipeline,
  ) {
    this.id    = idCounter++;
    this.name  = `${this.id}. ${shape.charAt(0).toUpperCase() + shape.slice(1)}`;
    this.shape = shape;
    this.buf   = buf;
    this.count = count;
    this.translate = [...offset];

    // Create per-object uniform buffer
    this.uniformBuf = device.createBuffer({
      size: 288,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create per-object bind group
    this.bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [{ binding: 0, resource: { buffer: this.uniformBuf } }],
    });
  }

  getModelMatrix(): Mat4 {
    const T     = mat4.translation(this.translate);
    const Rx    = mat4.rotationX(this.rotate[0]);
    const Ry    = mat4.rotationY(this.rotate[1]);
    const Rz    = mat4.rotationZ(this.rotate[2]);
    const S     = mat4.scaling(this.scale[0], this.scale[1], this.scale[2]);
    const euler = mat4.multiply(mat4.multiply(Rx, Ry), Rz);
    const RS    = mat4.multiply(mat4.multiply(this.arcball, euler), S);
    return mat4.multiply(T, RS);
  }

  // Write this object's uniforms into its own buffer
  uploadUniforms(
    device: GPUDevice,
    view: Float32Array,
    proj: Float32Array,
    camPos: Vec3,
    lightPos: [number, number, number],
    lightColor: [number, number, number],
    renderMode: number,
    t: number,
  ) {
    const model = this.getModelMatrix();
    const normM = mat4.normalMatrix(model);
    const mvp   = mat4.multiply(mat4.multiply(proj, view), model);

    const [or, og, ob] = hexToRgb(this.color);
    const [lr, lg, lb] = lightColor;
    const [lx, ly, lz] = lightPos;

    this.uF.set(mvp,   0);
    this.uF.set(model, 16);
    this.uF.set(normM, 32);

    this.uF[48] = lx;  this.uF[49] = ly;  this.uF[50] = lz;  this.uF[51] = 0;
    this.uF[52] = lr;  this.uF[53] = lg;  this.uF[54] = lb;  this.uF[55] = 0;
    this.uF[56] = this.ambient;
    this.uF[57] = this.diffuse;
    this.uF[58] = this.specular;
    this.uF[59] = this.shininess;
    this.uF[60] = camPos[0]; this.uF[61] = camPos[1]; this.uF[62] = camPos[2];
    this.uU32[63] = renderMode;
    this.uF[64] = or; this.uF[65] = og; this.uF[66] = ob;
    this.uF[67] = t;

    device.queue.writeBuffer(this.uniformBuf, 0, this.uAB);
  }

  destroy() {
    this.buf.destroy();
    this.uniformBuf.destroy();
    this.texture?.destroy();
  }
}

// Inline helper (avoids circular import with gui.ts)
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}
