// ============================================================================
//  动态飞线（FlightLines）模块
//  综合两篇飞线文章的实现：
//   - 小江博客：两点间的贝塞尔弧线 + 循环流动的“彗星”粒子（Points + 着色器）
//   - Juejin《最佳实践》：轨道线( TubeGeometry ) + 飞线( Points 着色器 aIndex/uTime )
//  并在终点城市叠加“圆形扩散波”（Wall Shader：竖直圆管 + 高度渐变 + 半径扩展）
//
//  特性：
//   - 支持多组 【1 个起点城市 + n 个终点城市】
//   - 城市：世界主流城市 + 中国一线/二线城市（含坐标）
//   - 不显示城市名称
//   - 可设置飞线颜色 / 形状（弧线高度、彗星长度宽度）
//   - 终点城市扩散波：可设置高度、亮度、速度、半径
// ============================================================================

import * as THREE from "three";

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 城市数据库（名称 -> 经纬度）。可自行增删；名称不显示，仅用于定位。
// ---------------------------------------------------------------------------
export const CITIES = [
  // 世界主流城市
  { name: "东京", lat: 35.7, lon: 139.7 },
  { name: "首尔", lat: 37.6, lon: 127.0 },
  { name: "新加坡", lat: 1.35, lon: 103.8 },
  { name: "香港", lat: 22.3, lon: 114.2 },
  { name: "台北", lat: 25.0, lon: 121.5 },
  { name: "悉尼", lat: -33.9, lon: 151.2 },
  { name: "墨尔本", lat: -37.8, lon: 145.0 },
  { name: "伦敦", lat: 51.5, lon: -0.13 },
  { name: "巴黎", lat: 48.9, lon: 2.35 },
  { name: "柏林", lat: 52.5, lon: 13.4 },
  { name: "莫斯科", lat: 55.8, lon: 37.6 },
  { name: "纽约", lat: 40.7, lon: -74.0 },
  { name: "洛杉矶", lat: 34.1, lon: -118.2 },
  { name: "旧金山", lat: 37.8, lon: -122.4 },
  { name: "芝加哥", lat: 41.9, lon: -87.6 },
  { name: "多伦多", lat: 43.7, lon: -79.4 },
  { name: "墨西哥城", lat: 19.4, lon: -99.1 },
  { name: "圣保罗", lat: -23.5, lon: -46.6 },
  { name: "里约", lat: -22.9, lon: -43.2 },
  { name: "布宜诺斯艾利斯", lat: -34.6, lon: -58.4 },
  { name: "开罗", lat: 30.0, lon: 31.2 },
  { name: "迪拜", lat: 25.2, lon: 55.3 },
  { name: "孟买", lat: 19.1, lon: 72.9 },
  { name: "德里", lat: 28.6, lon: 77.2 },
  { name: "曼谷", lat: 13.8, lon: 100.5 },
  { name: "雅加达", lat: -6.2, lon: 106.8 },
  { name: "吉隆坡", lat: 3.1, lon: 101.7 },
  { name: "马尼拉", lat: 14.6, lon: 121.0 },
  { name: "河内", lat: 21.0, lon: 105.8 },
  { name: "伊斯坦布尔", lat: 41.0, lon: 28.9 },
  { name: "约翰内斯堡", lat: -26.2, lon: 28.0 },
  { name: "内罗毕", lat: -1.3, lon: 36.8 },
  { name: "开普敦", lat: -33.9, lon: 18.4 },
  { name: "奥克兰", lat: -36.8, lon: 174.8 },

  // 中国一线 / 二线城市
  { name: "北京", lat: 39.9, lon: 116.4 },
  { name: "上海", lat: 31.2, lon: 121.5 },
  { name: "广州", lat: 23.1, lon: 113.3 },
  { name: "深圳", lat: 22.5, lon: 114.1 },
  { name: "成都", lat: 30.6, lon: 104.1 },
  { name: "杭州", lat: 30.3, lon: 120.2 },
  { name: "武汉", lat: 30.6, lon: 114.3 },
  { name: "西安", lat: 34.3, lon: 108.9 },
  { name: "重庆", lat: 29.6, lon: 106.5 },
  { name: "南京", lat: 32.1, lon: 118.8 },
  { name: "天津", lat: 39.1, lon: 117.2 },
  { name: "长沙", lat: 28.2, lon: 113.0 },
  { name: "郑州", lat: 34.7, lon: 113.6 },
  { name: "青岛", lat: 36.1, lon: 120.4 },
  { name: "大连", lat: 38.9, lon: 121.6 },
  { name: "昆明", lat: 25.0, lon: 102.7 },
  { name: "厦门", lat: 24.5, lon: 118.1 },
  { name: "苏州", lat: 31.3, lon: 120.6 },
  { name: "沈阳", lat: 41.8, lon: 123.4 },
  { name: "济南", lat: 36.7, lon: 117.0 },
  { name: "哈尔滨", lat: 45.8, lon: 126.6 },
  { name: "福州", lat: 26.1, lon: 119.3 },
  { name: "合肥", lat: 31.8, lon: 117.2 },
  { name: "石家庄", lat: 38.0, lon: 114.5 },
  { name: "太原", lat: 37.9, lon: 112.5 },
  { name: "南昌", lat: 28.7, lon: 115.9 },
  { name: "贵阳", lat: 26.6, lon: 106.7 },
  { name: "兰州", lat: 36.1, lon: 103.8 },
  { name: "乌鲁木齐", lat: 43.8, lon: 87.6 },
  { name: "呼和浩特", lat: 40.8, lon: 111.7 },
  { name: "南宁", lat: 22.8, lon: 108.3 },
  { name: "海口", lat: 20.0, lon: 110.3 },
  { name: "拉萨", lat: 29.7, lon: 91.1 },
  { name: "银川", lat: 38.5, lon: 106.2 },
  { name: "西宁", lat: 36.6, lon: 101.8 },
  { name: "长春", lat: 43.8, lon: 125.3 },
];

