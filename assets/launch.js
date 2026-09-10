/* ============================================================
   灵感徽章 · Launch 页
   规范：docs/DESIGN.md ｜ 行为记录：docs/AGENT-LOG.md
   约束：不加载任何第三方脚本（three.js 本地 vendor）、不加载图片素材、
        无追踪、prefers-reduced-motion 全部降级
   ============================================================ */

import * as THREE from '../vendor/three.module.min.js';

/* ─────────────────────────── 0 · 基础工具 ─────────────────────────── */

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => t * t * (3 - 2 * t);
const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/**
 * 把某个元素的滚动区间映射成 0..1：0 = 元素顶部刚抵达视口底部，1 = 元素底部离开视口顶部。
 * 这是"元素穿过视口"的标准映射。之前用带 lead 的版本，段落会在还没滚完时就跑满 1.0
 * —— 结果 04 的黑场在 40% 处就提前发生了。
 */
function spanOf(el) {
  const r = el.getBoundingClientRect();
  const top = r.top + window.scrollY;
  const vh = window.innerHeight;
  const start = top - vh;
  const end = top + r.height;
  return { start, end: Math.max(end, start + 1) };
}
const inSpan = (p, s) => clamp((p - s.start) / (s.end - s.start), 0, 1);

/* ─────────────────────────── 1 · 滚动控制器 ───────────────────────── */

const state = {
  scroll: 0,
  progress: 0,               // 全页 0..1
  spans: {},
  sectionP: {},              // 每个段落自己的 0..1
  dark: false,
  cloudSpin: 0,
  cloudDrag: { x: 0, y: 0, vx: 0, vy: 0, dragging: false },
  pointer: { x: innerWidth / 2, y: innerHeight / 2 },
};

function measure() {
  $$('.sec').forEach(sec => {
    const s = spanOf(sec);
    state.spans['#' + sec.id] = s;
  });
  state.spans.doc = { start: 0, end: Math.max(1, document.body.scrollHeight - innerHeight) };
}

function onScroll() {
  state.scroll = window.scrollY;
  state.progress = clamp(state.scroll / state.spans.doc.end, 0, 1);
  for (const [id, s] of Object.entries(state.spans)) {
    if (id === 'doc') continue;
    state.sectionP[id] = inSpan(state.scroll, s);
  }
  applyScroll();
}

/* ─────────────────────────── 2 · WebGL ──────────────────────────── */

const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight, false);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, 7.4);

/* 程序生成环境贴图：竖向渐变 + 一条亮带，让金属有机身高光 */
function makeEnvTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0.00, '#ffffff');
  grad.addColorStop(0.42, '#e8e6e2');
  grad.addColorStop(0.58, '#b9b6b1');
  grad.addColorStop(1.00, '#2b2926');
  g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
  g.fillStyle = 'rgba(255,255,255,.85)';
  g.fillRect(150, 30, 210, 54);
  const tex = new THREE.CanvasTexture(c);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const pmrem = new THREE.PMREMGenerator(renderer);
const envRT = pmrem.fromEquirectangular(makeEnvTexture());

/* ── 场景 A · 手机 ─────────────────────────────────────────────── */

const phoneScene = new THREE.Scene();
phoneScene.environment = envRT.texture;

phoneScene.add(new THREE.AmbientLight(0xffffff, 0.55));
const key = new THREE.DirectionalLight(0xffffff, 2.1); key.position.set(3.2, 4.2, 6); phoneScene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 1.0); rim.position.set(-4, -1.5, -3); phoneScene.add(rim);

const phoneGroup = new THREE.Group();
phoneScene.add(phoneGroup);

function roundedRectShape(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

const PHONE = { w: 1.60, h: 3.26, r: 0.30, d: 0.16 };

/** 用挤出几何做机身（真几何、真材质，不是贴图假装的） */
function makePhoneBody() {
  const shape = roundedRectShape(PHONE.w, PHONE.h, PHONE.r);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: PHONE.d, bevelEnabled: true, bevelSize: 0.03, bevelThickness: 0.03,
    bevelSegments: 5, curveSegments: 16,
  });
  geo.center();
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0x8f959c, metalness: 1, roughness: 0.34, envMapIntensity: 1.25,
    clearcoat: 0.35, clearcoatRoughness: 0.5,
  });
  return new THREE.Mesh(geo, mat);
}

