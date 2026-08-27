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

// 默认飞线分组：{ source: 起点城市, targets: [终点城市...] }（城市名须在 CITIES 中）
const DEFAULT_FLIGHT_GROUPS = [
  { source: "北京", targets: ["上海", "广州", "深圳", "成都", "杭州"] },
  { source: "上海", targets: ["东京", "纽约", "伦敦", "新加坡", "悉尼"] },
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
  sunElevationDeg: 12, // 太阳高度角（0=地平线, 90=头顶）
  sunAutoRotate: true, // 自动昼夜循环
  sunOrbitSpeedDeg: 3, // 昼夜循环速度（度/秒）
  transitionWidth: 0.22, // 晨昏线宽度
  duskStrength: 0.65, // 黄昏暖色调强度
  duskWidth: 0.35, // 黄昏暖色覆盖范围（沿晨昏线的距离）
  dayBoost: 1.0, // 白昼亮度
  nightBoost: 1.25, // 夜晚城市灯光亮度
  normalStrength: 0.7, // 法线贴图强度（0 = 关闭）

  // 地球自转
  earthSpin: true,
  earthSpinSpeed: 0.02,

  // 云层
  cloudsVisible: true,
  cloudOpacity: 0.6,
  cloudSpeed: 1.6,

  // 大气辉光
  atmosphereVisible: true,
  atmosphereBrightness: 0.45,

  // 星空
  starsVisible: true,
  starRotate: true,
  starRotationSpeed: 0.04,
  starSwayAmplitude: 0.1,
  starSwaySpeed: 0.15,
  starTwinkle: true,
  starOpacityMin: 0.4,
  starOpacityMax: 1.0,

  // 城市标注
  markersVisible: false, // 默认不显示城市名称（飞线场景要求不显示城市名）

  // 护罩（能量波从北极扫到南极，路过的区域才显示）
  shieldVisible: true,
  shieldOpacity: 0.9, // 发光强度
  shieldDirection: "northToSouth", // 扫描方向：northToSouth(北极→南极) | southToNorth(南极→北极)
  shieldScanPeriod: 5, // 扫描周期（秒）：每隔 N 秒开始下一次扫描
  shieldScanDuration: 5, // 单次扫描所需时间（秒）：一次扫完所用的时长（可小于周期，留出空档）
  shieldBandWidth: 0.12, // 能量带宽度
  shieldRepeat: 1, // 纹理平铺次数
  shieldGlow: 1.0, // 边缘亮度
  shieldFresnel: 2.5, // 边缘锐度
  shieldColor: "#3fd0ff", // 护罩颜色

  // 飞线（1 起点 + n 终点，多组）
  flightVisible: true,
  flightLineColor: "#4fd0ff", // 飞线颜色
  flightArcHeight: 0.35, // 弧线高度（相对地球半径的比例）
  flightCometLength: 60, // 彗星尾巴长度（点数）
  flightCometWidth: 10, // 彗星粗细（越大越细）
  flightCometSize: 2, // 彗星整体大小
  flightSpeed: 1, // 飞行速度倍率
  flightTrackOpacity: 0.28, // 轨道线透明度
  // 终点扩散波
  waveColor: "#40e0ff", // 扩散波颜色
  waveHeight: 0.6, // 扩散波高度
  waveRadius: 0.6, // 扩散波半径
  waveSpeed: 0.9, // 扩散波速度
  waveBright: 1.0, // 扩散波亮度
  flightGroupsJson: JSON.stringify(DEFAULT_FLIGHT_GROUPS, null, 2), // 可编辑的分组数据
};

// 昼夜光照方向（世界空间，每帧由方位角+高度角计算）
const sunDirection = new THREE.Vector3(0, 0.22, 1).normalize();
const sunState = { azimuthDeg: 0 };

// ---------------------------------------------------------------------------
// 参数持久化（保存 / 载入 / 恢复默认 / 导出 JSON）
// ---------------------------------------------------------------------------
const PARAMS_KEY = "earth_params_v1";
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
  "flightVisible", "flightLineColor", "flightArcHeight", "flightCometLength", "flightCometWidth",
  "flightCometSize", "flightSpeed", "flightTrackOpacity",
  "waveColor", "waveHeight", "waveRadius", "waveSpeed", "waveBright",
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
  showToast("✅ 参数已保存（刷新后自动恢复）");
}

