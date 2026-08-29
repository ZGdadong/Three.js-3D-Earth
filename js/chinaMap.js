// ============================================================================
//  ChinaMap —— 展平 3D 中国地图（省市下钻）
//  参考：
//   - cnblogs.com/tiandi/p/18522344 （GeoJSON 挤出式中国地图 + 下钻 + 渐变发光 + 悬浮）
//   - github.com/zhanghang2017/threemap （行政区域拉伸、边界线、钻入下一级）
//
//  视觉：
//   - 区域用"渐变 + 发光"的自定义 ShaderMaterial（底部深蓝 → 顶部青蓝）。
//   - 每个区域中心不常显地名，悬停时上浮 + 高亮 + 显示名称。
//   - 底部：发光渐变圆盘 + 栅格 + 两圈"可带缺口"的旋转圆环。
//   - 全图有一道从下到上的"扫描能量波"（类似地球护罩），可设参数。
//
//  独立于地球场景：自己有 scene / camera / controls，由 main.js 在 "china" 模式渲染。
// ============================================================================

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { t } from "./i18n.js";

const D2R = Math.PI / 180;
const degToRad = THREE.MathUtils.degToRad;

// 中国地形的参考地理包围盒（Mercator 原始坐标系），用于把地形贴图对齐到地图
const CHINA_RX_MIN = 1.2828581027197166;
const CHINA_RX_MAX = 2.357864246687728;
const CHINA_RY_MIN = 0.0667837005400493;
const CHINA_RY_MAX = 1.111276654322306;

function rawX(lon) {
  return lon * D2R;
}
function rawY(lat) {
  return Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2));
}

function eachPolygon(geometry, cb) {
  const coords = geometry.coordinates;
  if (geometry.type === "Polygon") {
    cb(coords);
  } else if (geometry.type === "MultiPolygon") {
    coords.forEach(cb);
  }
}