const loader = new THREE.TextureLoader();
const SCREENS = ['assets/screens/home.png', 'assets/screens/stage.png', 'assets/screens/result.png'];
const phones = [];

SCREENS.forEach((src, i) => {
  const g = new THREE.Group();
  g.add(makePhoneBody());

  const screenMat = new THREE.MeshBasicMaterial({ toneMapped: false });
  loader.load(src, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    screenMat.map = tex; screenMat.needsUpdate = true;
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(PHONE.w - 0.11, PHONE.h - 0.11), screenMat);
  screen.position.z = PHONE.d / 2 + 0.038;
  g.add(screen);

  // 屏幕四周的一圈黑边，让玻璃"贴"在机身上
  const bezel = new THREE.Mesh(
    new THREE.PlaneGeometry(PHONE.w - 0.06, PHONE.h - 0.06),
    new THREE.MeshBasicMaterial({ color: 0x0b0b0c })
  );
  bezel.position.z = PHONE.d / 2 + 0.03;
  g.add(bezel); g.add(screen); // 保证屏幕在 bezel 之上

  // 背面摄像头（凸起 + 镜片）
  const bump = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.05, 32),
    new THREE.MeshPhysicalMaterial({ color: 0x9aa0a6, metalness: 1, roughness: 0.3 })
  );
  bump.rotation.x = Math.PI / 2;
  bump.position.set(-PHONE.w / 2 + 0.34, PHONE.h / 2 - 0.34, -PHONE.d / 2 - 0.03);
  g.add(bump);

  phoneGroup.add(g);
  phones.push(g);
});

/* ── 场景 B · 小物星云 ─────────────────────────────────────────── */

const cloudScene = new THREE.Scene();
const cloudGroup = new THREE.Group();
cloudScene.add(cloudGroup);

const POINTS_PER_SHAPE = 7000;

/**
 * 用 canvas 画一个剪影，再按像素采样成点集。
 * 这是"小物星云"的数据来源 —— 不用任何现成地图或图片素材。
 */
function silhouettePoints(draw, n) {
  const S = 220;
  const c = document.createElement('canvas');
  c.width = S; c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, S, S);
  g.fillStyle = '#fff';
  draw(g, S);
  const data = g.getImageData(0, 0, S, S).data;
  const hits = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (data[(y * S + x) * 4] > 128) hits.push([x, y]);
    }
  }
  if (!hits.length) return new Float32Array(n * 3);
  // 采样到固定点数（有放回），再按"绕质心的角度 + 半径"排序，
  // 这样两个形态之间可以按序号配点，变形不会乱跳
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(hits[(Math.random() * hits.length) | 0]);
  const cx = pts.reduce((a, p) => a + p[0], 0) / n;
  const cy = pts.reduce((a, p) => a + p[1], 0) / n;
  // 用质心做居中，六个形态才都落在画面正中（否则每个形态偏心不同，变形时会漂）
  pts.sort((a, b) => {
    const aa = Math.atan2(a[1] - cy, a[0] - cx), ab = Math.atan2(b[1] - cy, b[0] - cx);
    return aa - ab;
  });
  const out = new Float32Array(n * 3);
  const scale = 4.6 / S;
  for (let i = 0; i < n; i++) {
    const [x, y] = pts[i];
    out[i * 3] = (x - S / 2) * scale;
    out[i * 3 + 1] = -(y - S / 2) * scale;
    out[i * 3 + 2] = (Math.random() - 0.5) * 0.42;  // 一点纵深，转动时有厚度
  }
  return out;
}