// 由城市名快速查找
const CITY_MAP = Object.fromEntries(CITIES.map((c) => [c.name, c]));

// 经纬度 -> 球面坐标（与地球模型同一空间）
function latLonToVec3(lat, lon, r) {
  const phi = (90 - lat) * DEG;
  const theta = (lon + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  );
}

// 计算两点间“贴着球面、再径向抬高”的弧线采样点（任意距离都不会穿入地球）
function arcPoints(srcUnit, dstUnit, R, height, divisions) {
  const s = srcUnit.clone();
  const d = dstUnit.clone();
  const pts = [];
  for (let i = 0; i <= divisions; i++) {
    const t = i / divisions;
    let dir = s.clone().lerp(d, t);
    if (dir.lengthSq() < 1e-6) dir = s.clone().cross(d).normalize(); // 近似对跖点时的保护
    dir.normalize();
    const lift = R * height * Math.sin(Math.PI * t);
    pts.push(dir.multiplyScalar(R + lift));
  }
  return pts;
}

// 轨道线顶点着色器：pass 高度（局部Y）用于渐变
const TRACK_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const TRACK_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uOpacity;
  varying vec2 vUv;
  void main() {
    gl_FragColor = vec4(uColor, uOpacity);
  }
`;

// 飞线（彗星）顶点着色器：只显示 uTime 附近的一段连续点，并让尾部渐变
const FLY_VERT = /* glsl */ `
  attribute float aIndex;
  uniform float uTime;
  uniform float uLength;
  uniform float uWidth;
  uniform float uSize;
  varying float vSize;
  void main() {
    vec4 viewPosition = viewMatrix * modelMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewPosition;
    vSize = 0.0;
    if (aIndex >= uTime - uLength && aIndex < uTime) {
      vSize = (aIndex + uLength - uTime) / uWidth; // 头部最粗，尾部渐变
    }
    gl_PointSize = max(vSize, 0.0) * uSize * (6.0 / -viewPosition.z);
  }
`;
const FLY_FRAG = /* glsl */ `
  varying float vSize;
  uniform vec3 uColor;
  void main() {
    if (vSize <= 0.0) { gl_FragColor = vec4(0.0); return; }
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    float alpha = smoothstep(0.5, 0.0, d); // 圆形软点
    gl_FragColor = vec4(uColor, alpha);
  }
