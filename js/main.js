// ============================================================================
//  Three.js 现实风格地球 —— 无月球与太阳（增强版）
//  参考自 xieyufei.com《Three.js 实现更真实的 3D 地球动态昼夜交替》
//
//  本版新增 / 改进：
//   1. lil-gui 参数面板：几乎一切参数都可在页面右侧实时调节
//   2. 法线贴图：叠加到光照上，让地形有立体起伏（尤其黄昏/黎明明显）
//   3. 时段化光照：正午亮、黄昏/黎明带金色暖调、夜晚用城市灯光
//   4. 城市光点标注（北京/上海/东京/纽约/伦敦/悉尼/开罗），便于辨认位置
//   5. 星空：旋转 + 随机透明度闪烁（8k_stars.jpg）
//
//  保留：昼夜切换着色器、平滑晨昏线、云层、大气辉光、星空背景
//  移除：太阳装饰球、月球轨道与月球
// ============================================================================

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import GUI from "lil-gui";
import { FlightLines, CITIES as FLIGHT_CITIES } from "./flightlines.js";
import { createChinaMap } from "./chinaMap.js";
import {
  t,
  initI18n,
  switchTo,
  refreshLanguages,
  onLanguageChange,
  getLanguages,
  getCurrentCode,
  applyStaticText,
} from "./i18n.js";

// 默认飞线分组：每行 { source: 起点城市, target: 终点城市 }（城市名须在 CITIES 中）
const DEFAULT_FLIGHT_GROUPS = [
  { source: "北京", target: "上海" },
  { source: "北京", target: "广州" },
  { source: "北京", target: "深圳" },
  { source: "北京", target: "成都" },
  { source: "北京", target: "杭州" },
  { source: "上海", target: "东京" },
  { source: "上海", target: "纽约" },
  { source: "上海", target: "伦敦" },
  { source: "上海", target: "新加坡" },
  { source: "上海", target: "悉尼" },
  { source: "芝加哥", target: "东京" },
];

const degToRad = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------------------
// 基础设置
// ---------------------------------------------------------------------------
const container = document.getElementById("app");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
camera.position.set(0, 0.8, 6.5);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 2.6;
controls.maxDistance = 40;

// 中国地图（独立场景，用于「地球 / 中国地图」视图切换）
const chinaMap = createChinaMap({
  container,
  rendererDom: renderer.domElement,
  width: window.innerWidth,
  height: window.innerHeight,
});

// 视图模式（earth | china）。声明提前到 i18n 初始化之前，
// 因为 applyLanguage() 会读取它（语言切换回调在 initI18n 里触发）。
let mode = "earth";

// 中国地图顶部「返回地球」按钮：云过渡切回地球
chinaMap.setReturnEarthHandler(() => {
  chinaMap.playCloudWipe(() => setMode("earth"));
});

// ---------------------------------------------------------------------------
// 尺寸常量
// ---------------------------------------------------------------------------
const EARTH_RADIUS = 2.0;
const CLOUD_RADIUS = EARTH_RADIUS * 1.012;
const ATMOSPHERE_RADIUS = EARTH_RADIUS * 1.12;

// ---------------------------------------------------------------------------
// 可调参数（供 lil-gui 使用）—— 所有数值都可在页面右侧面板实时改动
// ---------------------------------------------------------------------------
const params = {
  // 昼夜 / 时段
  timePreset: "auto", // auto | noon | dusk | dawn | night
  sunAzimuthDeg: 0, // 太阳方位角（0 = 正对相机侧）
  sunElevationDeg: 21, // 太阳高度角（0=地平线, 90=头顶）
  sunAutoRotate: true, // 自动昼夜循环
  sunOrbitSpeedDeg: 2, // 昼夜循环速度（度/秒）
  transitionWidth: 0.22, // 晨昏线宽度
  duskStrength: 1, // 黄昏暖色调强度
  duskWidth: 0.35, // 黄昏暖色覆盖范围（沿晨昏线的距离）
  dayBoost: 1.5, // 白昼亮度
  nightBoost: 2.75, // 夜晚城市灯光亮度
  normalStrength: 2, // 法线贴图强度（0 = 关闭）

  // 地球自转
  earthSpin: true,
  earthSpinSpeed: 0.066,

  // 云层
  cloudsVisible: true,
  cloudOpacity: 0.5,
  cloudSpeed: 1.6,

  // 大气辉光
  atmosphereVisible: true,
  atmosphereBrightness: 0.61,

  // 星空
  starsVisible: true,
  starRotate: true,
  starRotationSpeed: 0.015,
  starSwayAmplitude: 0.18,
  starSwaySpeed: 0.15,
  starTwinkle: true,
  starOpacityMin: 0.3,
  starOpacityMax: 0.75,

  // 城市标注
  markersVisible: false, // 默认不显示城市名称（飞线场景要求不显示城市名）

  // 护罩（能量波从北极扫到南极，路过的区域才显示）
  shieldVisible: true,
  shieldOpacity: 0.25, // 发光强度
  shieldDirection: "northToSouth", // 扫描方向：northToSouth(北极→南极) | southToNorth(南极→北极)
  shieldScanPeriod: 10, // 扫描周期（秒）：每隔 N 秒开始下一次扫描
  shieldScanDuration: 6, // 单次扫描所需时间（秒）：一次扫完所用的时长（可小于周期，留出空档）
  shieldBandWidth: 0.03, // 能量带宽度
  shieldRepeat: 15, // 纹理平铺次数
  shieldGlow: 3, // 边缘亮度
  shieldFresnel: 3, // 边缘锐度
  shieldColor: "#a5b2b6", // 护罩颜色

  // 飞线（1 起点 + n 终点，多组）
  flightVisible: true,
  flightLineColor: "#ccd7db", // 飞线颜色
  flightLineOpacity: 0.81, // 飞线透明度
  flightArcHeight: 0.05, // 弧线高度（相对地球半径的比例）
  flightCometLength: 40, // 彗星尾巴长度（点数）
  flightCometWidth: 23, // 彗星粗细（越大越细）
  flightCometSize: 1, // 彗星整体大小
  flightSpeed: 0.6, // 飞行速度倍率
  flightTrackWidth: 0.002, // 轨道线宽度（圆柱半径）
  flightTrackColor: "#3a6aa0", // 轨道线颜色
  flightTrackOpacity: 0.8, // 轨道线透明度
  // 终点扩散波
  waveColor: "#ffffff", // 扩散波颜色
  waveOpacity: 1, // 扩散波透明度
  waveHeight: 0.05, // 扩散波高度
  waveRadius: 0.03, // 扩散波半径
  waveSpeed: 0.2, // 扩散波速度
  waveBright: 0.2, // 扩散波亮度
  // 地球上的中国轮廓（金线 + 流动亮头，风格类似飞线）
  earthChinaLineColor: "#ffd24a", // 线颜色（金色）
  earthChinaLineOpacity: 0.75, // 线透明度
  flightGroupsJson: JSON.stringify(DEFAULT_FLIGHT_GROUPS, null, 2), // 可编辑的分组数据
};

// 昼夜光照方向（世界空间，每帧由方位角+高度角计算）
const sunDirection = new THREE.Vector3(0, 0.22, 1).normalize();
const sunState = { azimuthDeg: 0 };