/* 六个小物的剪影：杯、钥匙、叶、伞、书、耳机 */
const SHAPES = [
  g => { // 杯子
    g.beginPath(); g.moveTo(62, 66); g.lineTo(158, 66); g.lineTo(146, 176);
    g.quadraticCurveTo(110, 190, 74, 176); g.closePath(); g.fill();
    g.beginPath(); g.arc(160, 108, 26, -Math.PI / 2, Math.PI / 2); g.lineWidth = 13;
    g.strokeStyle = '#fff'; g.stroke();
  },
  g => { // 钥匙：头 + 短轴 + 两个齿
    g.beginPath(); g.arc(96, 66, 26, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(96, 66, 10, 0, Math.PI * 2);
    g.fillStyle = '#000'; g.fill(); g.fillStyle = '#fff';
    g.beginPath(); g.rect(89, 88, 15, 76); g.fill();
    g.beginPath(); g.rect(104, 138, 26, 12); g.fill();
    g.beginPath(); g.rect(104, 158, 19, 12); g.fill();
  },
  g => { // 叶子
    g.beginPath(); g.moveTo(44, 176);
    g.quadraticCurveTo(60, 62, 176, 48);
    g.quadraticCurveTo(180, 158, 44, 176); g.fill();
  },
  g => { // 伞
    g.beginPath(); g.arc(110, 118, 72, Math.PI, 0); g.fill();
    g.beginPath(); g.rect(105, 118, 11, 62); g.fill();
    g.beginPath(); g.arc(94, 180, 17, 0, Math.PI); g.lineWidth = 11;
    g.strokeStyle = '#fff'; g.stroke();
  },
  g => { // 书
    g.beginPath(); g.rect(56, 62, 108, 116); g.fill();
    g.fillStyle = '#000'; g.fillRect(150, 62, 14, 116); g.fillStyle = '#fff';
  },
  g => { // 耳机
    g.beginPath(); g.arc(110, 112, 62, Math.PI, 0); g.lineWidth = 18;
    g.strokeStyle = '#fff'; g.stroke();
    g.beginPath(); g.roundRect(38, 106, 30, 62, 13); g.fill();
    g.beginPath(); g.roundRect(152, 106, 30, 62, 13); g.fill();
  },
];

const cloudSets = SHAPES.map(draw => silhouettePoints(draw, POINTS_PER_SHAPE));

const cloudGeo = new THREE.BufferGeometry();
const cloudPos = new Float32Array(cloudSets[0]);
cloudGeo.setAttribute('position', new THREE.BufferAttribute(cloudPos, 3));

const cloudMat = new THREE.PointsMaterial({
  size: 0.045, sizeAttenuation: true, color: 0x1a1712, transparent: true, opacity: 0.9,
});
const cloudPoints = new THREE.Points(cloudGeo, cloudMat);
cloudGroup.add(cloudPoints);

/* 星云拖拽：桌面与触屏同一套 Pointer Events */
(function enableCloudDrag() {
  const el = $('#s03');
  let last = null;
  const down = e => { state.cloudDrag.dragging = true; last = { x: e.clientX, y: e.clientY }; el.setPointerCapture?.(e.pointerId); };
  const move = e => {
    if (!state.cloudDrag.dragging || !last) return;
    const dx = e.clientX - last.x, dy = e.clientY - last.y;
    last = { x: e.clientX, y: e.clientY };
    state.cloudSpin += dx * 0.006;
    cloudGroup.rotation.x = clamp(cloudGroup.rotation.x + dy * 0.003, -0.6, 0.6);
    state.cloudDrag.vx = dx * 0.0006;
  };
  const up = () => { state.cloudDrag.dragging = false; last = null; };
  el.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
})();

/* ── 场景 C · 收尾的点阵 ───────────────────────────────────────── */

const pixelScene = new THREE.Scene();
const PIX_N = 32000;
{
  const positions = new Float32Array(PIX_N * 3);
  const cols = Math.floor(Math.sqrt(PIX_N * (innerWidth / innerHeight)));
  const rows = Math.ceil(PIX_N / cols);
  let i = 0;
  for (let y = 0; y < rows && i < PIX_N; y++) {
    for (let x = 0; x < cols && i < PIX_N; x++, i++) {
      positions[i * 3] = (x / (cols - 1) - 0.5) * 16;
      positions[i * 3 + 1] = (0.5 - y / (rows - 1)) * 9 - 1.2;
      positions[i * 3 + 2] = 0;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setAttribute('aRow', new THREE.BufferAttribute(
    Float32Array.from({ length: PIX_N }, (_, k) => Math.floor(k / cols)), 1));
  const mat = new THREE.PointsMaterial({ size: 0.03, color: 0xf5f2ee, transparent: true, opacity: 0.0 });
  pixelScene.add(new THREE.Points(g, mat));
  pixelScene.userData.material = mat;
}

/* ─────────────────────────── 3 · DOM 效果 ──────────────────────── */

/* 05 · 逐词点亮 */
$$('.wordlight').forEach(el => {
  const words = (el.dataset.words || '').split('|').filter(Boolean);
  el.innerHTML = words.map(w => `<i>${w}</i>`).join('');
});

/* 06 · 四章的道具：网格线 / 扫描带 / 涟漪 / 点阵 */
(() => {
  const gridSec = $('#f1');
  const gl = document.createElement('div');
  gl.className = 'gridlines';
  for (let i = 1; i < 9; i++) {
    const v = document.createElement('i');
    v.style.cssText = `left:${i * 10}%;top:0;bottom:0;width:1px`;
    gl.appendChild(v);
  }
  for (let i = 1; i < 6; i++) {
    const h = document.createElement('i');
    h.style.cssText = `top:${i * 16}%;left:0;right:0;height:1px`;
    gl.appendChild(h);
  }
  gridSec.prepend(gl);

  const sb = document.createElement('div');
  sb.className = 'scanbar';
  $('#f2').appendChild(sb);

  const rp = document.createElement('div');
  rp.className = 'ripples';
  for (let i = 0; i < 4; i++) {
    const c = document.createElement('i');
    c.style.animationDelay = (i * 0.55) + 's';
    rp.appendChild(c);
  }
  $('#f3').appendChild(rp);

  const dots = document.createElement('div');
  dots.className = 'dots';
  for (let i = 0; i < 260; i++) {
    const d = document.createElement('i');
    const x = (i % 20) / 19, y = Math.floor(i / 20) / 12;
    d.style.left = (x * 100) + '%';
    d.style.top = (y * 100) + '%';
    d.dataset.delay = (x + y) * 620;      // 对角扩散：越靠右下越晚
    dots.appendChild(d);
  }
  $('#f4').appendChild(dots);

  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) en.target.classList.add('is-in');
    });
  }, { threshold: 0.35 });
  $$('.feat').forEach(s => io.observe(s));

  // 点阵对角扩散的逐点入场
  const dotEls = Array.from(dots.children);
  setInterval(() => {
    if (!$('#f4').classList.contains('is-in')) return;
    dotEls.forEach(d => {
      const on = Math.random() < 0.06;
      d.style.transition = 'opacity 900ms cubic-bezier(.22,1,.36,1)';
      d.style.opacity = on ? '0.5' : '0';
    });
  }, REDUCED ? 4000 : 900);
})();

