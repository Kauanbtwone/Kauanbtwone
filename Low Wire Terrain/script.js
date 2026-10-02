// --- CONFIGURAÇÕES BASE DO WEBGL ---
const DEPTH = 60;
const HALF_X = 64;
const BACK = 10;
const FOG_NEAR = 14;
const FOG_FAR = 46;
const FLIGHT_RATE = 4;
const EYE_HEIGHT = 1.7;
const RIDGE = 4.2;
const VALLEY = 3;
const FOV = (58 * Math.PI) / 180;
const SUN_ELEV = 0.02;
const SUN_RADIUS = 0.22;
const BASE_PITCH = (6.5 * Math.PI) / 180;
const STEER_YAW = (11 * Math.PI) / 180;
const STEER_LIFT = 0.8;
const DPR_CAP = 2;
const DEG = Math.PI / 180;
const GLOW_PX = 2;
const GLOW_ALPHA = 0.28;
const STAR_CELLS = 120;

let dynamicSpeed = 50; 

const colorCache = new Map();
function parseColor(input, fallback) {
    if (!input) return fallback;
    const hit = colorCache.get(input);
    if (hit) return hit;
    let s = input.trim();
    const v = /^var\(\s*--[^,]+,\s*(.+)\)$/.exec(s);
    if (v) s = v[1].trim();
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    if (!ctx) return fallback;
    ctx.fillStyle = "#010203";
    ctx.fillStyle = s;
    if (ctx.fillStyle === "#010203" && s.toLowerCase() !== "#010203") return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    const out = [d[0], d[1], d[2], d[3] / 255];
    colorCache.set(input, out);
    return out;
}

const TERRAIN_VERT = `
precision highp float;
attribute vec3 aP; uniform float uCamZ; uniform vec3 uCam;
uniform vec3 uR0; uniform vec3 uR1; uniform vec3 uR2;
uniform vec4 uProj; uniform float uAmp; uniform vec2 uNudge;
varying float vFog; varying float vDist; varying float vH;

float hash(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p, float period) {
    vec2 i = floor(p); vec2 f = p - i; vec2 u = f * f * (3.0 - 2.0 * f);
    float z0 = mod(i.y, period); float z1 = mod(i.y + 1.0, period);
    float a = hash(vec2(i.x, z0)); float b = hash(vec2(i.x + 1.0, z0));
    float c = hash(vec2(i.x, z1)); float d = hash(vec2(i.x + 1.0, z1));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float height(float x, float z) {
    float n = vnoise(vec2(x, z) / 6.0, ${(DEPTH / 6).toFixed(1)}) * 0.6
            + vnoise(vec2(x, z) / 3.0, ${(DEPTH / 3).toFixed(1)}) * 0.27
            + vnoise(vec2(x, z) / 1.5, ${(DEPTH / 1.5).toFixed(1)}) * 0.13;
    float ax = abs(x);
    float side = smoothstep(${VALLEY.toFixed(1)}, ${(VALLEY + 13).toFixed(1)}, ax);
    return uAmp * (side * (pow(n, 1.6) * 2.1 + 0.55 * ax / ${HALF_X.toFixed(1)}) + 0.1 * (n - 0.5));
}
void main() {
    float relA = mod(aP.y - uCamZ + ${BACK.toFixed(1)}, ${DEPTH.toFixed(1)}) - ${BACK.toFixed(1)};
    float zr = relA + aP.z;
    float h = height(aP.x, uCamZ + zr);
    vec3 q = vec3(aP.x - uCam.x, h - uCam.y, zr);
    vec3 v = vec3(dot(uR0, q), dot(uR1, q), dot(uR2, q));
    float dist = length(vec2(q.x * 0.55, zr));
    vDist = dist; vH = h / max(uAmp, 1e-3);
    vFog = 1.0 - smoothstep(${FOG_NEAR.toFixed(1)}, ${FOG_FAR.toFixed(1)}, dist);
    gl_Position = vec4(v.x * uProj.x, v.y * uProj.y, uProj.z * v.z + uProj.w, v.z);
    gl_Position.xy += uNudge * v.z;
}
`;