// ---------------------------------------------------------------------------
// 参数持久化（保存 / 载入 / 恢复默认 / 导出 JSON）
// ---------------------------------------------------------------------------
const PARAMS_KEY = "earth_params_v2"; // v2：更新默认参数（夜间/护罩/飞线风格），旧版 v1 不再恢复，确保新默认对所有人生效
const PARAM_KEYS = [
  "timePreset", "sunAzimuthDeg", "sunElevationDeg", "sunAutoRotate", "sunOrbitSpeedDeg",
  "transitionWidth", "duskStrength", "duskWidth", "dayBoost", "nightBoost", "normalStrength",
  "earthSpin", "earthSpinSpeed",
  "cloudsVisible", "cloudOpacity", "cloudSpeed",
  "atmosphereVisible", "atmosphereBrightness",
  "starsVisible", "starRotate", "starRotationSpeed", "starSwayAmplitude", "starSwaySpeed",
  "starTwinkle", "starOpacityMin", "starOpacityMax",
  "markersVisible",
  "shieldVisible", "shieldOpacity", "shieldDirection", "shieldScanPeriod", "shieldScanDuration",
  "shieldBandWidth", "shieldRepeat", "shieldGlow", "shieldFresnel", "shieldColor",
  "flightVisible", "flightLineColor", "flightLineOpacity", "flightArcHeight", "flightCometLength", "flightCometWidth",
  "flightCometSize", "flightSpeed", "flightTrackWidth", "flightTrackColor", "flightTrackOpacity",
  "waveColor", "waveOpacity", "waveHeight", "waveRadius", "waveSpeed", "waveBright",
  "earthChinaLineColor", "earthChinaLineOpacity",
  "flightGroupsJson",
];
const DEFAULT_PARAMS = { ...params }; // 默认值快照（此时 params 仅含数据项）

let toastTimer = null;
function showToast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1600);
}

function collectParams() {
  const data = {};
  for (const k of PARAM_KEYS) data[k] = params[k];
  return data;
}

function saveParams() {
  localStorage.setItem(PARAMS_KEY, JSON.stringify(collectParams()));
  showToast(t("toast.saved"));
}

function loadParams() {
  const raw = localStorage.getItem(PARAMS_KEY);
  if (!raw) {
    showToast(t("toast.noParams"));
    return;
  }
  try {
    const data = JSON.parse(raw);
    for (const k of PARAM_KEYS) if (k in data) params[k] = data[k];
  } catch (e) {
    showToast(t("toast.loadFailed"));
    return;
  }
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  applyFlightGroups(); // 恢复飞线分组
  showToast(t("toast.loaded"));
}

function resetParams() {
  for (const k of PARAM_KEYS) params[k] = DEFAULT_PARAMS[k];
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  applyFlightGroups();
  showToast(t("toast.resetDone"));
}