/* 02 · 四步进度条 */
function updateSteps(p) {
  const n = $$('.step').length;
  const t = clamp(p * n, 0, n);
  $$('.step').forEach((el, i) => el.classList.toggle('is-on', i < Math.ceil(t - 0.001) || (i < t)));
}

/* 08 · 手电筒 + 逐词提亮 */
(() => {
  const sec = $('#s08');
  const copy = sec.querySelector('.privacy__copy');
  // 把文字拆成词，便于按圆覆盖范围点亮
  copy.querySelectorAll('h2,p').forEach(node => {
    const words = node.textContent.trim().split(/\s+/);
    node.innerHTML = words.map(w => `<span class="tw">${w}</span>`).join(' ');
  });
  const words = Array.from(copy.querySelectorAll('.tw'));

  addEventListener('pointermove', e => { state.pointer.x = e.clientX; state.pointer.y = e.clientY; }, { passive: true });
  addEventListener('touchmove', e => {
    if (e.touches[0]) { state.pointer.x = e.touches[0].clientX; state.pointer.y = e.touches[0].clientY; }
  }, { passive: true });

  const torch = sec.querySelector('.torch');
  const R = 240;
  sec.__torch = () => {
    const r = sec.getBoundingClientRect();
    const inside = r.top < innerHeight * 0.55 && r.bottom > innerHeight * 0.45;
    sec.classList.toggle('is-torch', inside && !REDUCED);
    if (!inside || REDUCED) return;
    // torch 是 section 内的 absolute 元素：必须换算成 section 局部坐标
    torch.style.left = (state.pointer.x - r.left) + 'px';
    torch.style.top = (state.pointer.y - r.top) + 'px';
    words.forEach(w => {
      const b = w.getBoundingClientRect();
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const d = Math.hypot(cx - state.pointer.x, cy - state.pointer.y);
      w.classList.toggle('lit', d < R * 0.72);
    });
  };
})();