`;

// 扩散波（Wall Shader）顶点着色器
const WAVE_VERT = /* glsl */ `
  varying float vLocalY;
  void main() {
    vLocalY = position.y; // 局部高度（沿城市表面法线向外）
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const WAVE_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uBright;
  uniform float uMinY;
  uniform float uMaxY;
  uniform float uFade; // 随扩展淡出
  varying float vLocalY;
  void main() {
    float h = clamp((vLocalY - uMinY) / (uMaxY - uMinY + 1e-4), 0.0, 1.0);
    float opacity = (1.0 - h) * uBright * uFade; // 底部亮、顶部透明
    gl_FragColor = vec4(uColor, opacity);
  }
`;

// ---------------------------------------------------------------------------
//  飞线图层：管理多组飞线 + 终点扩散波
// ---------------------------------------------------------------------------
export class FlightLines {
  constructor(parent, { radius }) {
    this.parent = parent; // 挂在 earth 下，随地球自转
    this.radius = radius;
    this.group = new THREE.Group();
    this.group.name = "flightLines";
    parent.add(this.group);

    this.lines = []; // 每条飞线
    this.ripplesMap = new Map(); // destName -> ripple
    this.ripples = [];
    this.disposed = false;
  }

  // 根据 groups 重建飞线与扩散波
  // groups = [{ source:'北京', targets:['上海','纽约',...] }, ...]
  rebuild(groups, arcHeight = 0.35, trackWidth = 0.012) {
    this.clear();
    (groups || []).forEach((g) => {
      const src = CITY_MAP[g.source];
      if (!src) {
        console.warn(`[FlightLines] 未知起点城市: ${g.source}`);
        return;
      }
      const srcPos = latLonToVec3(src.lat, src.lon, this.radius);
      const srcUnit = srcPos.clone().normalize();
      (g.targets || []).forEach((tname) => {
        const dst = CITY_MAP[tname];
        if (!dst) {
          console.warn(`[FlightLines] 未知终点城市: ${tname}`);
          return;
        }
        const dstPos = latLonToVec3(dst.lat, dst.lon, this.radius);
        const dstUnit = dstPos.clone().normalize();
        this._addLine(srcPos.clone(), dstPos.clone(), srcUnit, dstUnit, tname, arcHeight, trackWidth);
      });
    });
  }

  _addLine(srcPos, dstPos, srcUnit, dstUnit, destName, arcHeight, trackWidth) {
    const divisions = 180;
    const pts = arcPoints(srcUnit, dstUnit, this.radius, arcHeight, divisions);

    // ---- 轨道线（TubeGeometry）----
    const curve = new THREE.CatmullRomCurve3(pts);
    const trackGeo = new THREE.TubeGeometry(curve, divisions, trackWidth, 8, false);
    const trackMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color("#3a6aa0") },
        uOpacity: { value: 0.28 },
      },
      vertexShader: TRACK_VERT,
      fragmentShader: TRACK_FRAG,
    });
    const trackMesh = new THREE.Mesh(trackGeo, trackMat);
    this.group.add(trackMesh);

    // ---- 飞线（Points + 着色器）----
    const positions = new Float32Array((divisions + 1) * 3);
    const aIndex = new Float32Array(divisions + 1);
    pts.forEach((p, i) => {
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
      aIndex[i] = i;
    });
    const flyGeo = new THREE.BufferGeometry();
    flyGeo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    flyGeo.setAttribute("aIndex", new THREE.BufferAttribute(aIndex, 1));

    const flyMat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      depthTest: true, // 参与深度测试：被地球遮挡，背面时隐藏
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: Math.random() * divisions },
        uLength: { value: 60 },
        uWidth: { value: 10 },
        uSize: { value: 4 },
        uColor: { value: new THREE.Color("#4fd0ff") },
      },
      vertexShader: FLY_VERT,
      fragmentShader: FLY_FRAG,
    });
    const fly = new THREE.Points(flyGeo, flyMat);
    fly.renderOrder = 5;
    this.group.add(fly);

    const total = divisions; // uTime 滚动范围 = 点数（0..divisions）
    this.lines.push({
      flyMat,
      trackMat,
      uTime: flyMat.uniforms.uTime.value,
      divisions,
      total,
      speed: 0.9 + Math.random() * 0.4, // 每条稍微不同
      prevUTime: flyMat.uniforms.uTime.value,
      destName,
      destPos: dstPos,
    });
  }

  // 在某终点创建扩散波（每个终点一个）
  _ensureRipple(destName, destPos) {
    if (this.ripplesMap.has(destName)) return this.ripplesMap.get(destName);
    const normal = destPos.clone().normalize();
    const ripple = this.makeRipple(destPos, normal);
    this.ripplesMap.set(destName, ripple);
    this.ripples.push(ripple);
    return ripple;
  }

  makeRipple(destPos, normal) {
    // 扩散波 = 竖直圆管（沿城市法线向外）+ 高度渐变 + 半径扩展
    const height = 0.6; // 波高（可运行时覆盖）
    const curve = new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3(0, height, 0));
    const geo = new THREE.TubeGeometry(curve, 16, 0.6, 64, false);
    geo.computeBoundingBox();
    const minY = geo.boundingBox.min.y;
    const maxY = geo.boundingBox.max.y;

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color("#40e0ff") },
        uBright: { value: 1.0 },
        uMinY: { value: minY },
        uMaxY: { value: maxY },
        uFade: { value: 1.0 },
      },
      vertexShader: WAVE_VERT,
      fragmentShader: WAVE_FRAG,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;

    const group = new THREE.Group();
    group.position.copy(destPos);
    // 让局部 +Y 对准城市法线（指向球外）
    const q = new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      normal,
    );
    group.quaternion.copy(q);
    group.add(mesh);
    group.visible = false;
    this.group.add(group);

    return { group, mesh, mat, phase: 1, active: false };
  }

  // 到达终点 -> 触发该终点的扩散波（重置相位）
  _triggerRipple(destName, destPos) {
    const ripple = this._ensureRipple(destName, destPos);
    ripple.phase = 0;
    ripple.active = true;
    ripple.group.visible = true;
  }

  // 每帧更新
  update(delta, elapsed, style) {
    if (this.disposed) return;
    const color = style.lineColor || "#4fd0ff";
    const width = style.cometWidth ?? 10;
    const length = style.cometLength ?? 60;
    const size = style.cometSize ?? 4;
    const waveColor = style.waveColor || "#40e0ff";
    const waveHeight = style.waveHeight ?? 0.6;
    const waveRadius = style.waveRadius ?? 0.6;
    const waveSpeed = style.waveSpeed ?? 0.9;
    const waveBright = style.waveBright ?? 1.0;
    const visible = style.visible !== false;
    const trackOpacity = style.trackOpacity ?? 0.28;

    this.group.visible = visible;
    if (!visible) return;

    this.lines.forEach((l) => {
      // 推进彗星 uTime：约 4 秒从起点飞到终点（uTime 爬满 divisions）
      const perSec = (l.total / 4) * (style.flightSpeed ?? 1);
      l.uTime += delta * perSec * l.speed;
      if (l.uTime >= l.total) {
        l.uTime -= l.total;
        // 到达终点 -> 触发扩散波
        this._triggerRipple(l.destName, l.destPos);
      }
      l.flyMat.uniforms.uTime.value = l.uTime;
      l.flyMat.uniforms.uLength.value = length;
      l.flyMat.uniforms.uWidth.value = width;
      l.flyMat.uniforms.uSize.value = size;
      l.flyMat.uniforms.uColor.value.set(color);
      l.trackMat.uniforms.uColor.value.set(style.trackColor || color);
      l.trackMat.uniforms.uOpacity.value = trackOpacity;
    });

    // 更新扩散波
    this.ripples.forEach((r) => {
      if (!r.active) return;
      r.phase += delta * waveSpeed;
      if (r.phase >= 1) {
        r.phase = 1;
        r.active = false;
        r.group.visible = false;
        return;
      }
      const p = r.phase; // 0..1
      const s = 0.02 + p; // 半径缩放进度
      const rScale = s * (waveRadius / 0.6); // 基础管半径 0.6
      const hScale = waveHeight / 0.6; // 基础管高 0.6
      r.mesh.scale.set(rScale, hScale, rScale);
      r.mat.uniforms.uFade.value = 1 - p; // 越扩越淡
      r.mat.uniforms.uBright.value = waveBright;
      r.mat.uniforms.uColor.value.set(waveColor);
    });
  }

  clear() {
    // 从场景移除并释放
    this.lines.forEach((l) => {
      l.flyMat.dispose && l.flyMat.dispose();
      l.trackMat.dispose && l.trackMat.dispose();
    });
    this.ripples.forEach((r) => r.mat.dispose && r.mat.dispose());
    this.lines = [];
    this.ripples = [];
    this.ripplesMap.clear();
    // 清空 group 子节点
    while (this.group.children.length) {
      const c = this.group.children[0];
      this.group.remove(c);
      if (c.geometry) c.geometry.dispose();
      if (c.material) c.material.dispose();
    }
  }

  dispose() {
    this.clear();
    this.parent.remove(this.group);
    this.disposed = true;
  }
}
