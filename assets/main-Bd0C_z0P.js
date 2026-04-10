(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const i of document.querySelectorAll('link[rel="modulepreload"]'))e(i);new MutationObserver(i=>{for(const r of i)if(r.type==="childList")for(const s of r.addedNodes)s.tagName==="LINK"&&s.rel==="modulepreload"&&e(s)}).observe(document,{childList:!0,subtree:!0});function o(i){const r={};return i.integrity&&(r.integrity=i.integrity),i.referrerPolicy&&(r.referrerPolicy=i.referrerPolicy),i.crossOrigin==="use-credentials"?r.credentials="include":i.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function e(i){if(i.ep)return;i.ep=!0;const r=o(i);fetch(i.href,r)}})();const ct=`struct Uniforms {
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
`,g={add(n,t){return[n[0]+t[0],n[1]+t[1],n[2]+t[2]]},sub(n,t){return[n[0]-t[0],n[1]-t[1],n[2]-t[2]]},scale(n,t){return[n[0]*t,n[1]*t,n[2]*t]},dot(n,t){return n[0]*t[0]+n[1]*t[1]+n[2]*t[2]},cross(n,t){return[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]]},normalize(n){const t=Math.hypot(n[0],n[1],n[2])||1;return[n[0]/t,n[1]/t,n[2]/t]}},h={identity(){const n=new Float32Array(16);return n[0]=1,n[5]=1,n[10]=1,n[15]=1,n},multiply(n,t){const o=new Float32Array(16);for(let e=0;e<4;e++)for(let i=0;i<4;i++)o[e*4+i]=n[0+i]*t[e*4+0]+n[4+i]*t[e*4+1]+n[8+i]*t[e*4+2]+n[12+i]*t[e*4+3];return o},translation(n){const t=h.identity();return t[12]=n[0],t[13]=n[1],t[14]=n[2],t},transpose(n){const t=new Float32Array(16);for(let o=0;o<4;o++)for(let e=0;e<4;e++)t[e*4+o]=n[o*4+e];return t},invert(n){const t=new Float32Array(16),o=n[0],e=n[1],i=n[2],r=n[3],s=n[4],c=n[5],d=n[6],l=n[7],u=n[8],f=n[9],p=n[10],v=n[11],w=n[12],m=n[13],y=n[14],b=n[15],L=o*c-e*s,S=o*d-i*s,A=o*l-r*s,N=e*d-i*c,T=e*l-r*c,F=i*l-r*d,R=u*m-f*w,B=u*y-p*w,z=u*b-v*w,$=f*y-p*m,G=f*b-v*m,j=p*b-v*y;let M=L*j-S*G+A*$+N*z-T*B+F*R;return M?(M=1/M,t[0]=(c*j-d*G+l*$)*M,t[1]=(d*z-s*j-l*B)*M,t[2]=(s*G-c*z+l*R)*M,t[3]=(c*B-s*$-d*R)*M,t[4]=(i*G-e*j-r*$)*M,t[5]=(o*j-i*z+r*B)*M,t[6]=(e*z-o*G-r*R)*M,t[7]=(o*$-e*B+i*R)*M,t[8]=(m*F-y*T+b*N)*M,t[9]=(y*A-w*F-b*S)*M,t[10]=(w*T-m*A+b*L)*M,t[11]=(m*S-w*N-y*L)*M,t[12]=(p*T-f*F-v*N)*M,t[13]=(u*F-p*A+v*S)*M,t[14]=(f*A-u*T-v*L)*M,t[15]=(u*N-f*S+p*L)*M,t):h.identity()},normalMatrix(n){return h.transpose(h.invert(n))},scaling(n,t,o){const e=h.identity();return e[0]=n,e[5]=t,e[10]=o,e},rotationX(n){const t=Math.cos(n),o=Math.sin(n),e=h.identity();return e[5]=t,e[6]=o,e[9]=-o,e[10]=t,e},rotationY(n){const t=Math.cos(n),o=Math.sin(n),e=h.identity();return e[0]=t,e[2]=o,e[8]=-o,e[10]=t,e},rotationZ(n){const t=Math.cos(n),o=Math.sin(n),e=h.identity();return e[0]=t,e[1]=o,e[4]=-o,e[5]=t,e},perspective(n,t,o,e){const i=1/Math.tan(n/2),r=new Float32Array(16);return r[0]=i/t,r[5]=i,r[10]=e/(o-e),r[11]=-1,r[14]=e*o/(o-e),r},lookAt(n,t,o){const e=g.normalize(g.sub(n,t)),i=g.normalize(g.cross(o,e)),r=g.cross(e,i),s=new Float32Array(16);return s[0]=i[0],s[1]=r[0],s[2]=e[0],s[3]=0,s[4]=i[1],s[5]=r[1],s[6]=e[1],s[7]=0,s[8]=i[2],s[9]=r[2],s[10]=e[2],s[11]=0,s[12]=-g.dot(i,n),s[13]=-g.dot(r,n),s[14]=-g.dot(e,n),s[15]=1,s}};class lt{position=[0,.8,6];yaw=-Math.PI/2;pitch=0;moveSpeed=3.5;turnSpeed=1.9;clampPitch(){const t=Math.PI/2-.01;this.pitch>t&&(this.pitch=t),this.pitch<-t&&(this.pitch=-t)}getForward(){const t=Math.cos(this.pitch);return g.normalize([Math.cos(this.yaw)*t,Math.sin(this.pitch),Math.sin(this.yaw)*t])}getViewMatrix(){const t=this.getForward(),o=g.add(this.position,t);return h.lookAt(this.position,o,[0,1,0])}update(t,o){t.has("ArrowLeft")&&(this.yaw-=this.turnSpeed*o),t.has("ArrowRight")&&(this.yaw+=this.turnSpeed*o),t.has("ArrowUp")&&(this.pitch+=this.turnSpeed*o),t.has("ArrowDown")&&(this.pitch-=this.turnSpeed*o),this.clampPitch();const e=this.getForward(),i=g.normalize(g.cross(e,[0,1,0])),r=[0,1,0],s=this.moveSpeed*o;t.has("w")&&(this.position=g.add(this.position,g.scale(e,s))),t.has("s")&&(this.position=g.add(this.position,g.scale(e,-s))),t.has("a")&&(this.position=g.add(this.position,g.scale(i,-s))),t.has("d")&&(this.position=g.add(this.position,g.scale(i,s))),t.has("q")&&(this.position=g.add(this.position,g.scale(r,-s))),t.has("e")&&(this.position=g.add(this.position,g.scale(r,s)))}}let dt=1;class K{id;name;shape;translate=[0,0,0];rotate=[0,0,0];scale=[1,1,1];arcball=h.identity();ambient=.12;diffuse=.75;specular=.55;shininess=48;color="#4a9eff";useTexture=!1;texture=null;sampler=null;buf;count;uniformBuf;bindGroup;uAB=new ArrayBuffer(288);uF=new Float32Array(this.uAB);uU32=new Uint32Array(this.uAB);constructor(t,o,e,i=[0,0,0],r,s){this.id=dt++,this.name=`${this.id}. ${t.charAt(0).toUpperCase()+t.slice(1)}`,this.shape=t,this.buf=o,this.count=e,this.translate=[...i],this.uniformBuf=r.createBuffer({size:288,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),this.bindGroup=r.createBindGroup({layout:s.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.uniformBuf}}]})}getModelMatrix(){const t=h.translation(this.translate),o=h.rotationX(this.rotate[0]),e=h.rotationY(this.rotate[1]),i=h.rotationZ(this.rotate[2]),r=h.scaling(this.scale[0],this.scale[1],this.scale[2]),s=h.multiply(h.multiply(o,e),i),c=h.multiply(h.multiply(this.arcball,s),r);return h.multiply(t,c)}uploadUniforms(t,o,e,i,r,s,c,d){const l=this.getModelMatrix(),u=h.normalMatrix(l),f=h.multiply(h.multiply(e,o),l),[p,v,w]=ut(this.color),[m,y,b]=s,[L,S,A]=r;this.uF.set(f,0),this.uF.set(l,16),this.uF.set(u,32),this.uF[48]=L,this.uF[49]=S,this.uF[50]=A,this.uF[51]=0,this.uF[52]=m,this.uF[53]=y,this.uF[54]=b,this.uF[55]=0,this.uF[56]=this.ambient,this.uF[57]=this.diffuse,this.uF[58]=this.specular,this.uF[59]=this.shininess,this.uF[60]=i[0],this.uF[61]=i[1],this.uF[62]=i[2],this.uU32[63]=c,this.uF[64]=p,this.uF[65]=v,this.uF[66]=w,this.uF[67]=d,t.queue.writeBuffer(this.uniformBuf,0,this.uAB)}destroy(){this.buf.destroy(),this.uniformBuf.destroy(),this.texture?.destroy()}}function ut(n){const t=parseInt(n.slice(1),16);return[(t>>16&255)/255,(t>>8&255)/255,(t&255)/255]}function ft(n){const t=parseInt(n.slice(1),16);return[(t>>16&255)/255,(t>>8&255)/255,(t&255)/255]}let a=null;function ht(n){a=n}const O={init(){pt(),mt()},refreshScene(){const n=document.getElementById("scene-list");if(!n||!a)return;const t=a.getScene(),o=a.getSelected();n.innerHTML="";for(const e of t){const i=document.createElement("div");i.className="scene-item"+(e===o?" active":""),i.textContent=e.name,i.addEventListener("click",()=>a.setSelected(e)),n.appendChild(i)}O.refreshProps()},refreshProps(){const n=document.getElementById("props-panel");if(!n||!a)return;const t=a.getSelected();if(!t){n.style.display="none";const s=document.getElementById("selection-hint");s&&(s.textContent="NO SELECTION — DRAG ROTATES ALL");return}n.style.display="";const o=document.getElementById("selection-hint");o&&(o.textContent=`SELECTED: ${t.name}`);function e(s,c){const d=document.getElementById(s),l=document.getElementById(s+"-v");d&&(d.value=String(c)),l&&(l.textContent=c.toFixed(s==="m-shininess"?0:2))}e("tx",t.translate[0]),e("ty",t.translate[1]),e("tz",t.translate[2]),e("rx",t.rotate[0]),e("ry",t.rotate[1]),e("rz",t.rotate[2]),e("sx",t.scale[0]),e("sy",t.scale[1]),e("sz",t.scale[2]),e("m-ambient",t.ambient),e("m-diffuse",t.diffuse),e("m-specular",t.specular),e("m-shininess",t.shininess);const i=document.getElementById("m-color");i&&(i.value=t.color);const r=document.getElementById("use-texture");r&&(r.checked=t.useTexture)}};function pt(){const n=document.createElement("div");n.id="panel-left",n.innerHTML=`
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
</div>`,document.body.appendChild(n),document.getElementById("add-sphere").addEventListener("click",()=>a?.addObject("sphere")),document.getElementById("add-cube").addEventListener("click",()=>a?.addObject("cube")),document.getElementById("btn-reset-cam").addEventListener("click",()=>a?.resetCamera()),document.getElementById("obj-file").addEventListener("change",async o=>{const e=o.target.files?.[0];if(!e||!a)return;const i=await e.text();a.loadOBJ(i,e.name.replace(/\.obj$/i,""))});const t={0:"Phong: per-fragment lighting with specular.",1:"Gouraud: lighting computed per-vertex, interpolated.",2:"Normal buffer: world-space normals as RGB (R=X G=Y B=Z).",3:"Wireframe: real edges via barycentric coords.",4:"Depth: brighter = closer to camera.",5:"Texture: spherical UV mapping with checker pattern.",6:"UV Coords: U=red, V=green."};document.querySelectorAll(".mode-btn").forEach(o=>{o.addEventListener("click",()=>{document.querySelectorAll(".mode-btn").forEach(i=>i.classList.remove("active")),o.classList.add("active"),a&&(a.getRenderState().mode=Number(o.dataset.mode));const e=document.getElementById("mode-hint");e&&(e.textContent=t[Number(o.dataset.mode)]??"")})}),document.getElementById("g-light-color").addEventListener("input",o=>{a&&(a.getRenderState().lightColor=o.target.value)}),document.getElementById("g-auto-rot").addEventListener("change",o=>{a&&(a.getRenderState().autoRot=o.target.checked)})}function I(n,t,o,e,i,r){return`<div class="slider-row">
    <span class="sl-label">${t}</span>
    <input type="range" id="${n}" min="${o}" max="${e}" step="${i}" value="${r}">
    <span class="sl-val" id="${n}-v">${r}</span>
  </div>`}function mt(){const n=document.createElement("div");n.id="panel-right",n.innerHTML=`
<div class="p-title">SCENE</div>
<div id="scene-list"></div>
<div id="selection-hint" class="p-hint" style="margin:6px 0;color:#aaa">NO SELECTION — DRAG ROTATES ALL</div>
<button id="btn-deselect" style="width:100%;margin-bottom:4px">Deselect</button>
<button id="btn-remove"   style="width:100%;margin-bottom:8px;color:#f55">Remove</button>

<div id="props-panel" style="display:none">
  <div class="p-label">TRANSFORM</div>
  ${I("tx","Translate X",-10,10,.1,0)}
  ${I("ty","Translate Y",-10,10,.1,0)}
  ${I("tz","Translate Z",-10,10,.1,0)}
  ${I("rx","Rotate X",-3.14,3.14,.01,0)}
  ${I("ry","Rotate Y",-3.14,3.14,.01,0)}
  ${I("rz","Rotate Z",-3.14,3.14,.01,0)}
  ${I("sx","Scale X",.1,5,.05,1)}
  ${I("sy","Scale Y",.1,5,.05,1)}
  ${I("sz","Scale Z",.1,5,.05,1)}

  <div class="p-label" style="margin-top:10px">MATERIAL</div>
  ${I("m-ambient","Ambient (Ka)",0,1,.01,.12)}
  ${I("m-diffuse","Diffuse (Kd)",0,1,.01,.75)}
  ${I("m-specular","Specular (Ks)",0,1,.01,.55)}
  ${I("m-shininess","Shininess (n)",1,256,1,48)}
  <div class="color-row" style="margin-top:6px">
    <span>Object color</span>
    <input type="color" id="m-color" value="#4a9eff">
  </div>

  <div class="p-label" style="margin-top:10px">TEXTURE (SPHERICAL UV)</div>
  <input type="file" id="tex-file" accept="image/*" style="margin-bottom:4px">
  <label class="chk-row"><input type="checkbox" id="use-texture"> Use texture</label>
</div>`,document.body.appendChild(n),document.getElementById("btn-deselect").addEventListener("click",()=>a?.setSelected(null)),document.getElementById("btn-remove").addEventListener("click",()=>a?.removeSelected());function t(o,e){const i=document.getElementById(o),r=document.getElementById(o+"-v");i&&i.addEventListener("input",()=>{const s=parseFloat(i.value);e(s),r&&(r.textContent=s.toFixed(o==="m-shininess"?0:2))})}t("tx",o=>{if(a){const e=a.getSelected();e&&(e.translate[0]=o)}}),t("ty",o=>{if(a){const e=a.getSelected();e&&(e.translate[1]=o)}}),t("tz",o=>{if(a){const e=a.getSelected();e&&(e.translate[2]=o)}}),t("rx",o=>{if(a){const e=a.getSelected();e&&(e.rotate[0]=o)}}),t("ry",o=>{if(a){const e=a.getSelected();e&&(e.rotate[1]=o)}}),t("rz",o=>{if(a){const e=a.getSelected();e&&(e.rotate[2]=o)}}),t("sx",o=>{if(a){const e=a.getSelected();e&&(e.scale[0]=o)}}),t("sy",o=>{if(a){const e=a.getSelected();e&&(e.scale[1]=o)}}),t("sz",o=>{if(a){const e=a.getSelected();e&&(e.scale[2]=o)}}),t("m-ambient",o=>{if(a){const e=a.getSelected();e&&(e.ambient=o)}}),t("m-diffuse",o=>{if(a){const e=a.getSelected();e&&(e.diffuse=o)}}),t("m-specular",o=>{if(a){const e=a.getSelected();e&&(e.specular=o)}}),t("m-shininess",o=>{if(a){const e=a.getSelected();e&&(e.shininess=o)}}),document.getElementById("m-color").addEventListener("input",o=>{if(a){const e=a.getSelected();e&&(e.color=o.target.value)}}),document.getElementById("tex-file").addEventListener("change",async o=>{const e=o.target.files?.[0];if(!e||!a)return;const i=a.getSelected();i&&await a.loadTexture(i,URL.createObjectURL(e))}),document.getElementById("use-texture").addEventListener("change",o=>{if(a){const e=a.getSelected();e&&(e.useTexture=o.target.checked)}})}if(!navigator.gpu)throw new Error("WebGPU not supported");const x=document.querySelector("#gfx-main"),Q=await navigator.gpu.requestAdapter();if(!Q)throw new Error("No adapter");const E=await Q.requestDevice(),tt=x.getContext("webgpu"),et=navigator.gpu.getPreferredCanvasFormat();let q=null;function nt(){x.width=Math.max(1,Math.floor(window.innerWidth*devicePixelRatio)),x.height=Math.max(1,Math.floor(window.innerHeight*devicePixelRatio)),tt.configure({device:E,format:et,alphaMode:"premultiplied"}),q?.destroy(),q=E.createTexture({size:[x.width,x.height],format:"depth24plus",usage:GPUTextureUsage.RENDER_ATTACHMENT})}nt();window.addEventListener("resize",nt);const k=11;function ot(n){const t=n.length/24,o=new Float32Array(t*3*k),e=[[1,0,0],[0,1,0],[0,0,1]];for(let i=0;i<t*3;i++){const r=i*8,s=i*k;o[s+0]=n[r+0],o[s+1]=n[r+1],o[s+2]=n[r+2],o[s+3]=n[r+3],o[s+4]=n[r+4],o[s+5]=n[r+5],o[s+6]=n[r+6],o[s+7]=n[r+7];const c=e[i%3];o[s+8]=c[0],o[s+9]=c[1],o[s+10]=c[2]}return o}function gt(){const n=[{n:[0,0,1],verts:[[-1,-1,1,0,1],[1,-1,1,1,1],[1,1,1,1,0],[-1,-1,1,0,1],[1,1,1,1,0],[-1,1,1,0,0]]},{n:[0,0,-1],verts:[[1,-1,-1,0,1],[-1,-1,-1,1,1],[-1,1,-1,1,0],[1,-1,-1,0,1],[-1,1,-1,1,0],[1,1,-1,0,0]]},{n:[-1,0,0],verts:[[-1,-1,-1,0,1],[-1,-1,1,1,1],[-1,1,1,1,0],[-1,-1,-1,0,1],[-1,1,1,1,0],[-1,1,-1,0,0]]},{n:[1,0,0],verts:[[1,-1,1,0,1],[1,-1,-1,1,1],[1,1,-1,1,0],[1,-1,1,0,1],[1,1,-1,1,0],[1,1,1,0,0]]},{n:[0,1,0],verts:[[-1,1,1,0,1],[1,1,1,1,1],[1,1,-1,1,0],[-1,1,1,0,1],[1,1,-1,1,0],[-1,1,-1,0,0]]},{n:[0,-1,0],verts:[[-1,-1,-1,0,1],[1,-1,-1,1,1],[1,-1,1,1,0],[-1,-1,-1,0,1],[1,-1,1,1,0],[-1,-1,1,0,0]]}],t=[];for(const o of n)for(const e of o.verts)t.push(e[0],e[1],e[2],...o.n,e[3],e[4]);return new Float32Array(t)}function vt(n,t){const o=[];for(let e=0;e<n;e++){const i=e/n*Math.PI,r=(e+1)/n*Math.PI;for(let s=0;s<t;s++){const c=s/t*2*Math.PI,d=(s+1)/t*2*Math.PI,l=[[i,c],[r,c],[r,d],[i,d]];for(const u of[0,1,2,0,2,3]){const[f,p]=l[u],v=Math.sin(f),w=Math.cos(f),m=Math.sin(p),y=Math.cos(p),b=v*y,L=w,S=v*m;o.push(b,L,S,b,L,S,p/(2*Math.PI),f/Math.PI)}}}return new Float32Array(o)}function bt(n){const t=[],o=[],e=[],i=[];for(const r of n.split(`
`)){const s=r.trim();if(s.startsWith("v ")){const[,c,d,l]=s.split(/\s+/).map(Number);t.push([c,d,l])}else if(s.startsWith("vn ")){const[,c,d,l]=s.split(/\s+/).map(Number);o.push([c,d,l])}else if(s.startsWith("vt ")){const[,c,d]=s.split(/\s+/).map(Number);e.push([c,d??0])}else if(s.startsWith("f ")){const d=s.slice(2).trim().split(/\s+/).map(l=>{const u=l.split("/");return{pi:u[0]?parseInt(u[0])-1:-1,ti:u[1]?parseInt(u[1])-1:-1,ni:u[2]?parseInt(u[2])-1:-1}});for(let l=1;l<d.length-1;l++){const u=[d[0],d[l],d[l+1]],f=t[u[0].pi]??[0,0,0],p=t[u[1].pi]??[0,0,0],v=t[u[2].pi]??[0,0,0],w=[p[0]-f[0],p[1]-f[1],p[2]-f[2]],m=[v[0]-f[0],v[1]-f[1],v[2]-f[2]],y=w[1]*m[2]-w[2]*m[1],b=w[2]*m[0]-w[0]*m[2],L=w[0]*m[1]-w[1]*m[0],S=Math.hypot(y,b,L)||1,A=[y/S,b/S,L/S];for(const{pi:N,ti:T,ni:F}of u){const R=t[N]??[0,0,0],B=F>=0&&o[F]?o[F]:A,z=T>=0&&e[T]?e[T]:[.5+Math.atan2(B[2],B[0])/(2*Math.PI),.5-Math.asin(Math.max(-1,Math.min(1,B[1])))/Math.PI];i.push(R[0],R[1],R[2],B[0],B[1],B[2],z[0],z[1])}}}}return new Float32Array(i)}function it(n){const t=E.createBuffer({size:Math.max(n.byteLength,4),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});return E.queue.writeBuffer(t,0,n),{buf:t,count:n.length/k}}const W=E.createShaderModule({code:ct}),Y=E.createRenderPipeline({layout:"auto",vertex:{module:W,entryPoint:"vs_main",buffers:[{arrayStride:k*4,attributes:[{shaderLocation:0,offset:0,format:"float32x3"},{shaderLocation:1,offset:12,format:"float32x3"},{shaderLocation:2,offset:24,format:"float32x2"},{shaderLocation:3,offset:32,format:"float32x3"}]}]},fragment:{module:W,entryPoint:"fs_main",targets:[{format:et}]},primitive:{topology:"triangle-list",cullMode:"back"},depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"}});function X(n,t=[0,0,0]){const o=n==="cube"?gt():vt(64,64),e=ot(o),{buf:i,count:r}=it(e);return new K(n,i,r,t,E,Y)}const P=[];let U=null;function st(n){U=n,O.refreshScene(),O.refreshProps()}const Z=[[-2,0,0],[2,0,0],[0,2,0],[0,-2,0],[-4,0,0],[4,0,0],[-2,2,0],[2,2,0]];function yt(n){const t=P.length%Z.length,o=Z[t],e=X(n,[o[0],o[1],o[2]]);P.push(e),O.refreshScene()}function xt(){if(!U)return;const n=P.indexOf(U);n!==-1&&(P[n].destroy(),P.splice(n,1)),U=null,O.refreshScene(),O.refreshProps()}function wt(n,t){const o=bt(n);if(o.length===0){alert("OBJ parse error or empty mesh");return}const e=ot(o),{buf:i,count:r}=it(e);let s=1/0,c=1/0,d=1/0,l=-1/0,u=-1/0,f=-1/0;for(let b=0;b<o.length;b+=8)s=Math.min(s,o[b]),l=Math.max(l,o[b]),c=Math.min(c,o[b+1]),u=Math.max(u,o[b+1]),d=Math.min(d,o[b+2]),f=Math.max(f,o[b+2]);const p=(s+l)/2,v=(c+u)/2,w=(d+f)/2,m=3.5/(Math.max(l-s,u-c,f-d)||1),y=new K("obj",i,r,[0,0,0],E,Y);y.name=`${y.id}. ${t}`,y.scale=[m,m,m],y.translate=[-p*m,-v*m,-w*m],P.push(y),O.refreshScene(),st(y)}async function Mt(n,t){const o=new Image;o.src=t,await o.decode();const e=await createImageBitmap(o),i=E.createTexture({size:[e.width,e.height],format:"rgba8unorm",usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_DST|GPUTextureUsage.RENDER_ATTACHMENT});E.queue.copyExternalImageToTexture({source:e},{texture:i},[e.width,e.height]),n.texture=i,n.sampler=E.createSampler({magFilter:"linear",minFilter:"linear"}),n.useTexture=!0;const r=document.getElementById("use-texture");r&&(r.checked=!0)}const C=new lt;C.position=[0,0,8];function St(){C.position=[0,0,8],C.yaw=-Math.PI/2,C.pitch=0}const D={mode:0,lightColor:"#ffffff",autoRot:!0,lightPos:[3,4,3]};ht({getScene:()=>P,getSelected:()=>U,setSelected:st,addObject:yt,removeSelected:xt,getRenderState:()=>D,loadOBJ:wt,loadTexture:Mt,resetCamera:St});const _=new Set;window.addEventListener("keydown",n=>_.add(n.key));window.addEventListener("keyup",n=>_.delete(n.key));let H=!1,V=null;function rt(n,t){const o=Math.min(x.width,x.height),e=(2*n-x.width)/o,i=(x.height-2*t)/o,r=e*e+i*i;if(r<=1)return[e,i,Math.sqrt(1-r)];const s=Math.sqrt(r);return[e/s,i/s,0]}function Et(n,t){return[n[1]*t[2]-n[2]*t[1],n[2]*t[0]-n[0]*t[2],n[0]*t[1]-n[1]*t[0]]}function Lt(n,t){return n[0]*t[0]+n[1]*t[1]+n[2]*t[2]}function It(n){const t=Math.hypot(...n)||1;return[n[0]/t,n[1]/t,n[2]/t]}function Bt(n,t){const[o,e,i]=It(n),r=Math.cos(t),s=Math.sin(t),c=1-r;return new Float32Array([c*o*o+r,c*o*e+s*i,c*o*i-s*e,0,c*o*e-s*i,c*e*e+r,c*e*i+s*o,0,c*o*i+s*e,c*e*i-s*o,c*i*i+r,0,0,0,0,1])}x.addEventListener("mousedown",n=>{if(n.button!==0)return;H=!0;const t=x.getBoundingClientRect();V=rt((n.clientX-t.left)*(x.width/t.width),(n.clientY-t.top)*(x.height/t.height))});window.addEventListener("mouseup",()=>{H=!1,V=null});window.addEventListener("mousemove",n=>{if(!H||!V)return;const t=x.getBoundingClientRect(),o=rt((n.clientX-t.left)*(x.width/t.width),(n.clientY-t.top)*(x.height/t.height)),e=Et(V,o);if(Math.hypot(...e)>1e-6){const i=Math.acos(Math.max(-1,Math.min(1,Lt(V,o))))*2,r=Bt(e,i);if(U)U.arcball=h.multiply(r,U.arcball);else for(const s of P)s.arcball=h.multiply(r,s.arcball)}V=o});x.addEventListener("contextmenu",n=>n.preventDefault());x.addEventListener("wheel",n=>{n.preventDefault();const t=C.getForward(),o=n.deltaY*.02;C.position=[C.position[0]-t[0]*o,C.position[1]-t[1]*o,C.position[2]-t[2]*o]},{passive:!1});let J=performance.now();const Ct=performance.now();function at(n){const t=Math.min(.033,(n-J)/1e3);J=n;const o=(n-Ct)/1e3;C.update(_,t);const e=h.perspective(Math.PI/3,x.width/x.height,.1,200),i=C.getViewMatrix();let[r,s,c]=D.lightPos;D.autoRot&&(r=Math.cos(o*.8)*4.5,c=Math.sin(o*.8)*4.5,s=4);const d=[r,s,c],l=ft(D.lightColor);for(const v of P)v.uploadUniforms(E,i,e,C.position,d,l,D.mode,o);const u=E.createCommandEncoder(),f=D.mode===3?{r:1,g:1,b:1,a:1}:{r:.05,g:.05,b:.08,a:1},p=u.beginRenderPass({colorAttachments:[{view:tt.getCurrentTexture().createView(),clearValue:f,loadOp:"clear",storeOp:"store"}],depthStencilAttachment:{view:q.createView(),depthClearValue:1,depthLoadOp:"clear",depthStoreOp:"store"}});p.setPipeline(Y);for(const v of P)p.setBindGroup(0,v.bindGroup),p.setVertexBuffer(0,v.buf),p.draw(v.count);p.end(),E.queue.submit([u.finish()]),requestAnimationFrame(at)}O.init();P.push(X("sphere",[-2,0,0]));P.push(X("cube",[2,0,0]));O.refreshScene();requestAnimationFrame(at);