/* 09 · 可拖拽标题：相邻字按距离衰减跟随，松手弹回 */
(() => {
  const el = $('.draggable');
  const text = el.dataset.drag || '';
  el.innerHTML = Array.from(text).map(c => `<i>${c === ' ' ? '&nbsp;' : c}</i>`).join('');
  const chars = Array.from(el.children);
  const base = chars.map(c => c.getBoundingClientRect());
  let drag = -1, startX = 0, startY = 0, dx = 0, dy = 0, released = 0;

  const setOffsets = (mx, my, amt) => {
    chars.forEach((c, i) => {
      const b = base[i];
      const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
      const d = Math.hypot(cx - mx, cy - my);
      const falloff = Math.exp(-d / 190);          // 距离衰减
      c.style.transform = `translate(${mouseDx * falloff * amt}px, ${mouseDy * falloff * amt}px)`;
    });
  };
  let mouseDx = 0, mouseDy = 0;

  const down = e => {
    drag = 0; startX = e.clientX; startY = e.clientY;
    el.classList.add('is-dragging');
    chars.forEach((c, i) => { base[i] = c.getBoundingClientRect(); });
    el.setPointerCapture?.(e.pointerId);
  };
  const move = e => {
    if (drag !== 0) return;
    mouseDx = e.clientX - startX;
    mouseDy = e.clientY - startY;
    setOffsets(e.clientX, e.clientY, 1);
  };
  const up = () => {
    if (drag !== 0) return;
    drag = -1; released = performance.now();
    el.classList.remove('is-dragging');
  };
  el.addEventListener('pointerdown', down);
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);

  // 松手后弹回
  el.__springBack = () => {
    if (drag === 0 || released === 0) return;
    mouseDx *= 0.86; mouseDy *= 0.86;
    chars.forEach(c => { c.style.transform = `translate(${mouseDx}px, ${mouseDy}px)`; });
    if (Math.abs(mouseDx) < 0.2 && Math.abs(mouseDy) < 0.2) released = 0;
  };
})();

/* 03 · 背景短词水平漂浮 */
let driftWords = [];
(() => {
  const spans = $$('.driftfield span');
  spans.forEach((s, i) => {
    s.style.left = (6 + (i * 7.6) % 88) + '%';
    s.style.top = (8 + (i * 13.3) % 84) + '%';
    s.dataset.base = String(i * 0.7);
  });
  driftWords = spans;
})();

/* ─────────────────────────── 4 · 每帧应用滚动 ───────────────────── */

