struct Uniforms {
  mvp        : mat4x4<f32>,
  model      : mat4x4<f32>,
  normalMat  : mat4x4<f32>,
  lightPos   : vec3<f32>,  _p0 : f32,
  lightColor : vec3<f32>,  _p1 : f32,
  ambient    : f32, diffuse : f32, specular : f32, shininess : f32,
  camPos     : vec3<f32>,
  mode       : u32,
  objectColor: vec3<f32>,
  time       : f32,
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSIn {
  @location(0) pos  : vec3<f32>,
  @location(1) nor  : vec3<f32>,
  @location(2) uv   : vec2<f32>,
  @location(3) bary : vec3<f32>,   // barycentric coords (0,0,1) (0,1,0) (1,0,0)
};
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) wp   : vec3<f32>,
  @location(1) wn   : vec3<f32>,
  @location(2) uv   : vec2<f32>,
  @location(3) gc   : vec3<f32>,
  @location(4) bary : vec3<f32>,
};

// ── Lighting ─────────────────────────────────────────────────────────────────

fn phong(N:vec3<f32>, L:vec3<f32>, V:vec3<f32>, col:vec3<f32>) -> vec3<f32> {
  let amb  = u.ambient  * u.lightColor * col;
  let nd   = max(dot(N,L), 0.0);
  let dif  = u.diffuse  * nd * u.lightColor * col;
  var spec = vec3<f32>(0.0);
  if nd > 0.0 {
    let R = reflect(-L, N);
    spec = u.specular * pow(max(dot(R,V),0.0), u.shininess) * u.lightColor;
  }
  return amb + dif + spec;
}

fn blinn(N:vec3<f32>, L:vec3<f32>, V:vec3<f32>, col:vec3<f32>) -> vec3<f32> {
  let amb  = u.ambient  * u.lightColor * col;
  let nd   = max(dot(N,L), 0.0);
  let dif  = u.diffuse  * nd * u.lightColor * col;
  var spec = vec3<f32>(0.0);
  if nd > 0.0 {
    let H = normalize(L+V);
    spec = u.specular * pow(max(dot(N,H),0.0), u.shininess) * u.lightColor;
  }
  return amb + dif + spec;
}

// ── Vertex ────────────────────────────────────────────────────────────────────

@vertex fn vs_main(i: VSIn) -> VSOut {
  var o: VSOut;
  let wp  = (u.model    * vec4<f32>(i.pos,1.0)).xyz;
  let wn  = normalize((u.normalMat * vec4<f32>(i.nor,0.0)).xyz);
  o.clip  = u.mvp * vec4<f32>(i.pos,1.0);
  o.wp    = wp;
  o.wn    = wn;
  o.uv    = i.uv;
  o.bary  = i.bary;
  if u.mode == 1u {
    let L = normalize(u.lightPos - wp);
    let V = normalize(u.camPos   - wp);
    o.gc  = blinn(wn, L, V, u.objectColor);
  } else {
    o.gc = vec3<f32>(0.0);
  }
  return o;
}

// ── Fragment ──────────────────────────────────────────────────────────────────

@fragment fn fs_main(i: VSOut) -> @location(0) vec4<f32> {
  let N = normalize(i.wn);
  var c : vec3<f32>;

  switch u.mode {
    // 0 — Phong
    case 0u {
      let L = normalize(u.lightPos - i.wp);
      let V = normalize(u.camPos   - i.wp);
      c = phong(N, L, V, u.objectColor);
    }
    // 1 — Gouraud
    case 1u { c = i.gc; }
    // 2 — Normal buffer
    case 2u { c = N * 0.5 + 0.5; }
    // 3 — Wireframe using barycentric coordinates
    case 3u {
      // Find minimum barycentric coordinate — this tells us proximity to an edge
      let b     = i.bary;
      let bMin  = min(b.x, min(b.y, b.z));
      // Use screen-space derivatives for consistent line width regardless of zoom
      let bMinDdx = dpdx(bMin);
      let bMinDdy = dpdy(bMin);
      let width   = sqrt(bMinDdx*bMinDdx + bMinDdy*bMinDdy);
      // Smooth step: 0.0 = on edge, 1.0 = face interior
      let edge = smoothstep(0.0, width * 1.5, bMin);
      // Edges = black (0), faces = white (1)
      c = vec3<f32>(edge);
    }
    // 4 — Depth
    case 4u {
      let ndcZ = i.clip.z / i.clip.w;
      c = vec3<f32>(clamp(1.0 - pow(ndcZ, 2.5), 0.0, 1.0));
    }
    // 5 — Texture (spherical UV checker + Phong lighting)
    case 5u {
      let cx      = floor(i.uv.x * 8.0);
      let cy      = floor(i.uv.y * 8.0);
      let checker = (cx + cy) % 2.0;
      let texCol  = mix(u.objectColor, vec3<f32>(1.0), checker * 0.55);
      let L = normalize(u.lightPos - i.wp);
      let V = normalize(u.camPos   - i.wp);
      c = phong(N, L, V, texCol);
    }
    // 6 — UV Coords
    default { c = vec3<f32>(i.uv.x, i.uv.y, 0.5); }
  }
  return vec4<f32>(c, 1.0);
}
