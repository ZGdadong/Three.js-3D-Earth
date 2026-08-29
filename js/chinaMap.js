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
const DEPTH = 0.35; // 挤出高度

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
  return function proj(lon, lat) {
    return [(rawX(lon) - cx) * scale, (rawY(lat) - cy) * scale];
  };
}

function hasLocalData(code) {
  return code && /^\d{6}$/.test(String(code));
}

// ---- 区域顶面材质：深蓝基调 + 辉光 + 扫描能量波 + 悬停变亮 ----
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
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      void main() {
        vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
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
      varying vec3 vWorldPos;
      void main() {
        vec3 col = mix(uColor, uGlow, uGlowAmount * 0.55);
        col = mix(col, uGlow, uHover); // 悬停变亮
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
      varying vec3 vPos;
      varying vec3 vWorldPos;
      void main() {
        float h = clamp(vPos.z / ${DEPTH.toFixed(3)}, 0.0, 1.0);
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

// ---- 单个圆环（带缺口），半径为 radius，铺在 XZ 平面 ----
function buildRingMesh(params, radius) {
  const halfW = params.ringWidth / 2;
  const inner = Math.max(0.02, radius - halfW);
  const outer = radius + halfW;
  // 缺口从 ringGapStart 开始、跨 ringGap 度；实体部分其余都为几何（并防止跨 0°/缠绕）
  const start = ((params.ringGapStart % 360) + 360) % 360;
  const gap = Math.max(1, Math.min(params.ringGap, 360 - start));
  const thetaStart = degToRad(start + gap);
  const thetaLength = degToRad(Math.max(1, 360 - gap));
  const geo = new THREE.RingGeometry(inner, outer, 160, 1, thetaStart, thetaLength);
  const mat = new THREE.MeshBasicMaterial({
    color: params.ringColor,
    transparent: true,
    opacity: params.ringOpacity,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
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

  // ---- 可调参数（供 lil-gui 面板）----
  const chinaParams = {
    // 显示
    glow: 0.4,
    float: 0.24,
    // 旋转圆环
    ringColor: "#3fd0ff",
    ringOpacity: 0.72,
    ringWidth: 0.28,
    ringGap: 55, // 缺口大小（度）
    ringGapStart: 120, // 缺口起始位置（度）
    ringSpeed: 0.45,
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

  // ---- 底部台面 ----
  const floor = makeFloor();
  scene.add(floor.group);

  let ringMeshes = [];
  function applyRings() {
    ringMeshes.forEach((m) => {
      m.geometry.dispose();
      m.material.dispose();
    });
    // 先从支架上移除旧圆环
    floor.ringHolders.forEach((h) => {
      while (h.children.length) h.remove(h.children[0]);
    });
    ringMeshes = [];
    [5.6, 6.4].forEach((radius, i) => {
      const mesh = buildRingMesh(chinaParams, radius);
      mesh.position.y = 0.02;
      floor.ringHolders[i].add(mesh);
      ringMeshes.push(mesh);
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

    const fRing = chinaGui.addFolder(t("china.folderRing"));
    fRing.addColor(chinaParams, "ringColor").name(t("china.ringColor"));
    fRing.add(chinaParams, "ringOpacity", 0, 1, 0.01).name(t("china.ringOpacity"));
    fRing.add(chinaParams, "ringWidth", 0.02, 1.5, 0.02).name(t("china.ringWidth"));
    fRing.add(chinaParams, "ringGap", 0, 360, 1).name(t("china.ringGap"));
    fRing.add(chinaParams, "ringGapStart", 0, 360, 1).name(t("china.ringGapStart"));
    fRing.add(chinaParams, "ringSpeed", 0, 2, 0.05).name(t("china.ringSpeed"));

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
  let currentZMin = -5,
    currentZMax = 5;
  let hovered = null;
  let downX = 0,
    downY = 0,
    downT = 0;
  let clickTimer = null;
  let scanPhase = 0;
  let sideScanPhase = 0;
  let lastRingKey = "";

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
      depth: DEPTH,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 0.06,
      bevelThickness: 0.06,
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
      topMat.uniforms.uGlowAmount.value = chinaParams.glow;
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
      buildLevel(features, "province", adcode, name);
    } catch (err) {
      showToast(t("china.noData").replace("{name}", name));
    }
  }

  async function goBack() {
    if (level === "nation") return;
    await ensureNation();
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
    if (!active) return;
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
    if (!active || ev.button !== 0) return;
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

    // 平滑上浮 / 回落：约 1 秒逼近目标高度（指数缓动）
    const ease = 1 - Math.exp(-3.2 * Math.min(delta, 0.1));
    for (const g of groups) {
      const ty = g.userData.targetY;
      if (Math.abs(g.position.y - ty) > 0.0005) {
        g.position.y += (ty - g.position.y) * ease;
      }
    }

    // 辉光强度
    for (const m of currentTopMats) m.uniforms.uGlowAmount.value = chinaParams.glow;

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
    const sideScanPos = DEPTH * sSweep; // 底部 0 -> 顶部 DEPTH
    const sReveal = sp < dur ? Math.min(sp / fade, (dur - sp) / fade, 1) : 0;
    const sideScanIntensity = chinaParams.sideScanOn ? chinaParams.sideScanIntensity * sReveal : 0;
    for (const m of currentSideMats) {
      m.uniforms.uSideScan.value = sideScanPos;
      m.uniforms.uSideScanWidth.value = chinaParams.sideScanWidth;
      m.uniforms.uSideScanColor.value.set(chinaParams.sideScanColor);
      m.uniforms.uSideScanIntensity.value = sideScanIntensity;
    }

    // ---- 旋转圆环 ----
    const bSpeed = chinaParams.ringSpeed;
    floor.ringHolders[0].rotation.y += delta * bSpeed;
    floor.ringHolders[1].rotation.y -= delta * bSpeed;
    // 颜色 / 透明度
    for (const m of ringMeshes) {
      m.material.color.set(chinaParams.ringColor);
      m.material.opacity = chinaParams.ringOpacity;
    }
    // 几何参数（缺口 / 宽度 / 起始角）变化时重建
    const ringKey = `${chinaParams.ringWidth}|${chinaParams.ringGap}|${chinaParams.ringGapStart}`;
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