function applyScroll() {
  const P = state.progress;

  /* 明暗：01 是浅色开场，**02 是全站唯一一次明暗切换**，之后一路暗到收尾。
     这是叙事转折点，不是装饰 —— 所以不做来回反转。 */
  const dark = (state.sectionP['#s02'] ?? 0) > 0.25;
  if (dark !== state.dark) {
    state.dark = dark;
    document.body.classList.toggle('is-dark', dark);
    cloudMat.color.set(dark ? 0xf5f2ee : 0x1a1712);
  }

  /* 01 / 02 · 手机 */
  const p1 = state.sectionP['#s01'] ?? 0;
  const p2 = state.sectionP['#s02'] ?? 0;
  const p3 = state.sectionP['#s03'] ?? 0;
  const p4 = state.sectionP['#s04'] ?? 0;
  const split = smooth(clamp(p2 * 1.6, 0, 1));      // 分裂进度
  const spread = split * 2.55;
  phones.forEach((g, i) => {
    const off = (i - 1) * spread;
    g.position.set(off, 0, -Math.abs(i - 1) * 0.35 * split);
    g.rotation.y = lerp(-0.52, 0.42, smooth(p1)) + (i - 1) * 0.16 * split;
    g.rotation.x = lerp(0.06, -0.04, p1) - 0.02;
    const s = 1 - Math.abs(i - 1) * 0.06 * split;
    g.scale.setScalar(s);
  });
  phoneGroup.rotation.y = 0;
  // 01: 手机在右，标题在左；02: 回到画面中心再分裂成三台
  phoneGroup.position.x = lerp(1.18, 0, smooth(clamp(p2 * 1.4, 0, 1)));
  phoneGroup.position.y = lerp(0.1, -0.05, smooth(p1));
  // 02 里把手机缩小并上移：三台并排后要给下方文案让出位置，否则压字
  const phoneScale = lerp(0.94, 0.76, smooth(clamp(p2 * 1.4, 0, 1)));
  phoneGroup.scale.setScalar(phoneScale);
  phoneGroup.position.y += 0.32 * smooth(clamp(p2 * 1.4, 0, 1));
  // 02 后段手机整体上滑离场：否则会和 03 的星云叠在同一处
  phoneGroup.position.y += 2.2 * smooth(clamp((p2 - 0.62) / 0.38, 0, 1));
  // 只有一个"手机"时把两侧藏起来
  const phoneVisible = p1 < 0.99 || p2 < 0.995;
  phoneGroup.visible = phoneVisible;
  if (split < 0.02) { phones[1].visible = false; phones[2].visible = false; }
  else { phones[1].visible = true; phones[2].visible = true; }

  updateSteps(p2);

  /* 03 / 04 · 星云 */
  const cloudVisible = p3 > 0.05 && p4 < 0.995;
  cloudGroup.visible = cloudVisible;
  if (cloudVisible) {
    // 形态在六个小物之间缓慢变形
    const cycle = (p3 * 1.35 + performance.now() * 0.000012);
    const idx = Math.floor(cycle) % cloudSets.length;
    const next = (idx + 1) % cloudSets.length;
    const t = smooth(cycle - Math.floor(cycle));
    const a = cloudSets[idx], b = cloudSets[next];
    const arr = cloudGeo.attributes.position.array;
    for (let i = 0; i < arr.length; i++) arr[i] = lerp(a[i], b[i], t);
    cloudGeo.attributes.position.needsUpdate = true;

    // 04 加速
    const accel = 1 + p4 * 26;
    state.cloudSpin += (0.0016 + (state.cloudDrag.dragging ? 0 : 0.0006)) * accel * (REDUCED ? 0 : 1);
    state.cloudSpin += state.cloudDrag.vx;
    state.cloudDrag.vx *= 0.92;
    cloudGroup.rotation.y = state.cloudSpin;
    cloudGroup.position.y = lerp(0.2, -0.1, p3);

    // 04 后段：整屏黑场，导语从黑里显现
    const fadeOut = clamp((p4 - 0.55) / 0.35, 0, 1);   // 04 后段黑场
    const fadeIn = clamp(p3 / 0.15, 0, 1);              // 03 开头淡入
    cloudMat.opacity = 0.9 * fadeIn * (1 - fadeOut);
    cloudMat.size = lerp(0.045, 0.03, fadeOut);
  }
  $('#s03').querySelector('.cloudhint')?.classList.toggle('is-on', p3 > 0.12 && p3 < 0.85);

  /* 03 · 短词随滚动水平漂移 */
  if (driftWords.length) {
    const y = state.scroll;
    driftWords.forEach((el, i) => {
      const sp = 0.06 + (i % 5) * 0.035;
      el.style.transform = `translateX(${((i % 2 ? -1 : 1) * (y * sp + i * 40)) % 900}px)`;
    });
  }

  /* 05 · 逐词点亮 */
  const p5 = state.sectionP['#s05'] ?? 0;
  const wl = $('.wordlight');
  if (wl) {
    const n = wl.children.length;
    const lit = Math.round(clamp(p5 * 1.35, 0, 1) * n);
    Array.from(wl.children).forEach((w, i) => w.classList.toggle('is-on', i < lit));
  }

  /* 06 · 逐字解码 */
  const p2f = state.sectionP['#f2'] ?? 0;
  const dec = $('[data-decode]');
  if (dec) {
    const full = dec.dataset.full || (dec.dataset.full = dec.dataset.decode);
    const k = Math.round(clamp(p2f * 2.2, 0, 1) * full.length);
    const glyphs = '01#%&@$*+=<>/\\|';
    dec.textContent = full.slice(0, k) + Array.from(full.slice(k))
      .map(() => glyphs[(Math.random() * glyphs.length) | 0]).join('');
  }

  /* 09 · 点阵底 */
  const p9 = state.sectionP['#s09'] ?? 0;
  pixelScene.userData.material.opacity = clamp((p9 - 0.1) * 1.2, 0, 0.5);

  /* 08 · 手电筒 */
  $('#s08').__torch?.();

  /* 09 · 弹回 */
  $('.draggable').__springBack?.();
}