const TERRAIN_FRAG = `
precision highp float;
uniform vec4 uColor; uniform vec3 uPeak; uniform float uSolid;
varying float vFog; varying float vDist; varying float vH;
void main() {
    float fillFog = 1.0 - smoothstep(${(FOG_FAR - 5).toFixed(1)}, ${FOG_FAR.toFixed(1)}, vDist);
    float a = uColor.a * mix(vFog, fillFog, uSolid);
    vec3 c = mix(uColor.rgb, uPeak, smoothstep(0.15, 1.4, vH) * (1.0 - uSolid));
    gl_FragColor = vec4(c, a);
}
`;

const SKY_VERT = `attribute vec3 aP; void main() { gl_Position = vec4(aP.xy, 0.0, 1.0); }`;

const SKY_FRAG = `
precision highp float;
uniform vec2 uRes; uniform vec3 uUp; uniform vec2 uFocal; uniform vec3 uSun;
uniform float uBandT; uniform vec3 uBg; uniform vec4 uAccent;
uniform vec3 uR0; uniform vec3 uR1; uniform vec3 uR2; uniform float uStars; uniform vec3 uLine;
float shash(vec2 c) { return fract(sin(dot(c, vec2(41.3, 289.1))) * 45758.5453); }

void main() {
    vec2 p = gl_FragCoord.xy; vec2 ndc = p / uRes * 2.0 - 1.0;
    vec3 ray = vec3(ndc.x / uFocal.x, ndc.y / uFocal.y, 1.0);
    float worldY = dot(uUp, ray) / length(ray);
    float pxPerRad = uRes.y * 0.5 * uFocal.y;
    float above = clamp(worldY * pxPerRad + 0.5, 0.0, 1.0);
    vec3 col = uBg;
    col = mix(col, mix(uLine, uAccent.rgb, 0.3), exp(-abs(worldY) * 5.0) * 0.4);

    if (uStars > 0.0 && worldY > 0.0) {
        vec3 w = normalize(ray.x * uR0 + ray.y * uR1 + ray.z * uR2);
        vec2 sp = vec2(atan(w.x, w.z), asin(clamp(w.y, -1.0, 1.0))) * ${STAR_CELLS.toFixed(1)};
        vec2 id = floor(sp); float h = shash(id);
        if (h < uStars * 0.3) {
            vec2 o = vec2(shash(id + 7.1), shash(id + 3.3)) - 0.5;
            float d = length(fract(sp) - 0.5 - o * 0.6);
            float tw = 0.7 + 0.3 * sin(uBandT * 25.0 + h * 60.0);
            float star = exp(-d * d / 0.006) * tw * smoothstep(0.02, 0.2, w.y);
            col += vec3(star) * (0.4 + 0.6 * shash(id + 1.7));
        }
    }

    float R = max(uSun.z, 1.0); vec2 dv = p - uSun.xy; float d = length(dv);
    float halo = exp(-max(d - R, 0.0) / (R * 0.9)) * 0.16;
    col = mix(col, uAccent.rgb, halo * uAccent.a * (0.35 + 0.65 * above));
    float disc = clamp(R - d + 0.5, 0.0, 1.0);
    float yy = (uSun.y - p.y) / R; float period = max(R * 0.11, 3.0);
    float s = fract((uSun.y - p.y) / period + uBandT) * period;
    float cut = clamp((yy + 0.3) * 0.5, 0.0, 0.8) * period;
    float band = yy > -0.3 ? clamp(s - cut + 0.5, 0.0, 1.0) : 1.0;
    vec3 sunTop = mix(uAccent.rgb, vec3(1.0, 0.93, 0.78), 0.32);
    vec3 sunCol = mix(sunTop, uAccent.rgb * 0.9, clamp(yy * 0.5 + 0.5, 0.0, 1.0));
    col = mix(col, sunCol, disc * band * uAccent.a);
    gl_FragColor = vec4(col, 1.0);
}
`;

function compile(gl, type, src) {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.error("Shader erro: " + gl.getShaderInfoLog(sh));
        gl.deleteShader(sh); return null;
    }
    return sh;
}

function link(gl, vs, fs) {
    const v = compile(gl, gl.VERTEX_SHADER, vs);
    const f = compile(gl, gl.FRAGMENT_SHADER, fs);
    if (!v || !f) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, v); gl.attachShader(prog, f);
    gl.bindAttribLocation(prog, 0, "aP"); gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { return null; }
    return prog;
}