function makeProjection(features, S = 10) {
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  features.forEach((f) => {
    eachPolygon(f.geometry, (rings) => {
      rings.forEach((ring) => {
        ring.forEach((pt) => {
          const x = rawX(pt[0]);
          const y = rawY(pt[1]);
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        });
      });
    });
  });
  const w = maxX - minX;
  const h = maxY - minY;
  const scale = S / Math.max(w, h || 1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const proj = function proj(lon, lat) {
    return [(rawX(lon) - cx) * scale, (rawY(lat) - cy) * scale];
  };
  proj.cx = cx;
  proj.cy = cy;
  proj.scale = scale;
  return proj;
}

function hasLocalData(code) {
  return code && /^\d{6}$/.test(String(code));
}

// ---- 区域顶面材质：深蓝基调 + 地形贴图(山/河) + 辉光 + 扫描波 + 悬停变亮 ----
function createTopMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(0x1d4e89) },
      uGlow: { value: new THREE.Color(0x4fc3ff) },
      uHover: { value: 0 },
      uGlowAmount: { value: 0.4 },
      uScan: { value: 0 },
      uScanWidth: { value: 0.5 },
      uScanColor: { value: new THREE.Color(0x57e0ff) },
      uScanIntensity: { value: 0 },
      uTerrain: { value: 0.85 }, // 地形贴图强度
      uTex: { value: null }, // 地形贴图
      uUvScale: { value: new THREE.Vector2(1, 1) },
      uUvOffset: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uGlow;
      uniform float uHover;
      uniform float uGlowAmount;
      uniform float uScan;
      uniform float uScanWidth;
      uniform vec3 uScanColor;
      uniform float uScanIntensity;
      uniform float uTerrain;
      uniform sampler2D uTex;
      uniform vec2 uUvScale;
      uniform vec2 uUvOffset;
      varying vec3 vWorldPos;
      varying vec2 vUv;
      void main() {
        vec3 col = mix(uColor, uGlow, uGlowAmount * 0.55);
        // 地形贴图（山/河）：按灰度做明暗，叠加到区域上
        vec3 relief = texture2D(uTex, vUv * uUvScale + uUvOffset).rgb;
        col *= mix(vec3(1.0), relief, uTerrain);
        // 悬停：提亮 + 加青光，但保留地形纹理（不要整片盖成纯色）
        col = col * (1.0 + uHover * 0.3) + uGlow * uHover * 0.5;
        float d = abs(vWorldPos.z - uScan);
        float scan = exp(-pow(d / uScanWidth, 2.0));
        col += uScanColor * scan * uScanIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ---- 区域侧面材质：底部深蓝 → 顶部青蓝渐变 + 整图扫描波 + 悬停增亮(保留渐变) + 侧面扫描 ----
function createSideMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uBase: { value: new THREE.Color(0x0a2140) },
      uTop: { value: new THREE.Color(0x2f86c8) },
      uHover: { value: new THREE.Color(0x6fd6ff) },
      uH: { value: 0 },
      uScan: { value: 0 },
      uScanWidth: { value: 0.5 },
      uScanColor: { value: new THREE.Color(0x57e0ff) },
      uScanIntensity: { value: 0 },
      uSideScan: { value: 0 },
      uSideScanWidth: { value: 0.08 },
      uSideScanColor: { value: new THREE.Color(0x4fd0ff) },
      uSideScanIntensity: { value: 0 },
      uDepth: { value: 0.35 }, // 挤出厚度（块的高度），用于按高度归一化渐变
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vWorldPos;
      void main() {
        vPos = position;
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uBase;
      uniform vec3 uTop;
      uniform vec3 uHover;
      uniform float uH;
      uniform float uScan;
      uniform float uScanWidth;
      uniform vec3 uScanColor;
      uniform float uScanIntensity;
      uniform float uSideScan;
      uniform float uSideScanWidth;
      uniform vec3 uSideScanColor;
      uniform float uSideScanIntensity;
      uniform float uDepth;
      varying vec3 vPos;
      varying vec3 vWorldPos;
      void main() {
        float h = clamp(vPos.z / max(uDepth, 0.0001), 0.0, 1.0);
        // 底部深、顶部亮的垂直渐变（悬停时越靠顶部越亮，底部保持沉底的深色）
        vec3 col = mix(uBase, uTop, h * h);
        col = mix(col, uHover, uH * h);
        // 整图扫描波（沿世界 Z，从下到上扫过）
        float d = abs(vWorldPos.z - uScan);
        float scan = exp(-pow(d / uScanWidth, 2.0));
        col += uScanColor * scan * uScanIntensity;
        // 侧面扫描波（沿高度 vPos.z，从底到顶扫过）
        float sd = abs(vPos.z - uSideScan);
        float sideScan = exp(-pow(sd / uSideScanWidth, 2.0));
        col += uSideScanColor * sideScan * uSideScanIntensity;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
}

// ---- 单个圆环（带 N 个均匀分布缺口），半径为 radius，铺在 XZ 平面 ----
function buildRingMesh(cfg, radius) {
  const halfW = cfg.width / 2;
  const inner = Math.max(0.02, radius - halfW);
  const outer = radius + halfW;
  // 等分份数 = 缺口数量：把圆环分成 n 段，每段边界处留一个缺口
  const n = Math.max(1, Math.round(cfg.gapCount || 1));
  const slot = 360 / n; // 每段的角度
  const gapDeg = Math.max(1, Math.min(cfg.gap || 30, slot - 1)); // 单个缺口大小（度）
  const arc = slot - gapDeg; // 每段实际绘制的角度
  const mat = new THREE.MeshBasicMaterial({
    color: cfg.color,
    transparent: true,
    opacity: cfg.opacity,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  // n 段弧拼成一整圈，段与段之间就是均匀分布的缺口
  const group = new THREE.Group();
  for (let i = 0; i < n; i++) {
    const thetaStart = degToRad(i * slot);
    const geo = new THREE.RingGeometry(inner, outer, 160, 1, thetaStart, degToRad(arc));
    const m = new THREE.Mesh(geo, mat);
    group.add(m);
  }
  group.rotation.x = -Math.PI / 2;
  group.userData.material = mat; // 供 update() 更新颜色/透明度
  return group;
}

// ---- 发光渐变圆盘 ----
function makeGlowDisc(size, color) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * 64;
  const c = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const grad = c.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  grad.addColorStop(0, color);
  grad.addColorStop(0.55, "rgba(30,90,150,0.28)");
  grad.addColorStop(1, "rgba(6,16,32,0)");
  c.fillStyle = grad;
  c.fillRect(0, 0, w, h);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(size, size),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
}

// ---- 底部台面：发光渐变圆盘 + 栅格 + 两个圆环支架 ----
function makeFloor() {
  const group = new THREE.Group();

  const disc = makeGlowDisc(20, "rgba(40,130,210,0.5)");
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.02;
  group.add(disc);

  const grid = new THREE.GridHelper(20, 20, 0x2a6ea0, 0x1a4a70);
  grid.position.y = -0.005;
  const gridMats = Array.isArray(grid.material) ? grid.material : [grid.material];
  gridMats.forEach((m) => {
    m.transparent = true;
    m.opacity = 0.28;
    m.blending = THREE.AdditiveBlending;
    m.depthWrite = false;
  });
  group.add(grid);

  // 两个圆环支架（各自绕 Y 轴旋转）
  const holderA = new THREE.Group();
  const holderB = new THREE.Group();
  group.add(holderA, holderB);

  return { group, ringHolders: [holderA, holderB] };
}

export function createChinaMap({ container, rendererDom, width, height }) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x050a18);

  const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000);
  camera.position.set(0, 7, 10);
  camera.lookAt(0, 0, 0);
  camera.up.set(0, 1, 0);

  const controls = new OrbitControls(camera, rendererDom);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 4;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI / 2 - 0.05;
  controls.minPolarAngle = 0.15;
  controls.target.set(0, 0, 0);
  controls.enabled = false;

  const root = new THREE.Group();
  scene.add(root);

  // ---- 层级切换过渡：缩小旧图 + 云层从中间散开 + 放大新图 ----
  let mapCenter = new THREE.Vector3(0, 0, 0);
  let mapScale = 1;
  let transition = null; // { t, target:{features,levelName,adcode,name}, swapped }
  const TRANS_SHRINK = 0.45; // 旧图缩小用时（秒）
  const TRANS_GROW = 0.95; // 新图放大用时（秒）
  const TRANS_MIN_SCALE = 0.22; // 过渡过程中最小的地图缩放

  const CLOUD_FILES = ["./images/cloud1.png", "./images/cloud2.png", "./images/cloud3.png", "./images/cloud4.png"];
  let cloudOverlay = null;
  let cloudEls = [];
  let cloudStrip = null; // 更宽的云带容器，整体从右往左滑动以覆盖全屏

  function easeOutCubic(x) {
    return 1 - Math.pow(1 - x, 3);
  }
  // 改变整张地图的缩放（围绕地图中心缩放，保证视觉中心不动）
  function setMapScale(s) {
    mapScale = s;
    root.scale.setScalar(s);
    root.position.set(-mapCenter.x * s, 0, -mapCenter.z * s);
  }
  function ensureCloudOverlay() {
    if (cloudOverlay) return cloudOverlay;
    cloudOverlay = document.createElement("div");
    cloudOverlay.id = "chinaCloudOverlay";
    cloudOverlay.style.cssText =
      "position:fixed;inset:0;overflow:hidden;pointer-events:none;z-index:6;";
    document.body.appendChild(cloudOverlay);
    return cloudOverlay;
  }
  // 铺满全屏的云带：把多朵云铺成一条比视口更宽的横带（同一种图片可出现多次），
  // 过渡时整条带子从右往左滑过，始终盖住屏幕，最后淡出露出新图。
  function spawnClouds() {
    const ov = ensureCloudOverlay();
    ov.innerHTML = "";
    const strip = document.createElement("div");
    strip.id = "chinaCloudStrip";
    strip.style.cssText =
      "position:absolute;top:0;left:0;width:300vw;height:100vh;will-change:transform;";
    ov.appendChild(strip);
    cloudStrip = strip;
    cloudEls = [];
    const rows = [12, 45, 78]; // 三行，竖向铺满
    const cols = 8;
    const colSpacing = 40;
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < cols; c++) {
        const el = document.createElement("div");
        const img = CLOUD_FILES[(r * cols + c) % CLOUD_FILES.length];
        const size = 32 + Math.random() * 12; // 每朵云宽（相对视口）
        const x = c * colSpacing + (Math.random() * 10 - 5);
        const y = rows[r] + (Math.random() * 8 - 4);
        el.style.cssText =
          `position:absolute;left:${x}vw;top:${y}vh;width:${size}vw;aspect-ratio:1.6;` +
          `background-image:url('${img}');background-size:contain;background-repeat:no-repeat;` +
          `opacity:0;pointer-events:none;` +
          `filter:drop-shadow(0 10px 28px rgba(120,200,255,.4));`;
        strip.appendChild(el);
        cloudEls.push(el);
      }
    }
  }
  function hideClouds() {
    if (cloudOverlay) cloudOverlay.innerHTML = "";
    cloudEls = [];
    cloudStrip = null;
  }
  // p: 整段过渡进度 0..1；云带从右往左线性滑过（覆盖全屏），头尾淡入淡出
  function updateClouds(p) {
    if (!cloudStrip) return;
    const appear = Math.min(p / 0.28, 1); // 前 28% 淡入
    const fade = p > 0.72 ? 1 - (p - 0.72) / 0.28 : 1; // 后 28% 淡出
    const op = Math.max(0, Math.min(appear, fade)) * 0.95;
    const slide = Math.min(p, 1) * 70; // 线性向左滑动的距离（vw），右→左
    cloudStrip.style.transform = `translateX(-${slide}vw)`;
    for (const el of cloudEls) el.style.opacity = op;
  }
  // 开始一次层级切换：先缩小当前图，再让云带从右往左滑过（铺满屏幕），最后放大新层级
  function startTransition(target) {
    if (!target) return;
    transition = { t: 0, target, swapped: false };
    spawnClouds();
  }

  // ---- 地形贴图（山/河）：中国灰度地形（可着色）----
  const terrainTex = new THREE.TextureLoader().load("./images/china_terrain.png");
  terrainTex.colorSpace = THREE.SRGBColorSpace;
  terrainTex.anisotropy = 4;
  terrainTex.magFilter = THREE.LinearFilter;
  terrainTex.minFilter = THREE.LinearMipmapLinearFilter;

  // ---- 可调参数（供 lil-gui 面板）----
  const chinaParams = {
    // 显示
    glow: 0.4,
    float: 0.24,
    terrain: true,
    terrainAmount: 0.85,
    depth: 0.35, // 挤出厚度（块的高度）
    bevel: 0.06, // 轮廓放大（倒角），越小块越接近真实面积
    // 两圈旋转圆环（各自独立设置）
    ring1: {
      visible: true,
      color: "#3fd0ff",
      opacity: 0.72,
      width: 0.28,
      gapCount: 3, // 等分份数 = 缺口数量：3 = 每 1/3 有一个缺口
      gap: 55, // 单个缺口大小（度）
      speed: 0.45,
    },
    ring2: {
      visible: true,
      color: "#2fb9e8",
      opacity: 0.55,
      width: 0.2,
      gapCount: 4, // 每 1/4 有一个缺口
      gap: 40,
      speed: 0.3,
    },
    // 整图扫描能量波（从下到上扫过）
    scanOn: true,
    scanSpeed: 0.25,
    scanWidth: 0.5,
    scanIntensity: 0.7,
    scanColor: "#57e0ff",
    // 侧面扫描波（沿挤出块高度从底到顶）
    sideScanOn: true,
    sideScanSpeed: 0.5,
    sideScanWidth: 0.08,
    sideScanIntensity: 0.9,
    sideScanColor: "#4fd0ff",
  };

  // ---- 参数持久化（保存 / 载入 / 恢复默认 / 导出 / 导入 JSON）----
  const CHINA_PARAMS_KEY = "china_params_v1";
  const CHINA_PARAM_KEYS = [
    "glow", "float", "terrain", "terrainAmount", "depth", "bevel",
    "ring1", "ring2",
    "scanOn", "scanSpeed", "scanWidth", "scanIntensity", "scanColor",
    "sideScanOn", "sideScanSpeed", "sideScanWidth", "sideScanIntensity", "sideScanColor",
  ];
  const CHINA_DEFAULT_PARAMS = JSON.parse(JSON.stringify(chinaParams)); // 默认值深拷贝快照

  // 把一份数据应用进 chinaParams。嵌套的 ring1/ring2 必须“就地改属性”，
  // 因为 lil-gui 控件绑定的是创建时的对象引用，直接替换对象会导致控件失效。
  function assignChinaParams(data) {
    for (const k of CHINA_PARAM_KEYS) {
      if (!(k in data)) continue;
      if (k === "ring1" || k === "ring2") {
        const d = data[k];
        if (d && typeof d === "object") for (const kk of Object.keys(d)) chinaParams[k][kk] = d[kk];
      } else {
        chinaParams[k] = data[k];
      }
    }
  }

  function collectChinaParams() {
    const data = {};
    for (const k of CHINA_PARAM_KEYS) data[k] = chinaParams[k];
    return data;
  }
  function saveChinaParams() {
    localStorage.setItem(CHINA_PARAMS_KEY, JSON.stringify(collectChinaParams()));
    showToast(t("toast.saved"));
  }
  function loadChinaParams() {
    const raw = localStorage.getItem(CHINA_PARAMS_KEY);
    if (!raw) {
      showToast(t("toast.noParams"));
      return;
    }
    try {
      assignChinaParams(JSON.parse(raw));
    } catch (e) {
      showToast(t("toast.loadFailed"));
      return;
    }
    if (chinaGui) chinaGui.controllersRecursive().forEach((c) => c.updateDisplay());
    rebuildLevel(); // 恢复的 depth/bevel 需重建几何
    showToast(t("toast.loaded"));
  }
  function resetChinaParams() {
    assignChinaParams(CHINA_DEFAULT_PARAMS);
    if (chinaGui) chinaGui.controllersRecursive().forEach((c) => c.updateDisplay());
    rebuildLevel();
    showToast(t("toast.resetDone"));
  }
  function exportChinaParams() {
    const blob = new Blob([JSON.stringify(collectChinaParams(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "china_params.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast(t("toast.exported"));
  }
  function importChinaParams() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      if (!file) {
        input.remove();
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          let count = 0;
          for (const k of CHINA_PARAM_KEYS) if (k in data) count++;
          assignChinaParams(data);
          if (chinaGui) chinaGui.controllersRecursive().forEach((c) => c.updateDisplay());
          rebuildLevel();
          showToast(t("toast.imported", { count }));
        } catch (e) {
          showToast(t("toast.importFailed"));
        } finally {
          input.remove();
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // 挂到 chinaParams 生成 lil-gui 按钮
  chinaParams.save = saveChinaParams;
  chinaParams.load = loadChinaParams;
  chinaParams.reset = resetChinaParams;
  chinaParams.export = exportChinaParams;
  chinaParams.import = importChinaParams;

  // 静默恢复上次保存（不弹提示；GUI 与几何在进入中国地图时自然使用这些值）
  try {
    const raw = localStorage.getItem(CHINA_PARAMS_KEY);
    if (raw) assignChinaParams(JSON.parse(raw));
  } catch (e) {
    /* ignore */
  }

  // ---- 底部台面 ----
  const floor = makeFloor();
  scene.add(floor.group);

  let ringMeshes = [];
  const RING_RADII = [5.6, 6.4]; // 内圈 / 外圈半径
  function disposeRingGroup(g) {
    g.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    const mat = g.userData.material; // 一圈里的所有段共享同一材质
    if (mat) mat.dispose();
  }
  function applyRings() {
    ringMeshes.forEach((g) => disposeRingGroup(g));
    // 先从支架上移除旧圆环
    floor.ringHolders.forEach((h) => {
      while (h.children.length) h.remove(h.children[0]);
    });
    ringMeshes = [];
    const cfgs = [chinaParams.ring1, chinaParams.ring2];
    cfgs.forEach((cfg, i) => {
      const g = buildRingMesh(cfg, RING_RADII[i]);
      g.position.y = 0.02;
      floor.ringHolders[i].add(g);
      ringMeshes.push(g);
    });
  }
  applyRings();

  // ---- 中国地图专属 lil-gui 面板 ----
  let chinaGui = null;
  function buildChinaGui() {
    if (chinaGui) chinaGui.destroy();
    chinaGui = new GUI({ title: t("china.guiTitle") });
    chinaGui.domElement.classList.add("china-gui");
    const fView = chinaGui.addFolder(t("china.folderView"));
    fView.add(chinaParams, "glow", 0, 1, 0.02).name(t("china.glow"));
    fView.add(chinaParams, "float", 0, 0.6, 0.02).name(t("china.float"));
    fView.add(chinaParams, "terrain", true).name(t("china.terrain"));
    fView.add(chinaParams, "terrainAmount", 0, 1, 0.02).name(t("china.terrainAmount"));
    fView
      .add(chinaParams, "depth", 0.05, 0.8, 0.01)
      .name(t("china.depth"))
      .onFinishChange(() => rebuildLevel());
    fView
      .add(chinaParams, "bevel", 0, 0.2, 0.005)
      .name(t("china.bevel"))
      .onFinishChange(() => rebuildLevel());

    const fRing = chinaGui.addFolder(t("china.folderRing"));
    const ringCfgs = [chinaParams.ring1, chinaParams.ring2];
    ringCfgs.forEach((cfg, idx) => {
      const sub = fRing.addFolder(idx === 0 ? t("china.ring1") : t("china.ring2"));
      sub.add(cfg, "visible").name(t("china.ringVisible"));
      sub.addColor(cfg, "color").name(t("china.ringColor"));
      sub.add(cfg, "opacity", 0, 1, 0.01).name(t("china.ringOpacity"));
      sub.add(cfg, "width", 0.02, 1.5, 0.02).name(t("china.ringWidth"));
      sub.add(cfg, "gapCount", 1, 8, 1).name(t("china.ringGapCount"));
      sub.add(cfg, "gap", 1, 180, 1).name(t("china.ringGap"));
      sub.add(cfg, "speed", 0, 2, 0.05).name(t("china.ringSpeed"));
    });

    const fScan = chinaGui.addFolder(t("china.folderScan"));
    fScan.add(chinaParams, "scanOn", true).name(t("china.scanOn"));
    fScan.add(chinaParams, "scanSpeed", 0, 1, 0.01).name(t("china.scanSpeed"));
    fScan.add(chinaParams, "scanWidth", 0.05, 2, 0.05).name(t("china.scanWidth"));
    fScan.add(chinaParams, "scanIntensity", 0, 2, 0.05).name(t("china.scanIntensity"));
    fScan.addColor(chinaParams, "scanColor").name(t("china.scanColor"));
    fScan.add(chinaParams, "sideScanOn", true).name(t("china.sideScanOn"));
    fScan.add(chinaParams, "sideScanSpeed", 0, 1, 0.01).name(t("china.sideScanSpeed"));
    fScan.add(chinaParams, "sideScanWidth", 0.02, 0.5, 0.01).name(t("china.sideScanWidth"));
    fScan.add(chinaParams, "sideScanIntensity", 0, 2, 0.05).name(t("china.sideScanIntensity"));
    fScan.addColor(chinaParams, "sideScanColor").name(t("china.sideScanColor"));

    // 参数保存 / 载入 / 导入 / 恢复默认 / 导出（与地球一致）
    const fSave = chinaGui.addFolder(t("folder.save"));
    fSave.add(chinaParams, "save").name(t("param.save"));
    fSave.add(chinaParams, "load").name(t("param.load"));
    fSave.add(chinaParams, "import").name(t("param.import"));
    fSave.add(chinaParams, "reset").name(t("param.reset"));
    fSave.add(chinaParams, "export").name(t("param.export"));

    // 明确位置 / 层级，且显示与否由 active 控制（避免与语言条/地球面板重叠或遮住）
    chinaGui.domElement.style.position = "fixed";
    chinaGui.domElement.style.right = "12px";
    chinaGui.domElement.style.top = "70px";
    chinaGui.domElement.style.zIndex = "15";
    chinaGui.domElement.style.display = active ? "block" : "none";
    // 展开所有文件夹，确保参数可见
    if (chinaGui.foldersRecursive) {
      chinaGui.foldersRecursive().forEach((f) => f && f.open && f.open());
    }
  }

  // ---- 交互状态 ----
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  let active = false;
  let level = "nation";
  let currentAdcode = "100000";
  let currentName = "";
  let buildCtx = null; // 记录当前层级构建上下文，用于 depth/bevel 变化时重绘
  let currentZMin = -5,
    currentZMax = 5;
  let hovered = null;
  let downX = 0,
    downY = 0,
    downT = 0;
  let clickTimer = null;
  let scanPhase = 0;
  let sideScanPhase = 0;
  let lastRingKey = [chinaParams.ring1, chinaParams.ring2]
    .map((c) => `${c.width}|${c.gapCount}|${c.gap}`)
    .join(";");

  // ---- DOM ----
  const tooltip = document.createElement("div");
  tooltip.id = "chinaTooltip";
  tooltip.style.display = "none";
  document.body.appendChild(tooltip);

  const header = document.createElement("div");
  header.id = "chinaHeader";
  document.body.appendChild(header);

  const titleEl = document.createElement("span");
  titleEl.id = "chinaTitle";
  header.appendChild(titleEl);

  const backBtn = document.createElement("button");
  backBtn.id = "chinaBack";
  backBtn.textContent = t("china.back");
  backBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    goBack();
  });
  header.appendChild(backBtn);

  const loadingEl = document.createElement("div");
  loadingEl.id = "chinaLoading";
  loadingEl.textContent = t("china.loading");
  loadingEl.style.display = "none";
  document.body.appendChild(loadingEl);

  // ---- 数据 ----
  const cache = new Map();

  async function loadFeatures(adcode) {
    if (cache.has(adcode)) return cache.get(adcode);
    const url = `./data/geojson/${adcode}_full.json`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`GeoJSON 加载失败: ${adcode}`);
    const json = await resp.json();
    const features = (json.features || []).filter(
      (f) => f && f.properties && f.properties.adcode !== undefined && String(f.properties.adcode).indexOf("_JD") === -1,
    );
    cache.set(adcode, features);
    return features;
  }

  function clearRoot() {
    while (root.children.length) {
      const obj = root.children.pop();
      obj.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (Array.isArray(o.material)) o.material.forEach((mm) => mm.dispose());
          else o.material.dispose();
        }
      });
    }
    currentTopMats = [];
    currentSideMats = [];
    groups = [];
    hovered = null;
  }

  let currentTopMats = [];
  let currentSideMats = [];
  let groups = []; // 当前层级所有区域 group（用于平滑上浮/回落动画）

  // 地名 / 提示文案做多语言：优先复用现有 city.<名>（飞行线城市库，含各大省会/主要城市），
  // 其次 chinaProvince.<全名>；都无翻译则回退原名（专有名词兜底）。
  function tName(name) {
    if (!name) return name;
    const stripped = String(name).replace(/(特别行政区|自治区|自治州|自治县|地区|盟|省|市|州|县|区|旗)$/, "");
    const cv = t("city." + stripped);
    if (cv !== "city." + stripped) return cv;
    const pv = t("chinaProvince." + name);
    if (pv !== "chinaProvince." + name) return pv;
    if (stripped !== name) {
      const pv2 = t("chinaProvince." + stripped);
      if (pv2 !== "chinaProvince." + stripped) return pv2;
    }
    return name;
  }

  function makeDistrict(shape, topMat, sideMat) {
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: chinaParams.depth,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: chinaParams.bevel,
      bevelThickness: chinaParams.bevel,
      steps: 1,
    });
    const mesh = new THREE.Mesh(geo, [topMat, sideMat]);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  function makeBoundaryLine(rings, proj, height) {
    const group = new THREE.Group();
    rings.forEach((ring) => {
      const pts = [];
      ring.forEach((pt) => {
        const [x, y2] = proj(pt[0], pt[1]);
        pts.push(new THREE.Vector3(x, y2, height));
      });
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const line = new THREE.Line(
        g,
        new THREE.LineBasicMaterial({
          color: 0x6fe0ff,
          transparent: true,
          opacity: 0.95,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      line.rotation.x = -Math.PI / 2;
      line.raycast = () => {};
      group.add(line);
    });
    return group;
  }

  function buildLevel(features, levelName, adcode, name) {
    buildCtx = { features, levelName, adcode, name };
    clearRoot();
    const proj = makeProjection(features);
    const y = 0.45;
    const bounds = new THREE.Box3();
    scanPhase = 0;
    sideScanPhase = 0;

    features.forEach((f) => {
      const props = f.properties;
      const g = new THREE.Group();
      const topMat = createTopMaterial();
      const sideMat = createSideMaterial();
      sideMat.uniforms.uDepth.value = chinaParams.depth;
      topMat.uniforms.uGlowAmount.value = chinaParams.glow;
      // 地形贴图：绑定纹理并按当前投影把 shape 坐标映射到中国地形贴图
      topMat.uniforms.uTex.value = terrainTex;
      const uScaleX = 1 / (proj.scale * (CHINA_RX_MAX - CHINA_RX_MIN));
      const uOffsetX = (proj.cx - CHINA_RX_MIN) / (CHINA_RX_MAX - CHINA_RX_MIN);
      const uScaleY = 1 / (proj.scale * (CHINA_RY_MAX - CHINA_RY_MIN));
      const uOffsetY = (proj.cy - CHINA_RY_MIN) / (CHINA_RY_MAX - CHINA_RY_MIN);
      topMat.uniforms.uUvScale.value.set(uScaleX, uScaleY);
      topMat.uniforms.uUvOffset.value.set(uOffsetX, uOffsetY);
      topMat.uniforms.uTerrain.value = chinaParams.terrain ? chinaParams.terrainAmount : 0;
      g.userData = { name: props.name, adcode: props.adcode, level: levelName, topMat, sideMat, targetY: 0 };
      currentTopMats.push(topMat);
      currentSideMats.push(sideMat);
      groups.push(g);
      root.add(g);

      eachPolygon(f.geometry, (rings) => {
        rings.forEach((ring) => {
          if (ring.length < 4) return;
          const shape = new THREE.Shape();
          for (let i = 0; i < ring.length; i++) {
            const [x, y2] = proj(ring[i][0], ring[i][1]);
            if (i === 0) shape.moveTo(x, y2);
            else shape.lineTo(x, y2);
          }
          shape.closePath();
          const mesh = makeDistrict(shape, topMat, sideMat);
          mesh.userData.group = g;
          g.add(mesh);
          bounds.expandByObject(mesh);

          const lines = makeBoundaryLine([ring], proj, y);
          lines.userData.group = g;
          g.add(lines);
        });
      });
    });

    const center = bounds.getCenter(new THREE.Vector3());
    mapCenter.copy(center);
    root.scale.setScalar(1);
    root.position.set(-center.x, 0, -center.z);
    const finalBounds = new THREE.Box3().setFromObject(root);
    currentZMin = finalBounds.min.z;
    currentZMax = finalBounds.max.z;

    level = levelName;
    currentAdcode = adcode;
    currentName = name;
    const titleKey = levelName === "province" ? "china.titleProvince" : "china.titleNation";
    titleEl.textContent = t(titleKey).replace("{name}", tName(name || ""));
    backBtn.style.display = levelName === "nation" ? "none" : "";
    loadingEl.style.display = "none";
  }

  // 挤出厚度 / 轮廓放大变化时，重绘当前层级（Geometry 需重建）
  function rebuildLevel() {
    if (!buildCtx) return;
    buildLevel(buildCtx.features, buildCtx.levelName, buildCtx.adcode, buildCtx.name);
  }

  async function ensureNation() {
    const features = await loadFeatures("100000");
    buildLevel(features, "nation", "100000", t("china.nationName"));
  }

  async function drillInto(group) {
    const adcode = group.userData.adcode;
    const name = group.userData.name;
    if (!hasLocalData(adcode)) {
      showToast(t("china.noData").replace("{name}", name));
      return;
    }
    try {
      const features = await loadFeatures(adcode);
      if (!features.length) {
        showToast(t("china.noData").replace("{name}", name));
        return;
      }
      startTransition({ features, levelName: "province", adcode, name });
    } catch (err) {
      showToast(t("china.noData").replace("{name}", name));
    }
  }

  async function goBack() {
    if (level === "nation" || transition) return;
    try {
      const features = await loadFeatures("100000");
      startTransition({ features, levelName: "nation", adcode: "100000", name: t("china.nationName") });
    } catch (err) {
      showToast(t("china.noData").replace("{name}", ""));
    }
  }

  function showToast(msg) {
    const el = document.createElement("div");
    el.className = "chinaToast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => {
      el.classList.add("hide");
      setTimeout(() => el.remove(), 400);
    }, 1600);
  }

  // ---- 拾取 / 悬停 ----
  function pick(event) {
    const rect = rendererDom.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const hits = raycaster.intersectObjects(root.children, true);
    for (let i = 0; i < hits.length; i++) {
      const u = hits[i].object.userData;
      if (u && u.group) return u.group;
    }
    return null;
  }

  function setGroupHover(group, flag) {
    if (!group) return;
    group.userData.topMat.uniforms.uHover.value = flag;
    group.userData.sideMat.uniforms.uH.value = flag;
  }

  // 实际执行悬停切换（高亮 + 设定目标高度；高度由 update() 平滑逼近，约 1 秒到位）
  function applyHover(group) {
    if (group === hovered) return;
    if (hovered) {
      hovered.userData.targetY = 0;
      setGroupHover(hovered, 0);
    }
    hovered = group;
    if (group) {
      group.userData.targetY = chinaParams.float;
      setGroupHover(group, 1);
    }
  }

  function updateTooltip(group, ev) {
    tooltip.textContent = group ? tName(group.userData.name) : "";
    tooltip.style.display = group ? "block" : "none";
    if (group && ev) moveTooltip(ev);
  }

  function moveTooltip(ev) {
    tooltip.style.left = ev.clientX + 14 + "px";
    tooltip.style.top = ev.clientY + 14 + "px";
  }

  let hoverGraceTimer = null;
  const graceDelay = 90; // ms，防抖：跨区域时稍作停留再切换，避免高频上下跳动

  function onPointerMove(ev) {
    if (!active || transition) return;
    const g = pick(ev);
    updateTooltip(g, ev); // 工具提示即时跟随光标（显示当前区域名）
    clearTimeout(hoverGraceTimer);
    if (g === hovered) return; // 仍在同一区域，无需切换
    hoverGraceTimer = setTimeout(() => applyHover(g), graceDelay);
  }

  function onPointerDown(ev) {
    if (!active) return;
    if (ev.button === 0) {
      downX = ev.clientX;
      downY = ev.clientY;
      downT = Date.now();
    }
  }
  function onPointerUp(ev) {
    if (!active || transition || ev.button !== 0) return;
    const moved = Math.hypot(ev.clientX - downX, ev.clientY - downY);
    if (moved > 6 || Date.now() - downT > 500) return;
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      goBack();
      return;
    }
    const group = pick(ev);
    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (group) drillInto(group);
    }, 300);
  }
  function onPointerLeave() {
    clearTimeout(hoverGraceTimer);
    updateTooltip(null);
    hoverGraceTimer = setTimeout(() => applyHover(null), graceDelay);
  }

  // ---- 对外接口 ----
  function setActive(on) {
    active = on;
    if (on) {
      if (!chinaGui) buildChinaGui();
      chinaGui.domElement.style.display = "block";
      document.body.classList.add("china-mode");
      header.style.display = "";
      backBtn.style.display = level === "nation" ? "none" : "";
      titleEl.style.display = "";
      loadingEl.style.display = root.children.length === 0 ? "block" : "none";
      if (root.children.length === 0) {
        ensureNation().catch(() => {
          loadingEl.style.display = "none";
          showToast(t("china.noData").replace("{name}", ""));
        });
      }
      rendererDom.addEventListener("pointermove", onPointerMove);
      rendererDom.addEventListener("pointerdown", onPointerDown);
      rendererDom.addEventListener("pointerup", onPointerUp);
      rendererDom.addEventListener("pointerleave", onPointerLeave);
    } else {
      if (chinaGui) chinaGui.domElement.style.display = "none";
      if (transition) {
        hideClouds();
        transition = null;
        setMapScale(1);
      }
      clearTimeout(hoverGraceTimer);
      document.body.classList.remove("china-mode");
      header.style.display = "none";
      tooltip.style.display = "none";
      loadingEl.style.display = "none";
      applyHover(null); // 立即回落
      rendererDom.removeEventListener("pointermove", onPointerMove);
      rendererDom.removeEventListener("pointerdown", onPointerDown);
      rendererDom.removeEventListener("pointerup", onPointerUp);
      rendererDom.removeEventListener("pointerleave", onPointerLeave);
      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
      }
    }
  }

  function update(delta) {
    controls.update();

    // ---- 层级切换过渡：缩小旧图 → 云从中间散开 → 放大新图 ----
    if (transition) {
      transition.t += Math.min(delta, 0.05); // 钳制单帧步长，避免掉帧时跳过缩小段
      const t = transition.t;
      updateClouds(t / (TRANS_SHRINK + TRANS_GROW));
      if (t < TRANS_SHRINK) {
        // 缩小当前图（围绕中心）
        const k = easeOutCubic(t / TRANS_SHRINK);
        setMapScale(1 - k * (1 - TRANS_MIN_SCALE));
      } else {
        // 一次性切换到目标层级，并从小尺寸开始
        if (!transition.swapped) {
          transition.swapped = true;
          buildLevel(
            transition.target.features,
            transition.target.levelName,
            transition.target.adcode,
            transition.target.name,
          );
          setMapScale(TRANS_MIN_SCALE);
        }
        const gt = Math.min((t - TRANS_SHRINK) / TRANS_GROW, 1);
        setMapScale(TRANS_MIN_SCALE + (1 - TRANS_MIN_SCALE) * easeOutCubic(gt));
        if (gt >= 1) {
          setMapScale(1);
          hideClouds();
          transition = null;
        }
      }
    }

    // 平滑上浮 / 回落：约 1 秒逼近目标高度（指数缓动）
    const ease = 1 - Math.exp(-3.2 * Math.min(delta, 0.1));
    for (const g of groups) {
      const ty = g.userData.targetY;
      if (Math.abs(g.position.y - ty) > 0.0005) {
        g.position.y += (ty - g.position.y) * ease;
      }
    }

    // 辉光强度 + 地形强度
    const terrAmt = chinaParams.terrain ? chinaParams.terrainAmount : 0;
    for (const m of currentTopMats) {
      m.uniforms.uGlowAmount.value = chinaParams.glow;
      m.uniforms.uTerrain.value = terrAmt;
    }

    // ---- 扫描能量波（从下到上，带"扫动+空档"）----
    scanPhase += delta * chinaParams.scanSpeed;
    const period = 1;
    const dur = 0.72; // 扫动占周期的比例，剩余为空档
    const p = scanPhase % period;
    const sweep = Math.min(p / dur, 1);
    const scanZ = currentZMax - (currentZMax - currentZMin) * sweep; // 底部(zMax) -> 顶部(zMin)
    const fade = Math.min(0.2, dur * 0.25);
    const reveal = p < dur ? Math.min(p / fade, (dur - p) / fade, 1) : 0;
    const scanIntensity = chinaParams.scanOn ? chinaParams.scanIntensity * reveal : 0;
    for (const m of currentTopMats) {
      m.uniforms.uScan.value = scanZ;
      m.uniforms.uScanWidth.value = chinaParams.scanWidth;
      m.uniforms.uScanColor.value.set(chinaParams.scanColor);
      m.uniforms.uScanIntensity.value = scanIntensity;
    }
    for (const m of currentSideMats) {
      m.uniforms.uScan.value = scanZ;
      m.uniforms.uScanWidth.value = chinaParams.scanWidth;
      m.uniforms.uScanColor.value.set(chinaParams.scanColor);
      m.uniforms.uScanIntensity.value = scanIntensity;
    }

    // ---- 侧面扫描波（沿挤出块高度从底到顶）----
    sideScanPhase += delta * chinaParams.sideScanSpeed;
    const sp = sideScanPhase % period;
    const sSweep = Math.min(sp / dur, 1);
    const sideScanPos = chinaParams.depth * sSweep; // 底部 0 -> 顶部 depth
    const sReveal = sp < dur ? Math.min(sp / fade, (dur - sp) / fade, 1) : 0;
    const sideScanIntensity = chinaParams.sideScanOn ? chinaParams.sideScanIntensity * sReveal : 0;
    for (const m of currentSideMats) {
      m.uniforms.uSideScan.value = sideScanPos;
      m.uniforms.uSideScanWidth.value = chinaParams.sideScanWidth;
      m.uniforms.uSideScanColor.value.set(chinaParams.sideScanColor);
      m.uniforms.uSideScanIntensity.value = sideScanIntensity;
    }

    // ---- 旋转圆环（两圈各自独立设置）----
    const ringCfgs = [chinaParams.ring1, chinaParams.ring2];
    ringCfgs.forEach((cfg, i) => {
      // 内圈正向、外圈反向；每圈独立速度
      floor.ringHolders[i].rotation.y += delta * cfg.speed * (i === 0 ? 1 : -1);
    });
    // 颜色 / 透明度 / 显隐（无需重建）
    ringMeshes.forEach((g, i) => {
      const mat = g.userData.material;
      const cfg = ringCfgs[i];
      if (mat) {
        mat.color.set(cfg.color);
        mat.opacity = cfg.opacity;
      }
      g.visible = cfg.visible;
    });
    // 几何参数（宽度 / 等分份数 / 缺口大小）变化时重建
    const ringKey = ringCfgs.map((c) => `${c.width}|${c.gapCount}|${c.gap}`).join(";");
    if (ringKey !== lastRingKey) {
      lastRingKey = ringKey;
      applyRings();
    }
  }

  function refreshText() {
    backBtn.textContent = t("china.back");
    loadingEl.textContent = t("china.loading");
    if (level === "province") {
      titleEl.textContent = t("china.titleProvince").replace("{name}", currentName || "");
    } else {
      titleEl.textContent = t("china.titleNation");
    }
    if (chinaGui) buildChinaGui();
  }

  function setSize(w, h) {
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function dispose() {
    setActive(false);
    clearRoot();
    ringMeshes.forEach((m) => {
      m.geometry.dispose();
      m.material.dispose();
    });
    tooltip.remove();
    header.remove();
    loadingEl.remove();
    if (chinaGui) {
      chinaGui.destroy();
      chinaGui = null;
    }
    controls.dispose();
  }

  return {
    scene,
    camera,
    controls,
    root,
    setActive,
    update,
    setSize,
    dispose,
    refreshText,
    resetNation: ensureNation,
  };
}