function loadParams() {
  const raw = localStorage.getItem(PARAMS_KEY);
  if (!raw) {
    showToast("⚠️ 还没有保存过的参数");
    return;
  }
  try {
    const data = JSON.parse(raw);
    for (const k of PARAM_KEYS) if (k in data) params[k] = data[k];
  } catch (e) {
    showToast("❌ 载入失败，数据已损坏");
    return;
  }
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  applyFlightGroups(); // 恢复飞线分组
  showToast("📥 已载入上次保存的参数");
}

function resetParams() {
  for (const k of PARAM_KEYS) params[k] = DEFAULT_PARAMS[k];
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  applyFlightGroups();
  showToast("↺ 已恢复默认参数");
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
  showToast("⬇️ 已导出 JSON 文件");
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
        showToast(`📥 已导入 ${count} 项参数`);
      } catch (e) {
        showToast("❌ 导入失败：不是有效的参数 JSON");
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
  // 城市名
  ctx.font = "bold 30px 'Microsoft YaHei', sans-serif";
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
CITIES.forEach((c) => {
  const sprite = makeLabelSprite(c.name, c.color);
  sprite.position.copy(latLonToVec3(c.lat, c.lon, EARTH_RADIUS * 1.005));
  markersGroup.add(sprite);
});
markersGroup.visible = params.markersVisible;
earth.add(markersGroup);

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
  flightLines.rebuild(rowGroups(), params.flightArcHeight);
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
  empty.textContent = "—选择—";
  sel.appendChild(empty);
  flightCityNames.forEach((n) => {
    const o = document.createElement("option");
    o.value = n;
    o.textContent = n;
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
    addBtn.title = "在本组后面增加一个终点（沿用本行起点）";
    addBtn.addEventListener("click", () => {
      flightRows.splice(idx + 1, 0, { source: row.source, target: "" });
      renderFlightTable();
      rebuildFlight();
    });
    const delBtn = document.createElement("button");
    delBtn.className = "del";
    delBtn.textContent = "－";
    delBtn.title = "删除本行";
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
      toggle.textContent = panel.classList.contains("collapsed") ? "展开" : "收起";
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
applyFlightGroups();

// ---------------------------------------------------------------------------
// 场景灯光（用于云层；地球用自定义着色器，不受影响）
// ---------------------------------------------------------------------------
const dirLight = new THREE.DirectionalLight(0xffffff, 2.2);
dirLight.position.copy(sunDirection).multiplyScalar(10);
scene.add(dirLight);

const ambientLight = new THREE.AmbientLight(0x223344, 0.8);
scene.add(ambientLight);

// ---------------------------------------------------------------------------
// lil-gui 参数面板
// ---------------------------------------------------------------------------
const gui = new GUI({ title: "🌍 地球参数" });

// 昼夜 / 时段
const fDay = gui.addFolder("昼夜 · 时段");
fDay.add(params, "timePreset", ["auto", "noon", "dusk", "dawn", "night"])
  .name("时段预设")
  .onChange((v) => applyTimePreset(v));
fDay.add(params, "sunElevationDeg", -10, 90, 1).name("太阳高度角");
fDay.add(params, "sunAutoRotate").name("自动昼夜循环");
fDay.add(params, "sunOrbitSpeedDeg", 0, 20, 0.5).name("昼夜循环速度");
fDay.add(params, "transitionWidth", 0.02, 0.6, 0.01).name("晨昏线宽度");
fDay.add(params, "duskStrength", 0, 1, 0.05).name("黄昏暖色强度");
fDay.add(params, "duskWidth", 0.05, 1, 0.05).name("黄昏暖色范围");
fDay.add(params, "dayBoost", 0.2, 2, 0.05).name("白昼亮度");
fDay.add(params, "nightBoost", 0.2, 3, 0.05).name("夜晚灯光亮度");
fDay.add(params, "normalStrength", 0, 2, 0.05).name("法线贴图强度");

// 地球自转
const fEarth = gui.addFolder("地球自转");
fEarth.add(params, "earthSpin").name("自转开关");
fEarth.add(params, "earthSpinSpeed", 0, 0.2, 0.001).name("自转速度");

// 云层
const fCloud = gui.addFolder("云层");
fCloud.add(params, "cloudsVisible").name("显示云层");
fCloud.add(params, "cloudOpacity", 0, 1, 0.05).name("云层不透明度");

// 大气
const fAtm = gui.addFolder("大气辉光");
fAtm.add(params, "atmosphereVisible").name("显示大气");
fAtm.add(params, "atmosphereBrightness", 0, 1, 0.01).name("大气亮度");

// 星空
const fStar = gui.addFolder("星空");
fStar.add(params, "starsVisible").name("显示星空");
fStar.add(params, "starRotate").name("星空旋转");
fStar.add(params, "starRotationSpeed", 0, 0.2, 0.005).name("旋转速度");
fStar.add(params, "starSwayAmplitude", 0, 0.5, 0.01).name("摇摆幅度");
fStar.add(params, "starSwaySpeed", 0, 1, 0.01).name("摇摆频率");
fStar.add(params, "starTwinkle").name("闪烁");
fStar.add(params, "starOpacityMin", 0, 1, 0.05).name("闪烁最暗");
fStar.add(params, "starOpacityMax", 0, 1, 0.05).name("闪烁最亮");

// 城市标注
const fMark = gui.addFolder("城市标注");
fMark.add(params, "markersVisible").name("显示城市点");

// 参数保存 / 载入
const fSave = gui.addFolder("💾 参数");
fSave.add(params, "save").name("保存参数（浏览器记忆）");
fSave.add(params, "load").name("载入上次保存");
fSave.add(params, "import").name("导入 JSON 文件");
fSave.add(params, "reset").name("恢复默认");
fSave.add(params, "export").name("导出为 JSON 文件");

// 护罩
const fShield = gui.addFolder("护罩 · 能量波");
fShield.add(params, "shieldVisible").name("显示护罩");
fShield.add(params, "shieldOpacity", 0, 2, 0.05).name("发光强度");
fShield.add(params, "shieldDirection", {
  "北极→南极": "northToSouth",
  "南极→北极": "southToNorth",
}).name("扫描方向");
fShield.add(params, "shieldScanPeriod", 1, 20, 0.5).name("扫描周期(秒)");
fShield.add(params, "shieldScanDuration", 0.5, 20, 0.5).name("单次扫描时长(秒)");
fShield.add(params, "shieldBandWidth", 0.03, 0.5, 0.01).name("能量带宽度");
fShield.add(params, "shieldRepeat", 1, 10, 1).name("纹理平铺次数");
fShield.add(params, "shieldGlow", 0, 3, 0.05).name("边缘亮度");
fShield.add(params, "shieldFresnel", 1, 6, 0.1).name("边缘锐度");
fShield.addColor(params, "shieldColor").name("护罩颜色");

// 飞线
const fFly = gui.addFolder("✈️ 飞线");
fFly.add(params, "flightVisible").name("显示飞线");
fFly.addColor(params, "flightLineColor").name("飞线颜色");
fFly.add(params, "flightArcHeight", 0.05, 0.9, 0.01)
  .name("弧线高度")
  .onChange(() => applyFlightGroups());
fFly.add(params, "flightCometLength", 5, 200, 1).name("彗星长度");
fFly.add(params, "flightCometWidth", 2, 40, 1).name("彗星粗细");
fFly.add(params, "flightCometSize", 0.5, 8, 0.5).name("彗星大小");
fFly.add(params, "flightSpeed", 0.1, 5, 0.1).name("飞行速度");
fFly.add(params, "flightTrackOpacity", 0, 1, 0.05).name("轨道线透明度");
fFly.addColor(params, "waveColor").name("扩散波颜色");
fFly.add(params, "waveHeight", 0.01, 2.5, 0.01).name("扩散波高度");
fFly.add(params, "waveRadius", 0.01, 2, 0.01).name("扩散波半径");
fFly.add(params, "waveSpeed", 0.2, 3, 0.1).name("扩散波速度");
fFly.add(params, "waveBright", 0.1, 3, 0.1).name("扩散波亮度");

// 折叠部分分组，让面板更紧凑，保存按钮一眼可见（点击可展开）
fEarth.close();
fCloud.close();
fAtm.close();
fStar.close();
fMark.close();
fShield.close();
fFly.close();

// 启动时静默恢复上次保存的参数（若存在），并刷新面板显示
try {
  const raw = localStorage.getItem(PARAMS_KEY);
  if (raw) {
    const data = JSON.parse(raw);
    for (const k of PARAM_KEYS) if (k in data) params[k] = data[k];
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    applyFlightGroups(); // 按恢复的分组重建飞线
  }
} catch (e) {
  /* 忽略损坏的数据 */
}

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

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();
  const elapsed = clock.getElapsedTime();

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
    flightSpeed: params.flightSpeed,
    cometLength: params.flightCometLength,
    cometWidth: params.flightCometWidth,
    cometSize: params.flightCometSize,
    trackOpacity: params.flightTrackOpacity,
    waveColor: params.waveColor,
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
});