function buildLattice(rows) {
    const s = DEPTH / rows;
    const nx = Math.max(2, 2 * Math.round(HALF_X / s));
    const tris = new Float32Array(nx * rows * 18);
    const lines = new Float32Array(nx * rows * 12);
    let t = 0; let l = 0;
    for (let j = 0; j < rows; j++) {
        const z0 = j * s;
        for (let i = 0; i < nx; i++) {
            const x0 = -HALF_X + (i + 0.5) * s; const x1 = x0 + s;
            tris.set([x0, z0, 0, x1, z0, 0, x1, z0, s, x0, z0, 0, x1, z0, s, x0, z0, s], t); t += 18;
            lines.set([x0, z0, 0, x1, z0, 0, x0, z0, 0, x0, z0, s], l); l += 12;
        }
    }
    return { tris, lines };
}

// INICIALIZAÇÃO GERAL
window.addEventListener("load", () => {
    
    // 1. MÁQUINA DE ESCREVER (TYPEWRITER)
    const subtitleEl = document.getElementById('typewriter-text');
    if (subtitleEl) {
        const textToType = subtitleEl.getAttribute('data-text');
        let i = 0;
        function typeWriter() {
            if (i < textToType.length) {
                subtitleEl.innerHTML += textToType.charAt(i);
                i++;
                const speed = textToType.charAt(i) === ' ' ? 20 : Math.random() * 40 + 30;
                setTimeout(typeWriter, speed);
            }
        }
        setTimeout(typeWriter, 800);
    }

    // 2. EFEITO 3D TILT NOS CARDS DE PROJETO (À PROVA DE MOBILE)
    const cards = document.querySelectorAll('.project-card');
    
    // Verifica se o dispositivo suporta "hover" (tem rato/mouse físico)
    const isMouseDevice = window.matchMedia("(any-hover: hover)").matches;

    cards.forEach(card => {
        if (isMouseDevice) {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left; 
                const y = e.clientY - rect.top;  
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                
                // Suavizando o efeito para 8 graus
                const rotateX = ((y - centerY) / centerY) * -8; 
                const rotateY = ((x - centerX) / centerX) * 8;

                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
                card.style.transition = 'transform 0.1s ease';
                card.style.background = `radial-gradient(circle at ${x}px ${y}px, rgba(255, 43, 214, 0.15) 0%, rgba(0, 0, 0, 0.4) 50%)`;
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
                card.style.transition = 'transform 0.5s ease, background 0.5s ease';
                card.style.background = 'rgba(0, 0, 0, 0.4)';
            });
        }
    });

    // 3. BACKGROUND WEBGL
    const canvas = document.getElementById("bg-canvas");
    const gl = canvas.getContext("webgl", { antialias: true, alpha: false, depth: true });
    if (!gl) return;

    const terrain = link(gl, TERRAIN_VERT, TERRAIN_FRAG);
    const sky = link(gl, SKY_VERT, SKY_FRAG);
    if (!terrain || !sky) return;

    const tu = {
        camZ: gl.getUniformLocation(terrain, "uCamZ"), cam: gl.getUniformLocation(terrain, "uCam"),
        r0: gl.getUniformLocation(terrain, "uR0"), r1: gl.getUniformLocation(terrain, "uR1"), r2: gl.getUniformLocation(terrain, "uR2"),
        proj: gl.getUniformLocation(terrain, "uProj"), amp: gl.getUniformLocation(terrain, "uAmp"), nudge: gl.getUniformLocation(terrain, "uNudge"),
        color: gl.getUniformLocation(terrain, "uColor"), peak: gl.getUniformLocation(terrain, "uPeak"), solid: gl.getUniformLocation(terrain, "uSolid"),
    };
    const su = {
        res: gl.getUniformLocation(sky, "uRes"), up: gl.getUniformLocation(sky, "uUp"), focal: gl.getUniformLocation(sky, "uFocal"),
        sun: gl.getUniformLocation(sky, "uSun"), bandT: gl.getUniformLocation(sky, "uBandT"), bg: gl.getUniformLocation(sky, "uBg"),
        accent: gl.getUniformLocation(sky, "uAccent"), r0: gl.getUniformLocation(sky, "uR0"), r1: gl.getUniformLocation(sky, "uR1"),
        r2: gl.getUniformLocation(sky, "uR2"), stars: gl.getUniformLocation(sky, "uStars"), line: gl.getUniformLocation(sky, "uLine"),
    };

    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), gl.STATIC_DRAW);
    
    const triBuf = gl.createBuffer(); const lineBuf = gl.createBuffer();
    let triCount = 0; let lineCount = 0; let latticeRows = -1;
    gl.enableVertexAttribArray(0); gl.depthFunc(gl.LEQUAL); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    let W = 0, H = 0, dpr = 1;
    const resize = () => {
        dpr = Math.min(DPR_CAP, window.devicePixelRatio || 1);
        W = window.innerWidth; H = window.innerHeight;
        const bw = Math.max(1, Math.round(W * dpr));
        const bh = Math.max(1, Math.round(H * dpr));
        if (canvas.width !== bw || canvas.height !== bh) { canvas.width = bw; canvas.height = bh; }
    };
    resize(); window.addEventListener("resize", resize);

    window.addEventListener("scroll", () => {
        let scrollY = window.scrollY;
        dynamicSpeed = Math.min(50 + (scrollY * 0.1), 200);
    });

    const pointer = { nx: 0, ny: 0, active: false, presence: 0 };
    const cam = { yaw: 0, roll: 0, lift: 0, init: false };
    let camZ = 0, tIdle = 0, raf = 0, last = -1;

    const bg = parseColor("#0B0420", [232, 225, 211, 1]);
    const line = parseColor("#FF2BD6", [43, 41, 38, 1]);
    const acc = parseColor("#FFB23F", [200, 82, 46, 1]);
    const relief = 1, sunSize = 1, eye = EYE_HEIGHT, hover = 1, stars = 0.8;

    const frame = (now) => {
        const rows = 60, speed = Math.max(0, dynamicSpeed);
        if (rows !== latticeRows) {
            latticeRows = rows; const lat = buildLattice(rows);
            gl.bindBuffer(gl.ARRAY_BUFFER, triBuf); gl.bufferData(gl.ARRAY_BUFFER, lat.tris, gl.STATIC_DRAW); triCount = lat.tris.length / 3;
            gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.bufferData(gl.ARRAY_BUFFER, lat.lines, gl.STATIC_DRAW); lineCount = lat.lines.length / 3;
        }

        const dt = last < 0 ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
        last = now; const rate = speed / 50;
        camZ = (camZ + dt * rate * FLIGHT_RATE) % DEPTH; tIdle += dt * rate;

        const pe = 1 - Math.exp(-dt * 3);
        pointer.presence += ((pointer.active ? 1 : 0) - pointer.presence) * pe;
        if (!pointer.active && pointer.presence < 0.002) pointer.presence = 0;
        const k = pointer.presence * Math.min(1, hover);
        const idleYaw = (Math.sin(tIdle * 0.21) * 3 + Math.sin(tIdle * 0.13 + 2) * 1.5) * DEG;
        const idleRoll = Math.sin(tIdle * 0.17 + 1) * 1.8 * DEG;
        const idleLift = Math.sin(tIdle * 0.11) * 0.12;
        const yawT = idleYaw * (1 - k) + pointer.nx * STEER_YAW * hover * k;
        const liftT = idleLift * (1 - k) + -pointer.ny * STEER_LIFT * hover * k;
        const rollT = idleRoll * (1 - k) - yawT * 0.55 * k;
        
        if (!cam.init) { cam.yaw = yawT; cam.roll = rollT; cam.lift = liftT; cam.init = true; }
        const ce = 1 - Math.exp(-dt * 2.5);
        cam.yaw += (yawT - cam.yaw) * ce; cam.roll += (rollT - cam.roll) * ce; cam.lift += (liftT - cam.lift) * ce;

        const camY = Math.max(0.35, eye * (1 + cam.lift));
        const pitch = BASE_PITCH + (camY / EYE_HEIGHT - 1) * 2.2 * DEG;
        const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
        const cp = Math.cos(pitch), sp = Math.sin(pitch);
        const cr = Math.cos(cam.roll), sr = Math.sin(cam.roll);
        const a0 = [cy, 0, -sy], a1 = [sp * sy, cp, sp * cy], a2 = [cp * sy, -sp, cp * cy];
        const r0 = [cr * a0[0] - sr * a1[0], cr * a0[1] - sr * a1[1], cr * a0[2] - sr * a1[2]];
        const r1 = [sr * a0[0] + cr * a1[0], sr * a0[1] + cr * a1[1], sr * a0[2] + cr * a1[2]];
        const r2 = a2;

        const aspect = W / Math.max(1, H);
        const fy = 1 / Math.tan(FOV / 2), fx = fy / aspect;
        const near = 0.05, far = 200, A = (far + near) / (far - near), B = (-2 * far * near) / (far - near);
        const sd = [0, SUN_ELEV, 1];
        const sv = [ r0[0]*sd[0] + r0[1]*sd[1] + r0[2]*sd[2], r1[0]*sd[0] + r1[1]*sd[1] + r1[2]*sd[2], r2[0]*sd[0] + r2[1]*sd[1] + r2[2]*sd[2] ];
        const svz = Math.max(1e-3, sv[2]);
        const bw = canvas.width, bh = canvas.height;
        const sunX = ((sv[0] / svz) * fx * 0.5 + 0.5) * bw;
        const sunY = ((sv[1] / svz) * fy * 0.5 + 0.5) * bh;

        gl.viewport(0, 0, bw, bh); gl.clearColor(bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
        gl.depthMask(true); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Sky
        gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.useProgram(sky);
        gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.uniform2f(su.res, bw, bh); gl.uniform3f(su.up, r0[1], r1[1], r2[1]); gl.uniform2f(su.focal, fx, fy);
        gl.uniform3f(su.sun, sunX, sunY, SUN_RADIUS * sunSize * bh); gl.uniform1f(su.bandT, tIdle * 0.12);
        gl.uniform3f(su.bg, bg[0] / 255, bg[1] / 255, bg[2] / 255);
        gl.uniform4f(su.accent, acc[0] / 255, acc[1] / 255, acc[2] / 255, sunSize > 0 ? acc[3] : 0);
        gl.uniform3f(su.r0, r0[0], r0[1], r0[2]); gl.uniform3f(su.r1, r1[0], r1[1], r1[2]); gl.uniform3f(su.r2, r2[0], r2[1], r2[2]);
        gl.uniform1f(su.stars, stars); gl.uniform3f(su.line, line[0] / 255, line[1] / 255, line[2] / 255);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // Terrain
        gl.useProgram(terrain);
        gl.uniform1f(tu.camZ, camZ); gl.uniform3f(tu.cam, 0, camY, 0);
        gl.uniform3f(tu.r0, r0[0], r0[1], r0[2]); gl.uniform3f(tu.r1, r1[0], r1[1], r1[2]); gl.uniform3f(tu.r2, r2[0], r2[1], r2[2]);
        gl.uniform4f(tu.proj, fx, fy, A, B); gl.uniform1f(tu.amp, RIDGE * relief);
        gl.uniform3f(tu.peak, acc[0] / 255, acc[1] / 255, acc[2] / 255);
        gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND);

        gl.depthMask(true); gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
        gl.uniform2f(tu.nudge, 0, 0); gl.uniform1f(tu.solid, 1);
        gl.uniform4f(tu.color, bg[0] / 255, bg[1] / 255, bg[2] / 255, 1);
        gl.bindBuffer(gl.ARRAY_BUFFER, triBuf); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, triCount);
        gl.disable(gl.POLYGON_OFFSET_FILL);

        gl.depthMask(false); gl.uniform1f(tu.solid, 0);
        gl.uniform4f(tu.color, line[0] / 255, line[1] / 255, line[2] / 255, line[3]);
        gl.bindBuffer(gl.ARRAY_BUFFER, lineBuf); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.LINES, 0, lineCount);
        if (dpr > 1.25) { gl.uniform2f(tu.nudge, 2 / bw, 2 / bh); gl.drawArrays(gl.LINES, 0, lineCount); }

        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
        gl.uniform4f(tu.color, line[0] / 255, line[1] / 255, line[2] / 255, line[3] * GLOW_ALPHA);
        const gx = (GLOW_PX * 2) / bw, gy = (GLOW_PX * 2) / bh;
        for (const [ox, oy] of [[gx, 0], [-gx, 0], [0, gy], [0, -gy]]) {
            gl.uniform2f(tu.nudge, ox, oy); gl.drawArrays(gl.LINES, 0, lineCount);
        }
        gl.uniform2f(tu.nudge, 0, 0); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(true);

        raf = requestAnimationFrame(frame);
    };
    
    raf = requestAnimationFrame(frame);

    const onMove = (e) => {
        pointer.nx = Math.max(-1, Math.min(1, (e.clientX / W) * 2 - 1));
        pointer.ny = Math.max(-1, Math.min(1, (e.clientY / H) * 2 - 1));
        pointer.active = true;
    };
    const onLeave = () => { pointer.active = false; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerleave", onLeave);
});