function exportParams() {
  const blob = new Blob([JSON.stringify(collectParams(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "earth_params.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast(t("toast.exported"));
}

// 把导入的数据应用到参数里，并刷新面板；返回成功项数
function applyImported(data) {
  let count = 0;
  for (const k of PARAM_KEYS) {
    if (k in data) {
      params[k] = data[k];
      count++;
    }
  }
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  applyFlightGroups(); // 导入后重建飞线分组
  return count;
}

function importParams() {
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
        const count = applyImported(data);
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

// 挂载到 params 供 lil-gui 生成按钮
params.save = saveParams;
params.load = loadParams;
params.reset = resetParams;
params.export = exportParams;
params.import = importParams;

// 控制台调试用：可直接传入参数对象应用（与导入共用同一逻辑）
window.__applyImported = applyImported;

// ---------------------------------------------------------------------------
// 纹理加载（含进度提示；法线贴图用线性色彩空间）
// ---------------------------------------------------------------------------
const manager = new THREE.LoadingManager();
const progressEl = document.getElementById("progress");
manager.onProgress = (_url, loaded, total) => {
  progressEl.textContent = `${Math.round((loaded / total) * 100)}%`;
};
manager.onLoad = () => {
  const loader = document.getElementById("loader");
  setTimeout(() => loader.classList.add("hidden"), 300);
};

const textureLoader = new THREE.TextureLoader(manager);
function loadColorTexture(path) {
  const tex = textureLoader.load(path);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}
function loadLinearTexture(path) {
  const tex = textureLoader.load(path); // 法线贴图保持线性
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const dayTexture = loadColorTexture("./images/8k_earth_daymap.jpg");
const nightTexture = loadColorTexture("./images/8k_earth_nightmap.jpg");
const cloudsTexture = loadColorTexture("./images/8k_earth_clouds.jpg");
const starsTexture = loadColorTexture("./images/8k_stars.jpg");
const normalMap = loadLinearTexture("./images/8k_earth_normal_map.png");

// ---------------------------------------------------------------------------
// 星空背景：一个远距离大球体，支持旋转与透明度闪烁
// ---------------------------------------------------------------------------
const STAR_SPHERE_RADIUS = 300;
scene.background = new THREE.Color(0x000000);

const starMaterial = new THREE.MeshBasicMaterial({
  map: starsTexture,
  side: THREE.BackSide,
  transparent: true,
  opacity: params.starOpacityMax,
  depthWrite: false,
});
const starSphere = new THREE.Mesh(
  new THREE.SphereGeometry(STAR_SPHERE_RADIUS, 64, 64),
  starMaterial,
);
starSphere.renderOrder = -2;
scene.add(starSphere);

let starTargetOpacity = params.starOpacityMax;
let nextStarFlickerTime = 0;

// ---------------------------------------------------------------------------
// 地球：昼夜切换 + 时段光照 + 法线贴图
// ---------------------------------------------------------------------------
const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, 128, 128);
// 计算切线，供切线空间法线映射使用
if (typeof earthGeometry.computeTangents === "function") {
  earthGeometry.computeTangents();
}

const earthVertexShader = /* glsl */ `
  attribute vec3 tangent;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying mat3 vTbn; // 世界空间的 切线/副切线/法线 矩阵（TBN）

  void main() {
    vUv = uv;

    vec3 normalW = normalize(mat3(modelMatrix) * normal);
    vec3 tangentW = normalize(mat3(modelMatrix) * tangent);
    vec3 bitangentW = normalize(cross(normalW, tangentW));

    vNormal = normalW;
    vTbn = mat3(tangentW, bitangentW, normalW);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const earthFragmentShader = /* glsl */ `
  uniform sampler2D dayTexture;
  uniform sampler2D nightTexture;
  uniform sampler2D normalMap;
  uniform vec3 sunDirection;
  uniform float transitionWidth;
  uniform float duskStrength;
  uniform float duskWidth;
  uniform float dayBoost;
  uniform float nightBoost;
  uniform float normalStrength;
  uniform float lowSun; // 0 = 正午高太阳，1 = 太阳接近地平线

  varying vec2 vUv;
  varying vec3 vNormal;
  varying mat3 vTbn;

  // 从法线贴图取扰动后的法线（切线空间 -> 世界空间）
  vec3 perturbNormal() {
    vec3 mapNormal = texture2D(normalMap, vUv).rgb * 2.0 - 1.0;
    mapNormal.xy *= normalStrength;
    return normalize(vTbn * normalize(mapNormal));
  }

  void main() {
    vec3 lightDir = normalize(sunDirection);
    vec3 normal = perturbNormal();

    float dotProduct = dot(normal, lightDir);

    // 晨昏线平滑过渡（白天 = 1，夜晚 = 0）
    float start = -transitionWidth * 0.5;
    float end = transitionWidth * 0.5;
    float dayFactor = smoothstep(start, end, dotProduct);

    vec3 dayColor = texture2D(dayTexture, vUv).rgb * dayBoost;
    vec3 nightColor = texture2D(nightTexture, vUv).rgb * nightBoost;

    vec3 color = mix(nightColor, dayColor, dayFactor);

    // 黄昏/黎明金色暖调：太阳越低、越靠近晨昏线，暖色越浓
    float terminatorGlow = 1.0 - smoothstep(0.0, duskWidth, max(dotProduct, 0.0));
    float warm = lowSun * terminatorGlow * dayFactor;
    vec3 warmTint = vec3(1.0, 0.62, 0.35);
    color = mix(color, color * warmTint, warm * duskStrength);

    // 亮度随昼夜因子变化：正午亮、晨昏偏暗
    float brightness = mix(0.4, 1.0, dayFactor);
    color *= brightness;

    gl_FragColor = vec4(color, 1.0);
  }
`;

const earthMaterial = new THREE.ShaderMaterial({
  uniforms: {
    dayTexture: { value: dayTexture },
    nightTexture: { value: nightTexture },
    normalMap: { value: normalMap },
    sunDirection: { value: sunDirection.clone() },
    transitionWidth: { value: params.transitionWidth },
    duskStrength: { value: params.duskStrength },
    duskWidth: { value: params.duskWidth },
    dayBoost: { value: params.dayBoost },
    nightBoost: { value: params.nightBoost },
    normalStrength: { value: params.normalStrength },
    lowSun: { value: 1 },
  },
  vertexShader: earthVertexShader,
  fragmentShader: earthFragmentShader,
});

const earth = new THREE.Mesh(earthGeometry, earthMaterial);
scene.add(earth);

// ---------------------------------------------------------------------------
// 在地球上显示中国：金色轮廓线（静态）+ 沿轮廓流动的亮头彗星（风格类似飞线）。
// 悬停中国 -> 高亮（线变亮）+ “中国”提示；点击中国 -> 云过渡动画 -> 切入中国地图。
// 轮廓线颜色/透明度、线头颜色均可调（见“🌏 中国轮廓”面板）。
// ---------------------------------------------------------------------------
const chinaOnEarth = new THREE.Group();
earth.add(chinaOnEarth);

// 不可见的拾取网格：仅用于悬停/点击检测，不参与渲染显示
const chinaHitMat = new THREE.MeshBasicMaterial({
  transparent: true,
  opacity: 0,
  depthWrite: false,
  side: THREE.DoubleSide,
  colorWrite: false,
});
// 金色静态轮廓线
const chinaLineMat = new THREE.LineBasicMaterial({
  transparent: true,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
let chinaFillMesh = null; // 拾取网格（不可见）

// 把三角面细分并投影到球面（构造不可见拾取网格，贴合弧面）
function subdivTriangle(a, b, c, depth, R, out) {
  if (depth <= 0) {
    out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    return;
  }
  const ab = a.clone().add(b).normalize().multiplyScalar(R);
  const bc = b.clone().add(c).normalize().multiplyScalar(R);
  const ca = c.clone().add(a).normalize().multiplyScalar(R);
  subdivTriangle(a, ab, ca, depth - 1, R, out);
  subdivTriangle(ab, b, bc, depth - 1, R, out);
  subdivTriangle(ca, bc, c, depth - 1, R, out);
  subdivTriangle(ab, bc, ca, depth - 1, R, out);
}
function eachGeoPolygon(geo, cb) {
  if (geo.type === "Polygon") cb(geo.coordinates);
  else if (geo.type === "MultiPolygon") geo.coordinates.forEach(cb);
}
async function buildChinaRegionOnEarth() {
  const resp = await fetch("./data/geojson/100000_full.json");
  const json = await resp.json();
  const R = EARTH_RADIUS * 1.006;
  const fillVerts = [];
  const lineVerts = [];
  json.features.forEach((f) => {
    if (!f.properties || f.properties.adcode == null) return;
    if (String(f.properties.adcode).indexOf("_JD") !== -1) return; // 跳过九段线
    eachGeoPolygon(f.geometry, (rings) => {
      rings.forEach((ring, ri) => {
        if (ring.length < 3) return;
        const pts = ring.map(([lon, lat]) => latLonToVec3(lat, lon, R));
        // 金色静态轮廓线（首尾闭合）
        for (let i = 0; i < pts.length; i++) {
          const p = pts[i];
          const q = pts[(i + 1) % pts.length];
          lineVerts.push(p.x, p.y, p.z, q.x, q.y, q.z);
        }
        // 不可见拾取网格（仅外环，用于悬停/点击检测）
        if (ri === 0) {
          const centroid = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).normalize().multiplyScalar(R);
          for (let i = 0; i < pts.length; i++) {
            subdivTriangle(pts[i], pts[(i + 1) % pts.length], centroid, 2, R, fillVerts);
          }
        }
      });
    });
  });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute("position", new THREE.Float32BufferAttribute(fillVerts, 3));
  fg.computeVertexNormals();
  chinaFillMesh = new THREE.Mesh(fg, chinaHitMat);
  chinaOnEarth.add(chinaFillMesh);
  // 金色静态轮廓线
  const lg = new THREE.BufferGeometry();
  lg.setAttribute("position", new THREE.Float32BufferAttribute(lineVerts, 3));
  chinaOnEarth.add(new THREE.LineSegments(lg, chinaLineMat));
}
buildChinaRegionOnEarth();

// 由参数 + 悬停状态刷新材质（线颜色/透明度）
function refreshChinaLineParams() {
  const boost = chinaOnEarthHover ? 1.35 : 1; // 悬停时略变亮
  chinaLineMat.color.set(params.earthChinaLineColor);
  chinaLineMat.opacity = Math.min(1, params.earthChinaLineOpacity * boost);
}

// 地球模式下的中国区域交互：悬停高亮 + 点击切入中国地图（云过渡）
const earthChinaRay = new THREE.Raycaster();
earthChinaRay.params.Line = { threshold: 0.03 };
const earthChinaMouse = new THREE.Vector2();
const earthChinaTip = document.createElement("div");
earthChinaTip.id = "earthChinaTip";
Object.assign(earthChinaTip.style, {
  position: "fixed",
  zIndex: "40",
  pointerEvents: "none",
  background: "rgba(6,16,30,0.92)",
  border: "1px solid rgba(120,180,255,0.4)",
  color: "#dff1ff",
  padding: "5px 12px",
  borderRadius: "6px",
  fontSize: "13px",
  display: "none",
  left: "0",
  top: "0",
});
document.body.appendChild(earthChinaTip);
let chinaOnEarthHover = false;
let earthChinaDown = { x: 0, y: 0, t: 0 };
let earthChinaLock = false; // 一次点击流程中防止重复触发

function setEarthChinaHover(on) {
  if (on === chinaOnEarthHover) return;
  chinaOnEarthHover = on;
  refreshChinaLineParams();
  earthChinaTip.style.display = on ? "block" : "none";
  if (on) earthChinaTip.textContent = t("china.nationName") || "中国";
}

function onEarthPointerMove(ev) {
  if (mode !== "earth") return;
  if (!chinaFillMesh) return;
  const rect = renderer.domElement.getBoundingClientRect();
  earthChinaMouse.set(
    ((ev.clientX - rect.left) / rect.width) * 2 - 1,
    -((ev.clientY - rect.top) / rect.height) * 2 + 1,
  );
  earthChinaRay.setFromCamera(earthChinaMouse, camera);
  const hit = earthChinaRay.intersectObject(chinaFillMesh, false).length > 0;
  setEarthChinaHover(hit);
  if (hit) {
    earthChinaTip.style.left = ev.clientX + 14 + "px";
    earthChinaTip.style.top = ev.clientY + 14 + "px";
  }
}
function onEarthPointerDown(ev) {
  if (mode !== "earth" || ev.button !== 0) return;
  earthChinaDown = { x: ev.clientX, y: ev.clientY, t: Date.now() };
}
function onEarthPointerUp(ev) {
  if (mode !== "earth" || ev.button !== 0 || earthChinaLock) return;
  const moved = Math.hypot(ev.clientX - earthChinaDown.x, ev.clientY - earthChinaDown.y);
  if (moved > 6 || Date.now() - earthChinaDown.t > 500) return;
  if (!chinaOnEarthHover) return;
  earthChinaLock = true;
  setEarthChinaHover(false);
  earthChinaTip.style.display = "none";
  // 云过渡：云盖住屏幕时切换模式到中国地图，云再淡出露出中国地图
  chinaMap.playCloudWipe(() => {
    setMode("china");
    setTimeout(() => {
      earthChinaLock = false;
    }, 1400);
  });
}
renderer.domElement.addEventListener("pointermove", onEarthPointerMove);
renderer.domElement.addEventListener("pointerdown", onEarthPointerDown);
renderer.domElement.addEventListener("pointerup", onEarthPointerUp);

// ---------------------------------------------------------------------------
// 云层
// ---------------------------------------------------------------------------
const cloudsMaterial = new THREE.MeshPhongMaterial({
  map: cloudsTexture,
  transparent: true,
  opacity: params.cloudOpacity,
  depthWrite: false,
  blending: THREE.NormalBlending,
});
const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(CLOUD_RADIUS, 96, 96),
  cloudsMaterial,
);
clouds.renderOrder = 1;
scene.add(clouds);

// ---------------------------------------------------------------------------
// 大气辉光（背面菲涅尔）
// ---------------------------------------------------------------------------
const atmosphereMaterial = new THREE.ShaderMaterial({
  uniforms: {
    glowColor: { value: new THREE.Color(0.28, 0.58, 1.0) },
    brightness: { value: params.atmosphereBrightness },
  },
  vertexShader: /* glsl */ `
    varying vec3 vNormal;
    void main() {
      vNormal = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 glowColor;
    uniform float brightness;
    varying vec3 vNormal;
    void main() {
      float intensity = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.5);
      gl_FragColor = vec4(glowColor, 1.0) * intensity * brightness;
    }
  `,
  blending: THREE.AdditiveBlending,
  side: THREE.BackSide,
  transparent: true,
  depthWrite: false,
});
const atmosphere = new THREE.Mesh(
  new THREE.SphereGeometry(ATMOSPHERE_RADIUS, 96, 96),
  atmosphereMaterial,
);
atmosphere.renderOrder = -1;
scene.add(atmosphere);

// ---------------------------------------------------------------------------
// 护罩（护盾 / 金钟罩）：地球外围 + 垂直循环滚动 + 八边形网
//   - 结合第一篇：纹理做垂直方向的循环滚动（uv.y 逐帧偏移，fract 循环）
//   - 结合第二篇：自定义 ShaderMaterial + 菲涅尔边缘 + 叠加发光 + 时间动画
//   - 护罩贴图：由代码生成的大量交错八边形（矢量风，无缝平铺）
// ---------------------------------------------------------------------------
const SHIELD_SCALE = 1.06; // 护罩相对地球半径

// 生成"大量交错八边形"的护罩贴图（可无缝平铺，竖向/横向都能循环滚动）
function makeShieldTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, size, size);

  const cell = 64; // 每个八边形的占位网格
  const R = 36; // 八边形外接圆半径（略大于半格，使相邻八边形交错相接）
  const cols = size / cell; // 16

  const glow = "#3fd0ff";
  const bright = "#bffaff";
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";

  // 平铺：在 [-1, cols] 范围绘制，覆盖边缘保证 RepeatWrapping 无缝
  for (let r = -1; r <= cols; r++) {
    for (let c = -1; c <= cols; c++) {
      // 隔行错开半格，形成"交错"咬合感
      const cx = (c + (r % 2 ? 0.5 : 0)) * cell + cell / 2;
      const cy = r * cell + cell / 2;

      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI / 8) + (k * Math.PI) / 4; // 顶点朝上，八边形
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();

      // 外发光
      ctx.shadowColor = glow;
      ctx.shadowBlur = 14;
      ctx.strokeStyle = glow;
      ctx.stroke();
      // 内亮描边
      ctx.shadowBlur = 4;
      ctx.strokeStyle = bright;
      ctx.lineWidth = 1.4;
      ctx.stroke();
      // 内部淡淡填充
      ctx.shadowBlur = 0;
      ctx.fillStyle = "rgba(63,208,255,0.06)";
      ctx.fill();

      // 顶点处的亮结点
      ctx.fillStyle = bright;
      for (let k = 0; k < 8; k++) {
        const a = (Math.PI / 8) + (k * Math.PI) / 4;
        const x = cx + R * Math.cos(a);
        const y = cy + R * Math.sin(a);
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, 2 * Math.PI);
        ctx.fill();
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

const shieldTexture = makeShieldTexture();

const shieldMaterial = new THREE.ShaderMaterial({
  uniforms: {
    map: { value: shieldTexture },
    uTime: { value: 0 },
    uWave: { value: 0 }, // 能量波位置（0 = 北极, 1 = 南极）
    uReveal: { value: 1 }, // 揭示度：扫动时为 1，空闲空档为 0
    uBandWidth: { value: params.shieldBandWidth },
    uRepeat: { value: params.shieldRepeat },
    uOpacity: { value: params.shieldOpacity },
    uGlow: { value: params.shieldGlow },
    uFresnel: { value: params.shieldFresnel },
    uColor: { value: new THREE.Color(params.shieldColor) },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D map;
    uniform float uTime;
    uniform float uWave;      // 能量波位置 0..1（v=0 北极 -> v=1 南极）
    uniform float uReveal;    // 揭示度：扫动时为 1，空闲空档为 0
    uniform float uBandWidth; // 能量带半宽
    uniform float uRepeat;
    uniform float uOpacity;
    uniform float uGlow;
    uniform float uFresnel;
    uniform vec3 uColor;

    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;

    void main() {
      // 八边形网（原地不动，静态）
      vec2 uv = fract(vUv * uRepeat);
      vec4 pattern = texture2D(map, uv);
      float net = dot(pattern.rgb, vec3(0.299, 0.587, 0.114)); // 八边形线条亮度

      // 菲涅尔边缘（护罩轮廓光）
      vec3 viewDir = normalize(cameraPosition - vWorldPos);
      float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), uFresnel);

      // ---- 能量波：从北极(v=0)扫到南极(v=1) ----
      float d = vUv.y - uWave;                      // 到波中心的纬度距离
      float band = exp(-pow(d / uBandWidth, 2.0));  // 主能量带（高斯）
      float front = exp(-pow((vUv.y - (uWave + uBandWidth * 0.8)) / (uBandWidth * 0.3), 2.0)); // 前缘亮线
      float trail = exp(-pow((vUv.y - (uWave - uBandWidth * 1.8)) / (uBandWidth * 1.2), 2.0)) * 0.35; // 后随余辉
      float gate = clamp(band + front * 0.7 + trail, 0.0, 1.0); // 只有波经过的地方才显示

      // 时间脉动
      float pulse = 0.85 + 0.15 * sin(uTime * 2.0);

      // 组合：波区域内的八边形网 + 轮廓光 + 能量带本身的光
      vec3 col = uColor * net * uGlow * pulse          // 八边形网
               + uColor * fresnel * 0.7                // 轮廓
               + uColor * (band * 0.4 + front * 0.8);  // 能量带本身发光

      // 透明度被能量波门控：波外区域隐藏；再乘揭示度以支持"扫描空档"
      float alpha = clamp((net * 0.9 + fresnel * 0.7) * gate + gate * 0.45, 0.0, 1.0) * uOpacity;

      gl_FragColor = vec4(col * uReveal, alpha * uReveal);
    }
  `,
  transparent: true,
  blending: THREE.AdditiveBlending, // 叠加发光
  side: THREE.FrontSide,
  depthWrite: false,
});

const shield = new THREE.Mesh(
  new THREE.SphereGeometry(EARTH_RADIUS * SHIELD_SCALE, 96, 96),
  shieldMaterial,
);
shield.renderOrder = 3;
shield.visible = params.shieldVisible;
scene.add(shield);
// 能量波累计相位（供单向扫描计时，单位：秒）
let shieldWavePhase = 0;

// ---------------------------------------------------------------------------
// 城市光点标注（挂在 earth 节点下，随地球一起自转）
// ---------------------------------------------------------------------------
function latLonToVec3(lat, lon, r) {
  const phi = degToRad(90 - lat);
  const theta = degToRad(lon + 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

function makeLabelSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 96);
  // 圆点
  ctx.beginPath();
  ctx.arc(128, 30, 11, 0, 2 * Math.PI);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  // 城市名（根据是否含中文选择字体）
  const hasCjk = /[\u3000-\u9fff\uff00-\uffef]/.test(text);
  ctx.font = hasCjk
    ? "bold 30px 'Microsoft YaHei', sans-serif"
    : "bold 30px 'Segoe UI', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0,0,0,0.7)";
  ctx.strokeText(text, 128, 62);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, 128, 62);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(0.72, 0.27, 1);
  return sprite;
}

const CITIES = [
  { name: "北京", lat: 39.9, lon: 116.4, color: "#ff5a5a" },
  { name: "上海", lat: 31.2, lon: 121.5, color: "#ff5a5a" },
  { name: "东京", lat: 35.7, lon: 139.7, color: "#ffb347" },
  { name: "纽约", lat: 40.7, lon: -74.0, color: "#5aa9ff" },
  { name: "伦敦", lat: 51.5, lon: -0.13, color: "#5aa9ff" },
  { name: "悉尼", lat: -33.9, lon: 151.2, color: "#5aa9ff" },
  { name: "开罗", lat: 30.0, lon: 31.2, color: "#5aa9ff" },
  { name: "里约", lat: -22.9, lon: -43.2, color: "#5aa9ff" },
];

const markersGroup = new THREE.Group();
earth.add(markersGroup);

// 重建城市标注精灵（文本随语言变化；清单内 name 为稳定键，显示名用 t("city.<name>")）
function buildCityMarkers() {
  while (markersGroup.children.length) {
    const child = markersGroup.children[0];
    if (child.material && child.material.map) child.material.map.dispose();
    if (child.material) child.material.dispose();
    markersGroup.remove(child);
  }
  CITIES.forEach((c) => {
    const sprite = makeLabelSprite(t("city." + c.name), c.color);
    sprite.position.copy(latLonToVec3(c.lat, c.lon, EARTH_RADIUS * 1.005));
    markersGroup.add(sprite);
  });
}

// ---------------------------------------------------------------------------
// 动态飞线（多组：1 起点 + n 终点 + 终点扩散波）—— 表格形式编辑
// ---------------------------------------------------------------------------
const flightLines = new FlightLines(earth, { radius: EARTH_RADIUS });
const flightCityNames = FLIGHT_CITIES.map((c) => c.name);
let flightRows = []; // 表格数据：[{ source, target }]

// 兼容两种数据：[{source,targets:[...]}] 或 [{source,target}]
function rowsFromJson(json) {
  const arr = JSON.parse(json);
  const rows = [];
  arr.forEach((r) => {
    if (Array.isArray(r.targets)) r.targets.forEach((t) => rows.push({ source: r.source, target: t }));
    else rows.push({ source: r.source, target: r.target });
  });
  return rows;
}

// 按起点分组 -> [{source, targets:[...]}]
function rowGroups() {
  const m = new Map();
  flightRows.forEach((r) => {
    if (!r.source || !r.target) return;
    if (!m.has(r.source)) m.set(r.source, []);
    m.get(r.source).push(r.target);
  });
  return [...m.entries()].map(([source, targets]) => ({ source, targets }));
}

function rebuildFlight() {
  params.flightGroupsJson = JSON.stringify(flightRows, null, 2); // 供持久化
  flightLines.rebuild(rowGroups(), params.flightArcHeight, params.flightTrackWidth);
}

function applyFlightGroups() {
  try {
    flightRows.splice(0, flightRows.length, ...rowsFromJson(params.flightGroupsJson));
  } catch (e) {
    flightRows.splice(0, flightRows.length, { source: "北京", target: "上海" });
  }
  rebuildFlight();
  renderFlightTable();
}

/* ---- 表格编辑器 ---- */
function makeCitySelect(value) {
  const sel = document.createElement("select");
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = t("flight.selectPlaceholder");
  sel.appendChild(empty);
  flightCityNames.forEach((n) => {
    const o = document.createElement("option");
    o.value = n; // 稳定键（城市中文名），用于数据
    o.textContent = t("city." + n); // 显示名（随语言）
    sel.appendChild(o);
  });
  sel.value = value;
  return sel;
}

function renderFlightTable() {
  const tbody = document.getElementById("flightTbody");
  if (!tbody) return;
  tbody.innerHTML = "";
  flightRows.forEach((row, idx) => {
    const tr = document.createElement("tr");

    // 列1：起点城市
    const tdS = document.createElement("td");
    const selS = makeCitySelect(row.source);
    selS.addEventListener("change", () => {
      flightRows[idx].source = selS.value;
      rebuildFlight();
    });
    tdS.appendChild(selS);

    // 列2：终点城市
    const tdT = document.createElement("td");
    const selT = makeCitySelect(row.target);
    selT.addEventListener("change", () => {
      flightRows[idx].target = selT.value;
      rebuildFlight();
    });
    tdT.appendChild(selT);

    // 列3：增加 / 删除
    const tdB = document.createElement("td");
    tdB.className = "btns";
    const addBtn = document.createElement("button");
    addBtn.className = "add";
    addBtn.textContent = "＋";
    addBtn.title = t("flight.addEndTitle");
    addBtn.addEventListener("click", () => {
      flightRows.splice(idx + 1, 0, { source: row.source, target: "" });
      renderFlightTable();
      rebuildFlight();
    });
    const delBtn = document.createElement("button");
    delBtn.className = "del";
    delBtn.textContent = "－";
    delBtn.title = t("flight.delTitle");
    delBtn.addEventListener("click", () => {
      flightRows.splice(idx, 1);
      renderFlightTable();
      rebuildFlight();
    });
    tdB.append(addBtn, delBtn);

    tr.append(tdS, tdT, tdB);
    tbody.appendChild(tr);
  });
}

function initFlightEditor() {
  const panel = document.getElementById("flightPanel");
  const toggle = document.getElementById("flightPanelToggle");
  if (toggle && panel) {
    toggle.addEventListener("click", () => {
      panel.classList.toggle("collapsed");
      toggle.textContent = panel.classList.contains("collapsed")
        ? t("flight.expand")
        : t("flight.collapse");
    });
  }
  const addGroup = document.getElementById("flightAddGroup");
  if (addGroup) {
    addGroup.addEventListener("click", () => {
      flightRows.push({ source: "", target: "" });
      renderFlightTable();
    });
  }
}
initFlightEditor();

// ---------------------------------------------------------------------------
// 场景灯光（用于云层；地球用自定义着色器，不受影响）
// ---------------------------------------------------------------------------
const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
dirLight.position.copy(sunDirection).multiplyScalar(10);
scene.add(dirLight);

const ambientLight = new THREE.AmbientLight(0x223344, 0.8);
scene.add(ambientLight);

// ---------------------------------------------------------------------------
// lil-gui 参数面板（多语言：切换语言时销毁重建，标题/分组/控件名用 t()）
// ---------------------------------------------------------------------------
let gui = null;

function buildGui() {
  if (gui) gui.destroy();
  gui = new GUI({ title: t("gui.title") });
  // 把地球面板定位到语言条（右上角）下方，避免盖住多语言切换；位置与中国地图面板一致
  gui.domElement.style.position = "fixed";
  gui.domElement.style.right = "12px";
  gui.domElement.style.top = "70px";
  gui.domElement.style.zIndex = "15";

  // 昼夜 / 时段
  const fDay = gui.addFolder(t("folder.day"));
  fDay
    .add(params, "timePreset", {
      [t("preset.auto")]: "auto",
      [t("preset.noon")]: "noon",
      [t("preset.dusk")]: "dusk",
      [t("preset.dawn")]: "dawn",
      [t("preset.night")]: "night",
    })
    .name(t("param.timePreset"))
    .onChange((v) => applyTimePreset(v));
  fDay.add(params, "sunElevationDeg", -10, 90, 1).name(t("param.sunElevation"));
  fDay.add(params, "sunAutoRotate").name(t("param.sunAutoRotate"));
  fDay.add(params, "sunOrbitSpeedDeg", 0, 20, 0.5).name(t("param.sunOrbitSpeed"));
  fDay.add(params, "transitionWidth", 0.02, 0.6, 0.01).name(t("param.transitionWidth"));
  fDay.add(params, "duskStrength", 0, 1, 0.05).name(t("param.duskStrength"));
  fDay.add(params, "duskWidth", 0.05, 1, 0.05).name(t("param.duskWidth"));
  fDay.add(params, "dayBoost", 0.2, 2, 0.05).name(t("param.dayBoost"));
  fDay.add(params, "nightBoost", 0.2, 3, 0.05).name(t("param.nightBoost"));
  fDay.add(params, "normalStrength", 0, 2, 0.05).name(t("param.normalStrength"));

  // 地球自转
  const fEarth = gui.addFolder(t("folder.earth"));
  fEarth.add(params, "earthSpin").name(t("param.earthSpin"));
  fEarth.add(params, "earthSpinSpeed", 0, 0.2, 0.001).name(t("param.earthSpinSpeed"));

  // 云层
  const fCloud = gui.addFolder(t("folder.cloud"));
  fCloud.add(params, "cloudsVisible").name(t("param.cloudsVisible"));
  fCloud.add(params, "cloudOpacity", 0, 1, 0.05).name(t("param.cloudOpacity"));

  // 大气
  const fAtm = gui.addFolder(t("folder.atm"));
  fAtm.add(params, "atmosphereVisible").name(t("param.atmosphereVisible"));
  fAtm.add(params, "atmosphereBrightness", 0, 1, 0.01).name(t("param.atmosphereBrightness"));

  // 星空
  const fStar = gui.addFolder(t("folder.star"));
  fStar.add(params, "starsVisible").name(t("param.starsVisible"));
  fStar.add(params, "starRotate").name(t("param.starRotate"));
  fStar.add(params, "starRotationSpeed", 0, 0.2, 0.005).name(t("param.starRotationSpeed"));
  fStar.add(params, "starSwayAmplitude", 0, 0.5, 0.01).name(t("param.starSwayAmplitude"));
  fStar.add(params, "starSwaySpeed", 0, 1, 0.01).name(t("param.starSwaySpeed"));
  fStar.add(params, "starTwinkle").name(t("param.starTwinkle"));
  fStar.add(params, "starOpacityMin", 0, 1, 0.05).name(t("param.starOpacityMin"));
  fStar.add(params, "starOpacityMax", 0, 1, 0.05).name(t("param.starOpacityMax"));

  // 城市标注
  const fMark = gui.addFolder(t("folder.mark"));
  fMark.add(params, "markersVisible").name(t("param.markersVisible"));

  // 参数保存 / 载入
  const fSave = gui.addFolder(t("folder.save"));
  fSave.add(params, "save").name(t("param.save"));
  fSave.add(params, "load").name(t("param.load"));
  fSave.add(params, "import").name(t("param.import"));
  fSave.add(params, "reset").name(t("param.reset"));
  fSave.add(params, "export").name(t("param.export"));

  // 护罩
  const fShield = gui.addFolder(t("folder.shield"));
  fShield.add(params, "shieldVisible").name(t("param.shieldVisible"));
  fShield.add(params, "shieldOpacity", 0, 2, 0.05).name(t("param.shieldOpacity"));
  fShield
    .add(params, "shieldDirection", {
      [t("param.shieldDirNorth")]: "northToSouth",
      [t("param.shieldDirSouth")]: "southToNorth",
    })
    .name(t("param.shieldDirection"));
  fShield.add(params, "shieldScanPeriod", 1, 20, 0.5).name(t("param.shieldScanPeriod"));
  fShield.add(params, "shieldScanDuration", 0.5, 20, 0.5).name(t("param.shieldScanDuration"));
  fShield.add(params, "shieldBandWidth", 0.03, 0.5, 0.01).name(t("param.shieldBandWidth"));
  fShield.add(params, "shieldRepeat", 1, 30, 1).name(t("param.shieldRepeat"));
  fShield.add(params, "shieldGlow", 0, 3, 0.05).name(t("param.shieldGlow"));
  fShield.add(params, "shieldFresnel", 1, 6, 0.1).name(t("param.shieldFresnel"));
  fShield.addColor(params, "shieldColor").name(t("param.shieldColor"));

  // 飞线
  const fFly = gui.addFolder(t("folder.fly"));
  fFly.add(params, "flightVisible").name(t("param.flightVisible"));
  fFly.addColor(params, "flightLineColor").name(t("param.flightLineColor"));
  fFly.add(params, "flightLineOpacity", 0, 1, 0.01).name(t("param.flightLineOpacity"));
  fFly
    .add(params, "flightArcHeight", 0.05, 0.9, 0.01)
    .name(t("param.flightArcHeight"))
    .onChange(() => applyFlightGroups());
  fFly.add(params, "flightCometLength", 5, 200, 1).name(t("param.flightCometLength"));
  fFly.add(params, "flightCometWidth", 2, 40, 1).name(t("param.flightCometWidth"));
  fFly.add(params, "flightCometSize", 0.5, 8, 0.5).name(t("param.flightCometSize"));
  fFly.add(params, "flightSpeed", 0.1, 5, 0.1).name(t("param.flightSpeed"));
  fFly
    .add(params, "flightTrackWidth", 0.002, 0.2, 0.001)
    .name(t("param.flightTrackWidth"))
    .onFinishChange(() => applyFlightGroups());
  fFly.addColor(params, "flightTrackColor").name(t("param.flightTrackColor"));
  fFly.add(params, "flightTrackOpacity", 0, 1, 0.05).name(t("param.flightTrackOpacity"));
  fFly.addColor(params, "waveColor").name(t("param.waveColor"));
  fFly.add(params, "waveOpacity", 0, 1, 0.01).name(t("param.waveOpacity"));
  fFly.add(params, "waveHeight", 0.01, 2.5, 0.01).name(t("param.waveHeight"));
  fFly.add(params, "waveRadius", 0.01, 2, 0.01).name(t("param.waveRadius"));
  fFly.add(params, "waveSpeed", 0.2, 3, 0.1).name(t("param.waveSpeed"));
  fFly.add(params, "waveBright", 0.1, 3, 0.1).name(t("param.waveBright"));

  // 地球上的中国轮廓（金线 + 流动亮头）
  const fChina = gui.addFolder(t("folder.chinaOutline"));
  fChina.addColor(params, "earthChinaLineColor").name(t("param.chinaLineColor"));
  fChina.add(params, "earthChinaLineOpacity", 0, 1, 0.01).name(t("param.chinaLineOpacity"));

  // 折叠部分分组，让面板更紧凑，保存按钮一眼可见（点击可展开）
  fEarth.close();
  fCloud.close();
  fAtm.close();
  fStar.close();
  fMark.close();
  fShield.close();
  fFly.close();
  fChina.close();

  // 将面板显示同步到当前 params（含恢复后的值）
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
}

// 语言切换（右上角选择器）控件：绑定事件 + 刷新选项
function buildLanguageBar() {
  const sel = document.getElementById("langSelect");
  const btn = document.getElementById("langRefresh");
  if (sel) {
    sel.addEventListener("change", async () => {
      const ok = await switchTo(sel.value);
      if (!ok) showToast(t("lang.switchFailed"));
    });
  }
  if (btn) {
    btn.addEventListener("click", async () => {
      await refreshLanguages();
      syncLanguageBar();
    });
  }
}

// 把语言下拉框的选项/当前值/提示刷新为当前可用语言
function syncLanguageBar() {
  const sel = document.getElementById("langSelect");
  const btn = document.getElementById("langRefresh");
  if (!sel) return;
  const langs = getLanguages();
  sel.innerHTML = "";
  langs.forEach((l) => {
    const o = document.createElement("option");
    o.value = l.code;
    o.textContent = l.name;
    sel.appendChild(o);
  });
  sel.value = getCurrentCode();
  sel.title = t("lang.placeholder");
  if (btn) btn.title = t("lang.refreshTitle");
}

// 语言就绪/变化后：应用静态文本、重建 GUI、本地化城市名与标注、刷新语言条
function applyLanguage() {
  applyStaticText(); // index.html 中的 data-i18n / data-i18n-title
  buildGui(); // GUI 标题、分组、控件名按当前语言重建
  if (gui) gui.domElement.style.display = mode === "china" ? "none" : ""; // 保持当前视图下地球面板的显隐
  renderFlightTable(); // 飞线表格里的城市中文显示名 -> 当前语言
  buildCityMarkers(); // 城市标注精灵文字 -> 当前语言
  syncLanguageBar(); // 语言下拉框选项与提示
  // 修正飞线面板「收起/展开」按钮文字（它受折叠状态影响）
  const panel = document.getElementById("flightPanel");
  const tgl = document.getElementById("flightPanelToggle");
  if (panel && tgl) {
    tgl.textContent = panel.classList.contains("collapsed")
      ? t("flight.expand")
      : t("flight.collapse");
  }
  // 视图切换按钮 + 中国地图面板文字
  updateViewToggle();
  chinaMap.refreshText();
}

// 静默恢复上次保存的参数（不弹提示；返回是否恢复成功）
function restoreSavedParams() {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    for (const k of PARAM_KEYS) if (k in data) params[k] = data[k];
    return true;
  } catch (e) {
    return false;
  }
}

// 绑定语言切换回调，再加载语言；GUI 由 applyLanguage() 在语言就绪后构建
buildLanguageBar();
onLanguageChange(() => applyLanguage());
restoreSavedParams();
await initI18n(); // 加载语言 -> 触发 onLanguageChange -> applyLanguage()（构建 GUI 等）
applyFlightGroups(); // 语言就绪后用当前语言重绘飞线表格并重建飞线
gui.controllersRecursive().forEach((c) => c.updateDisplay());

// 时段预设：设置太阳相对默认相机侧（+Z）的方位角 + 高度角
function applyTimePreset(preset) {
  switch (preset) {
    case "noon":
      params.sunAzimuthDeg = 0;
      params.sunElevationDeg = 40;
      break;
    case "dusk":
      params.sunAzimuthDeg = 90;
      params.sunElevationDeg = 5;
      break;
    case "dawn":
      params.sunAzimuthDeg = 270;
      params.sunElevationDeg = 5;
      break;
    case "night":
      params.sunAzimuthDeg = 180;
      params.sunElevationDeg = 0;
      break;
    default:
      break; // auto
  }
}

// 由方位角 + 高度角计算世界空间太阳方向（az=0 时朝向 +Z = 默认相机侧）
function sunDirFromAzimuthElevation(azDeg, elevDeg) {
  const e = degToRad(elevDeg);
  const a = degToRad(azDeg);
  return new THREE.Vector3(
    Math.cos(e) * Math.sin(a),
    Math.sin(e),
    Math.cos(e) * Math.cos(a),
  ).normalize();
}

// ---------------------------------------------------------------------------
// 动画循环
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

// ---------------------------------------------------------------------------
// 视图切换：地球 / 中国地图
// ---------------------------------------------------------------------------
function viewToggleEl() {
  return document.getElementById("viewToggle");
}

function updateViewToggle() {
  const btn = viewToggleEl();
  if (!btn) return;
  const toChina = mode === "earth";
  btn.textContent = toChina ? t("view.china") : t("view.earth");
  btn.title = toChina ? t("view.chinaTitle") : t("view.earthTitle");
}

function setMode(next) {
  if (mode === next) return;
  mode = next;
  const isChina = mode === "china";
  // 两个场景共用同一个 renderer.domElement，切换时只启用对应的一套 controls
  controls.enabled = !isChina;
  chinaMap.controls.enabled = isChina;
  chinaMap.setActive(isChina);
  // 进入中国地图时隐藏地球参数面板，避免两者重叠
  if (gui) gui.domElement.style.display = isChina ? "none" : "";
  clock.getDelta(); // 清掉切换瞬间累积的 delta，避免下一帧跳变
  updateViewToggle();
}

const vt = viewToggleEl();
if (vt) {
  vt.addEventListener("click", () => setMode(mode === "earth" ? "china" : "earth"));
}
updateViewToggle();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

  // 独立云过渡（地球→中国地图）：每帧推进，不依赖当前模式
  chinaMap.updateCloudWipe(delta);

  // --- 中国地图模式：渲染独立场景，跳过地球逻辑 ---
  if (mode === "china") {
    chinaMap.update(delta);
    renderer.render(chinaMap.scene, chinaMap.camera);
    return;
  }


  // --- 昼夜光照方向 ---
  if (params.timePreset === "auto") {
    sunState.azimuthDeg =
      (sunState.azimuthDeg + delta * params.sunOrbitSpeedDeg) % 360;
  }
  const azDeg =
    params.timePreset === "auto" ? sunState.azimuthDeg : params.sunAzimuthDeg;
  sunDirection
    .copy(sunDirFromAzimuthElevation(azDeg, params.sunElevationDeg))
    .normalize();

  // --- 同步着色器 uniforms ---
  earthMaterial.uniforms.sunDirection.value.copy(sunDirection);
  earthMaterial.uniforms.transitionWidth.value = params.transitionWidth;
  earthMaterial.uniforms.duskStrength.value = params.duskStrength;
  earthMaterial.uniforms.duskWidth.value = params.duskWidth;
  earthMaterial.uniforms.dayBoost.value = params.dayBoost;
  earthMaterial.uniforms.nightBoost.value = params.nightBoost;
  earthMaterial.uniforms.normalStrength.value = params.normalStrength;
  earthMaterial.uniforms.lowSun.value = THREE.MathUtils.clamp(
    1 - params.sunElevationDeg / 40,
    0,
    1,
  );

  // 云层灯光：跟随太阳方向
  dirLight.position.copy(sunDirection).multiplyScalar(10);

  // --- 地球自转 + 云层漂移 ---
  if (params.earthSpin) earth.rotation.y += delta * params.earthSpinSpeed;
  clouds.rotation.y += delta * params.earthSpinSpeed * params.cloudSpeed;

  // --- 云层 / 大气 / 星空可见性 ---
  clouds.visible = params.cloudsVisible;
  cloudsMaterial.opacity = params.cloudOpacity;
  atmosphere.visible = params.atmosphereVisible;
  atmosphereMaterial.uniforms.brightness.value = params.atmosphereBrightness;

  // --- 星空旋转 + 摇摆 + 闪烁 ---
  starSphere.visible = params.starsVisible;
  if (params.starRotate) {
    starSphere.rotation.y += delta * params.starRotationSpeed;
    starSphere.rotation.x =
      Math.sin(elapsed * params.starSwaySpeed) * params.starSwayAmplitude;
  }
  if (params.starTwinkle) {
    if (elapsed >= nextStarFlickerTime) {
      starTargetOpacity =
        params.starOpacityMin +
        Math.random() * (params.starOpacityMax - params.starOpacityMin);
      nextStarFlickerTime = elapsed + 0.08 + Math.random() * 0.15;
    }
    starMaterial.opacity +=
      (starTargetOpacity - starMaterial.opacity) * Math.min(1, delta * 20);
  } else {
    starMaterial.opacity = params.starOpacityMax;
  }

  // --- 城市标注 ---
  markersGroup.visible = params.markersVisible;

  // --- 护罩：能量波扫描（可设 方向 / 周期 / 单次时长）---
  shield.visible = params.shieldVisible;
  const su = shieldMaterial.uniforms;
  su.uTime.value = elapsed;

  // 扫描推进：每周期扫一次，扫动实际耗时为「单次扫描时长」，剩余为"空档"（护罩关闭）
  shieldWavePhase += delta;
  const period = Math.max(0.1, params.shieldScanPeriod);
  const dur = Math.min(Math.max(0.1, params.shieldScanDuration), period);
  const cycleTime = shieldWavePhase % period;
  const sweep = Math.min(cycleTime / dur, 1); // 0..1 扫动进度
  // 方向：北极→南极 (0→1) 或 南极→北极 (1→0)
  su.uWave.value =
    params.shieldDirection === "southToNorth" ? 1 - sweep : sweep;

  // 揭示度：扫动时为 1，到达终点后（空档）淡出为 0；扫动开始/结束有软边过渡
  const fade = Math.min(0.6, dur * 0.25);
  let reveal;
  if (cycleTime < dur) {
    reveal = Math.min(cycleTime / fade, (dur - cycleTime) / fade, 1);
  } else {
    reveal = 0;
  }
  su.uReveal.value = Math.max(0, Math.min(1, reveal));

  su.uBandWidth.value = params.shieldBandWidth;
  su.uRepeat.value = params.shieldRepeat;
  su.uOpacity.value = params.shieldOpacity;
  su.uGlow.value = params.shieldGlow;
  su.uFresnel.value = params.shieldFresnel;
  su.uColor.value.set(params.shieldColor);

  // --- 飞线：推进彗星 + 终点扩散波 ---
  flightLines.update(delta, elapsed, {
    visible: params.flightVisible,
    lineColor: params.flightLineColor,
    lineOpacity: params.flightLineOpacity,
    flightSpeed: params.flightSpeed,
    cometLength: params.flightCometLength,
    cometWidth: params.flightCometWidth,
    cometSize: params.flightCometSize,
    trackColor: params.flightTrackColor,
    trackOpacity: params.flightTrackOpacity,
    waveColor: params.waveColor,
    waveOpacity: params.waveOpacity,
    waveHeight: params.waveHeight,
    waveRadius: params.waveRadius,
    waveSpeed: params.waveSpeed,
    waveBright: params.waveBright,
  });

  controls.update();
  renderer.render(scene, camera);
}
animate();

// 便于在浏览器控制台调试 / 供自动化测试驱动：暴露参数对象
window.__params = params;
window.__shieldUniforms = shieldMaterial.uniforms;
window.__flight = flightLines;
window.__earth = earth;
window.__camera = camera;
window.__controls = controls;

// ---------------------------------------------------------------------------
// 窗口自适应
// ---------------------------------------------------------------------------
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  chinaMap.setSize(window.innerWidth, window.innerHeight);
});