// 调试：把关键运行时数值暴露到 <html data-dbg>，无头验证时 --dump-dom 可读。
// 只在 ?dbg=1 时开启 —— 生产环境不该为验证付这份开销。
if (new URLSearchParams(location.search).get('dbg') === '1') {
  const el = document.documentElement;
  const origApply = applyScroll;
  window.__dbg = true;
  setInterval(() => {
    el.dataset.dbg = JSON.stringify({
      P: +state.progress.toFixed(3),
      dark: state.dark,
      phone: phoneGroup.visible,
      cloud: cloudGroup.visible,
      cloudOp: +cloudMat.opacity.toFixed(3),
      cloudSize: +cloudMat.size.toFixed(4),
      sec: Object.fromEntries(Object.entries(state.sectionP).map(([k, v]) => [k, +v.toFixed(2)])),
      sets: cloudSets.map(st => {
        let mx = 0, nz = 0;
        for (let i = 0; i < st.length; i += 3) { mx = Math.max(mx, Math.abs(st[i]), Math.abs(st[i + 1])); if (st[i] || st[i + 1]) nz++; }
        return [+mx.toFixed(2), nz];
      }),
      camZ: camera.position.z,
      bg: getComputedStyle(document.body).backgroundColor,
      frames: window.__frames || 0,
      canvasPx: (() => { try { const gl = renderer.getContext(); const a = new Uint8Array(4); gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, a); return Array.from(a); } catch (e) { return 'err'; } })(),
      scrollH: document.body.scrollHeight,
      innerH: innerHeight,
    });
  }, 200);
}

/* ─────────────────────────── 5 · 渲染循环 ──────────────────────── */

let lastT = performance.now();
function frame(t) {
  window.__frames = (window.__frames || 0) + 1;
  const dt = Math.min(50, t - lastT); lastT = t;

  // 手机缓慢自转，让"可转动"这件事一眼看得出来
  if (phoneGroup.visible && !REDUCED) {
    phoneGroup.rotation.z = Math.sin(t * 0.00022) * 0.012;
  }

  renderer.clear();
  if (phoneGroup.visible) renderer.render(phoneScene, camera);
  if (cloudGroup.visible) renderer.render(cloudScene, camera);
  if (pixelScene.userData.material.opacity > 0.005) renderer.render(pixelScene, camera);

  requestAnimationFrame(frame);
}

/* ─────────────────────────── 6 · 启动 ─────────────────────────── */

function resize() {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
  measure();
  onScroll();
}
addEventListener('resize', resize);
addEventListener('scroll', onScroll, { passive: true });

measure();
// 首帧前先定明暗：CSS 有 650ms 过渡，如果等第一次 applyScroll 才切，
// 截图/首屏会停在浅灰与黑之间的中间色上
{
  const p = clamp(state.scroll / state.spans.doc.end, 0, 1);
  state.dark = (state.sectionP['#s02'] ?? 0) > 0.25;
  document.body.classList.toggle('is-dark', state.dark);
}
onScroll();

// ?p=0.42 直接跳到整页进度的某个位置（供无头截图逐段验证）
const qp = new URLSearchParams(location.search).get('p');
if (qp !== null) {
  const target = clamp(parseFloat(qp) || 0, 0, 1) * state.spans.doc.end;
  window.scrollTo(0, target);
  state.scroll = window.scrollY;
  state.progress = clamp(state.scroll / state.spans.doc.end, 0, 1);
  for (const [id, s] of Object.entries(state.spans)) {
    if (id !== 'doc') state.sectionP[id] = inSpan(state.scroll, s);
  }
  requestAnimationFrame(() => { applyScroll(); applyScroll(); });
}

requestAnimationFrame(frame);

// 供验证脚本确认"确实跑起来了"
window.__LAUNCH_READY__ = true;
