# Three.js 3D 地球 · 技术文档（学习用）

> 本项目实现了一个真实风格的 3D 地球，核心是**自定义 GLSL 着色器**实现昼夜切换、法线贴图地形、以及一个"能量波扫描"的八边形护罩。本文从零讲清楚每个系统，含代码与逐行讲解，适合边看边学。

---

## 0. 你能学到什么

- Three.js 基础：Scene / Camera / WebGLRenderer / OrbitControls / Mesh / Material
- 自定义**顶点+片元着色器**（`ShaderMaterial`）与 GLSL 概念（varying、uniform、法线、点积、smoothstep、mix、fresnel）
- **昼夜切换**：白天/黑夜贴图按太阳方向加权混合
- **法线贴图**：切线空间法线映射（TBN）让地形有立体感
- **菲涅尔（fresnel）**：边缘发光
- **程序化贴图**：用 Canvas 生成八边形网格
- **动画主循环**：uniform 随时间更新
- **lil-gui 参数面板** 与 **localStorage 参数持久化**

---

## 1. 项目结构与运行

```
StudyThree.js/
├─ index.html      # 入口：importmap 引入 three.js + lil-gui，加载层、HUD、语言条
├─ js/main.js      # 全部逻辑（约 1200 行）
├─ js/i18n.js      # 多语言加载器（Languages/*.json、切换、持久化、t() 翻译）
├─ Languages/      # 多语言语言包（每语言一个 JSON，含 BCP 47 说明）
└─ images/         # 8K 贴图
```

`index.html` 用 `<script type="importmap">` 把 `three` 等映射到 CDN，`main.js` 以 ES Module 方式 `import`。由于浏览器对 `file://` 加载本地贴图有限制，需要一个本地服务器（`python -m http.server 8080`），然后访问 `http://127.0.0.1:8080/index.html`。

---

## 2. 场景基础

```js
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
camera.position.set(0, 0.8, 6.5);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.outputColorSpace = THREE.SRGBColorSpace;   // 颜色空间
renderer.toneMapping = THREE.ACESFilmicToneMapping; // 色调映射
const controls = new OrbitControls(camera, renderer.domElement);
```

- **PerspectiveCamera**：透视相机，`fov=45`，放在 (0, 0.8, 6.5)，看向原点。
- **OrbitControls**：鼠标拖拽旋转、滚轮缩放、右键平移。
- **ACES 色调映射**：让高光更柔和，画面更像电影。
- `outputColorSpace = SRGBColorSpace`：因为贴图是 sRGB 的，渲染器把它解码到线性空间计算、再编码回 sRGB 输出，保证颜色准确。

---

## 3. 昼夜切换着色器（核心）

地球是 `SphereGeometry` + `ShaderMaterial`。着色器要解决：**地球某一点此刻是白天还是黑夜，以及怎样柔和过渡**。

思路：太阳方向是已知的（`sunDirection`，一个世界空间向量）。地球表面每个点的**法线**指向球外。当法线与太阳方向**同向**（点积大）→ 白天；**反向**（点积小）→ 黑夜；介于中间 → 晨昏过渡。

### 3.1 顶点着色器

```glsl
attribute vec3 tangent;                 // 切线（用于法线贴图，3.4 节）
varying vec2 vUv;                       // 纹理坐标，传给片元
varying vec3 vNormal;                   // 世界空间法线
varying mat3 vTbn;                      // 切线空间→世界空间 的矩阵

void main() {
  vUv = uv;                                             // three 内置 attribute
  vec3 normalW   = normalize(mat3(modelMatrix) * normal);
  vec3 tangentW  = normalize(mat3(modelMatrix) * tangent);
  vec3 bitangentW = normalize(cross(normalW, tangentW)); // 副切线 = 法线 × 切线
  vNormal = normalW;
  vTbn = mat3(tangentW, bitangentW, normalW);           // 列向量组成的矩阵
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
```

要点：
- `uv`、`normal`、`position`、`modelMatrix`、`projectionMatrix`、`modelViewMatrix` 是 `ShaderMaterial` **内置**的 attribute/uniform，直接用。
- `normalMatrix` 法线要变到世界空间用 `mat3(modelMatrix)`（地球只有旋转，无缩放，可直接用模型矩阵的 3×3；严格做法用 `normalMatrix`，但那是在视图空间）。
- `mat3(T, B, N)` 创建以 T、B、N 为**列**的矩阵，后续把切线空间的法线贴图向量转换到世界空间。

### 3.2 片元着色器

```glsl
uniform sampler2D dayTexture;
uniform sampler2D nightTexture;
uniform sampler2D normalMap;
uniform vec3 sunDirection;
uniform float transitionWidth;  // 晨昏线宽度
uniform float duskStrength;     // 黄昏暖色强度
uniform float duskWidth;        // 黄昏暖色范围
uniform float dayBoost;         // 白昼亮度
uniform float nightBoost;       // 夜晚灯光亮度
uniform float normalStrength;   // 法线贴图强度
uniform float lowSun;           // 0=正午, 1=太阳贴近地平线

varying vec2 vUv;
varying vec3 vNormal;
varying mat3 vTbn;

vec3 perturbNormal() {
  vec3 mapNormal = texture2D(normalMap, vUv).rgb * 2.0 - 1.0; // [0,1]→[-1,1]
  mapNormal.xy *= normalStrength;                            // 只想放大切向扰动
  return normalize(vTbn * normalize(mapNormal));             // 转到世界空间
}

void main() {
  vec3 lightDir = normalize(sunDirection);
  vec3 normal = perturbNormal();

  float dotProduct = dot(normal, lightDir);

  // 晨昏线平滑过渡
  float start = -transitionWidth * 0.5;
  float end   =  transitionWidth * 0.5;
  float dayFactor = smoothstep(start, end, dotProduct); // 0=夜, 1=昼

  vec3 dayColor   = texture2D(dayTexture, vUv).rgb * dayBoost;
  vec3 nightColor = texture2D(nightTexture, vUv).rgb * nightBoost;
  vec3 color = mix(nightColor, dayColor, dayFactor);     // 夜/昼按比例混合

  // 黄昏金色暖调
  float terminatorGlow = 1.0 - smoothstep(0.0, duskWidth, max(dotProduct, 0.0));
  float warm = lowSun * terminatorGlow * dayFactor;
  color = mix(color, color * vec3(1.0, 0.62, 0.35), warm * duskStrength);

  // 亮度随昼夜因子变化
  color *= mix(0.4, 1.0, dayFactor);

  gl_FragColor = vec4(color, 1.0);
}
```

### 3.3 逐行理解

1. **`dot(normal, lightDir)`**：两个单位向量的点积 = `cos(θ)`，θ 是法线与太阳方向的夹角。法线指向太阳（θ=0）→ 点积=1（最亮）；背对太阳（θ=180°）→ -1（最黑）。
2. **`smoothstep(start, end, dotProduct)`**：把点积 `[-1,1]` 平滑映射到 `[0,1]`。在 `start` 之前=0（夜），`end` 之后=1（昼），中间平滑过渡——这就是**晨昏线**。`transitionWidth` 越大过渡越宽、越柔和。
3. **`mix(nightColor, dayColor, dayFactor)`**：两者按 dayFactor 线性插值。dayFactor=1 → 白昼贴图；=0 → 夜晚贴图（城市灯光）。
4. **暖调**：`max(dotProduct,0)` 在晨昏线附近接近 0，`1-smoothstep(0,duskWidth,·)` 在晨昏线附近≈1（`terminatorGlow`）。再乘 `lowSun`（太阳越低越暖）和 `dayFactor`，得到只在"日出日落"区域出现的**金橙色**，这正是正午与黄昏的区别。
5. **亮度曲线**：`mix(0.4,1.0,dayFactor)` —— 晨昏过渡带偏暗、白昼偏亮，进一步区分时段。

---

## 4. 法线贴图（地形立体感）

法线贴图不存颜色，存的是每个像素"表面朝向的偏移"：`(R,G,B)` ≈ `(切线方向, 副切线方向, 法线方向)`，中性值 `(128,128,255)` 表示平坦。

- `texture2D(normalMap, uv).rgb * 2.0 - 1.0`：把 `[0,1]` 映射到 `[-1,1]`，得到法线向量。
- 通常只需要放大 XY（切平面）的扰动，`mapNormal.xy *= normalStrength`；`normalStrength=0` 时得到 `(0,0,1)`（平坦），法线贴图失效。**面板的「法线贴图强度」就是调它。**
- 因为贴图法线是**切线空间**的，需要用 TBN（切线/副切线/法线）矩阵转到世界空间：`vTbn * mapNormal`。
- 使用前要 `earthGeometry.computeTangents()` 生成 `tangent` attribute（计算切线需要 uv 和 normal，均已有）。

观察：**低角度光照（黄昏/黎明）下地形起伏的明暗最明显**，因为光线贴着地面擦过，凸起会投下很长的明暗梯度。

---

## 5. 云层 & 大气辉光

### 云层
用 `MeshPhongMaterial` + 云层贴图，透明、`depthWrite:false`，是略大于地球的球体。Phong 材质会被场景里的 `DirectionalLight` 照亮（太阳方向），所以云层在**白天侧亮、黑夜侧暗**，与地球昼夜一致。

### 大气辉光（背面菲涅尔）
```glsl
float intensity = pow(0.72 - dot(vNormal, vec3(0.0,0.0,1.0)), 2.5);
gl_FragColor = vec4(glowColor, 1.0) * intensity * brightness;
```
- 顶点把法线变到**视图空间** `normalMatrix * normal`。
- 片元算"法线朝向屏幕外"的程度：正对屏幕（dot≈1）→ `0.72-1` 很小；在球体**轮廓边缘**法线几乎垂直屏幕（dot≈0）→ `0.72` 较大 → 边缘亮。
- `BackSide`（看球体背面）+ `AdditiveBlending`：在球体边缘形成一圈蓝色光晕。`brightness` 控制亮度。

---

## 6. 星空

用一个大球体（半径 300）贴 `8k_stars.jpg`，`BackSide`（从内部看），透明、`depthWrite:false`。动画里：
- **旋转**：`rotation.y += delta * speed`，并加了一点上下摇摆 `rotation.x = sin(t)*amp`。
- **闪烁**：随机目标透明度 + 平滑逼近，实现"一闪一闪"。
  ```js
  starTargetOpacity = min + Math.random()*(max-min);
  starMaterial.opacity += (starTargetOpacity - starMaterial.opacity) * Math.min(1, delta*20);
  ```

---

## 7. 护罩（能量波扫描）★ 重点

护罩是略大于地球的球体（`EARTH_RADIUS*1.06`），`ShaderMaterial`，`AdditiveBlending`，`FrontSide`，`depthWrite:false`。核心是：**八边形网原地不动，一道能量波沿纬度从北极扫到南极，只有波经过的地方才点亮。**

### 7.1 程序化生成八边形贴图（Canvas）
```js
function makeShieldTexture() {
  const size = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const cell = 64, R = 36;                 // 一格放一个八边形
  const cols = size / cell;                // 16
  // 隔行错开半格，形成"交错咬合"感；在 [-1, cols] 范围绘制保证无缝平铺
  for (let r = -1; r <= cols; r++)
    for (let c = -1; c <= cols; c++) {
      const cx = (c + (r % 2 ? 0.5 : 0)) * cell + cell / 2;
      const cy = r * cell + cell / 2;
      // 画顶点朝上的正八边形（8 个顶点）
      ctx.beginPath();
      for (let k = 0; k < 8; k++) {
        const a = Math.PI/8 + k*Math.PI/4;
        const x = cx + R*Math.cos(a), y = cy + R*Math.sin(a);
        k===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.closePath();
      ctx.shadowColor = "#3fd0ff"; ctx.shadowBlur = 14;   // 外发光
      ctx.strokeStyle = "#3fd0ff"; ctx.lineWidth = 3; ctx.stroke();
      ctx.shadowBlur = 4; ctx.strokeStyle = "#bffaff"; ctx.lineWidth = 1.4; ctx.stroke();
      // 顶点亮结点
      ...
    }
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;   // 可平铺
  return t;
}
```
- **正八边形**：8 个顶点，角度是 `π/8 + k·π/4`（顶点朝上）。
- **隔行错半格**（`c + (r%2 ? 0.5 : 0)`）产生"交错"视觉。
- **在与画布边缘再往外画一圈**（`-1..cols`），配合 `RepeatWrapping`，保证上下/左右滚动**无缝**。

### 7.2 护罩片元着色器（门控 + 能量带）
```glsl
vec2 uv = fract(vUv * uRepeat);            // 静止的八边形网（原地不动）
vec4 pattern = texture2D(map, uv);
float net = dot(pattern.rgb, vec3(0.299,0.587,0.114)); // 亮度

float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormal))), uFresnel); // 轮廓

float d = vUv.y - uWave;                                   // 距波中心的纬度距离
float band  = exp(-pow(d / uBandWidth, 2.0));              // 主能量带（高斯）
float front = exp(-pow((vUv.y-(uWave+uBandWidth*0.8))/(uBandWidth*0.3), 2.0)); // 前缘亮线
float trail = exp(-pow((vUv.y-(uWave-uBandWidth*1.8))/(uBandWidth*1.2), 2.0))*0.35; // 余辉
float gate  = clamp(band + front*0.7 + trail, 0.0, 1.0);   // "波经过才显示"

vec3 col = uColor*net*uGlow*pulse + uColor*fresnel*0.7 + uColor*(band*0.4+front*0.8);
float alpha = clamp((net*0.9+fresnel*0.7)*gate + gate*0.45, 0.0, 1.0) * uOpacity;
gl_FragColor = vec4(col*uReveal, alpha*uReveal);           // uReveal 支持"扫描空档"
```

理解：
- `band` 是一个**高斯函数** `exp(-(d/width)²)`，在波中心最大、向两侧快速衰减 → 形成一道横向光带。
- `gate` 把**透明度**限制在波附近：波外 `gate≈0 → alpha≈0 → 护罩不可见`。所以"只有波经过的地方才显示"。
- `front` 是在波前方更亮的一条**锐利亮线**，`trail` 是身后渐弱的余辉，让波看起来像有方向、有"能量"。
- `uReveal` 进一步控制整体明暗（用于扫描完成后留空档时整层隐藏）。

### 7.3 扫描逻辑（方向 / 周期 / 单次时长）
```js
shieldWavePhase += delta;                       // 累计真实秒
const period = max(0.1, params.shieldScanPeriod);      // 扫描周期（秒）
const dur    = min(max(0.1, params.shieldScanDuration), period); // 单次时长
const cycleTime = shieldWavePhase % period;
const sweep = min(cycleTime / dur, 1);                 // 0..1 扫动进度
// 方向：北极→南极 = 0→1；南极→北极 = 1→0
uWave.value = params.shieldDirection === "southToNorth" ? 1 - sweep : sweep;
// 揭示度：扫动时为1，空档为0，起止带软边
const fade = min(0.6, dur*0.25);
uReveal.value = cycleTime < dur
  ? min(cycleTime/fade, (dur-cycleTime)/fade, 1)
  : 0;
```
- **`sweep`**：`cycleTime/dur` 从 0→1，即波从北极（0）走到南极（1）。若 `dur < period`，扫完后 `sweep` 停在 1，剩余时间是**空档**。
- **`uReveal`**：扫动时为 1，空档时为 0（护罩整层隐藏）；起止各有一段 `fade` 软边，避免突然出现/消失。
- **方向**：`northToSouth` → `uWave = sweep`（0→1）；`southToNorth` → `uWave = 1-sweep`（1→0）。
- **总周期** = `period` 秒，其中扫动占 `dur` 秒。默认（`period = 10`、`dur = 6`）即每 10 秒一次扫描、扫 6 秒、留 4 秒空档；两者都可在右面板实时调整。

### 7.4 护罩可调参数（速查）
`护罩透明度`（= `shieldOpacity`，驱动 `uOpacity`，0~2）、`护罩颜色`（`uColor`）、`纹理平铺次数`（`uRepeat`，1~30）、`能量带宽度`（`uBandWidth`）、`扫描方向/周期(秒)/单次时长(秒)`、`边缘亮度`（`uGlow`）、`边缘锐度`（`uFresnel`）。

---

## 8. 城市标注（经纬度 → 3D 坐标）

```js
function latLonToVec3(lat, lon, r) {
  const phi   = degToRad(90 - lat);   // 极角：从北极(0) 到南极(π)
  const theta = degToRad(lon + 180);  // 方位角
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  );
}
```
- 纬度 `lat` 换算成极角 `φ`（0=北极，180°=南极）。
- 经度 `lon` 换算成绕 Y 轴的方位角。
- 得到球面上的点后，放在略高于地球表面处（`EARTH_RADIUS*1.005`），用 `Sprite`（始终面向相机）贴上图文字标签。标注组挂在 `earth` 节点下，**随地球一起自转**。

---

## 9. 参数面板（lil-gui）与持久化

### 9.1 lil-gui
```js
import GUI from "lil-gui";
const gui = new GUI({ title: "🌍 地球参数" });
const fDay = gui.addFolder("昼夜 · 时段");
fDay.add(params, "timePreset", ["auto","noon","dusk","dawn","night"]).name("时段预设");
fDay.add(params, "sunElevationDeg", -10, 90, 1).name("太阳高度角");
fDay.addColor(params, "shieldColor").name("护罩颜色");   // 颜色选择器
```
- `.add(obj, key)`：把对象属性和控件绑定，改控件就改对象，改对象就改控件。
- `gui.addFolder()` 生成可折叠分组；`gui.add(obj, fn)` 生成"按钮"（点击调用函数）。

### 9.2 刷新面板（易踩的坑）
`gui.controllers` **不包含**文件夹内的控件。要刷新所有（含子文件夹）显示，用递归：
```js
gui.controllersRecursive().forEach((c) => c.updateDisplay());
```
本项目中"载入/恢复默认/导入"之后都用它把滑杆、下拉框同步到新值。

### 9.3 localStorage 持久化
```js
const PARAM_KEYS = ["timePreset","sunElevationDeg", ...]; // 需要持久化的键
function saveParams() {
  const data = {};
  for (const k of PARAM_KEYS) data[k] = params[k];        // 只存这些键
  localStorage.setItem(PARAMS_KEY, JSON.stringify(data));
}
function applyImported(data) {                            // 载入/共用的逻辑
  let n = 0;
  for (const k of PARAM_KEYS) if (k in data) { params[k] = data[k]; n++; }
  gui.controllersRecursive().forEach((c) => c.updateDisplay());
  return n;
}
```
- **保存**到浏览器 `localStorage`，刷新后自动恢复。
- **导出**：把数据转成 JSON，用 `<a download>` 下载成文件。
- **导入**：`<input type="file">` + `FileReader` 读文件 → `JSON.parse` → `applyImported`。

---

## 10. 动画主循环

```js
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();       // 上一帧到此刻的秒数（帧率无关）
  const elapsed = clock.getElapsedTime(); // 累计秒数

  // 1) 由参数算出太阳方向（方位角/高度角）
  // 2) 把参数同步进各材质 uniforms（太阳方向、晨昏线、亮度、法线强度…）
  // 3) 地球自转 + 云层漂移
  // 4) 星空旋转/摇摆/闪烁
  // 5) 护罩扫描（方向/周期/时长/能量带）
  // 6) 城市标注可见性
  controls.update();
  renderer.render(scene, camera);
}
```
- 用 `delta` 乘以速度，保证**帧率无关**（60fps 和 30fps 位移一样）。
- 每帧把 `params` 写进 `uniforms`（材质实例的 `.value`），改变即生效。

---

## 11. 学习要点小结 / 练习

- **点积与光照**：`dot(normal, lightDir)` 是无数光照效果的基石（昼夜、Lambert、镜面……）。
- **smoothstep / mix / exp**：分别做"平滑阈值"、"线性插值"、"钟形衰减"，把离散开关变成柔和渐变。
- **varying**：把顶点算好的数据（UV、法线）传给片元；片元里是插值后的值。
- **fresnel**：`1 - dot(viewDir, normal)` 在边缘最大，是"发光轮廓"通用手法。
- **切线空间法线贴图**：理解 UV→切线→副切线→法线的正交基（TBN）。

想动手改：
1. 改 `transitionWidth`（晨昏线）观察分界柔和度。
2. 改 `duskStrength`（黄昏暖色）看日出日落色。
3. 改护罩 `shieldBandWidth`（能量带宽度）看扫描光带粗细。
4. 改 `shieldDirection` 看波扫方向变化。
5. 自己写一段 GLSL 加"扫描线/闪烁"或换掉八边形图案。

---

## 12. 动态飞线（多组起点/终点 + 终点扩散波）

`js/flightlines.js` 里是一个独立的 `FlightLines` 类，实现**多组【1 个起点 + n 个终点】**的飞线，以及终点城市的**圆形扩散波**。

### 12.1 城市库与坐标
`CITIES` 是 `{name, lat, lon}` 数组（世界主流 + 中国一/二线）。用之前讲过的 `latLonToVec3` 把经纬度转成球面坐标。

### 12.2 弧线（飞行轨道）
```
贴合球面的大圆 + 径向抬高
for t in [0,1]:
  dir = lerp(srcUnit, dstUnit, t).normalize()   // 球面插值（近似大圆）
  lift = R * height * sin(π t)                  // 两端为 0，中间最高
  pt   = dir * (R + lift)
```
这条曲线**始终在地球外侧**（即使两点近似对跖也不会穿过地球）。采样 180 个点：

- **轨道线**：`new THREE.CatmullRomCurve3(pts)` → `TubeGeometry`，半径 = `flightTrackWidth`（默认 0.012，可调 0.002~0.2），颜色 = `flightTrackColor`，透明度 = `flightTrackOpacity`。做半透明的"底线"。
- **飞线**：把 pts 作为 `Points`，附加 `aIndex`(0..180) 属性，用着色器只显示"移动中的一段"，形成流动的彗星。

### 12.3 飞线（彗星）着色器
```glsl
// 顶点
if (aIndex >= uTime - uLength && aIndex < uTime) {
  vSize = (aIndex + uLength - uTime) / uWidth; // 头部最大，尾部渐变
}
gl_PointSize = max(vSize,0.0) * uSize * (6.0 / -viewPosition.z); // 距离衰减

// 片元：圆形软点
float d = length(gl_PointCoord - 0.5);
alpha = smoothstep(0.5, 0.0, d) * uOpacity;   // uOpacity = 飞线透明度
gl_FragColor = vec4(uColor, alpha);
```
`uTime` 每帧递增（约 4 秒走完 0..180），到 180 表示到达终点 → 触发该终点的扩散波 → 归零重来。

> **深度遮挡**：飞线材质 `depthTest: true`（默认是 `false` 会导致**在地球背面的飞线也透视显示**）。开深度测试后，飞线被地球正确遮挡：正面可见、背面隐藏。（轨道线 `depthWrite:false`，不会挡住飞线主体。）

### 12.4 终点扩散波（Wall Shader）
参考"Wall Shader"：用 `TubeGeometry` 沿一条**城市法线方向**的直线（高度 `waveHeight`），片元按**局部 Y 高度**做透明度渐变（底部亮、顶部透明），然后让它的 **X/Z 半径随时间扩展**、透明度随扩展降低：
```js
mesh.scale.set(rScale, hScale, rScale); // 半径扩大、高度 = waveHeight
mat.uniforms.uFade.value = 1 - phase;   // 越扩越淡
mat.uniforms.uOpacity.value = waveOpacity; // 扩散波透明度
```
每组飞线到终点时把该终点扩散波 `phase` 归零，重新扩散 → 形成"到达即扩散"的圆形波。朝向：用 `setFromUnitVectors((0,1,0), normal)` 让局部 +Y 对准城市法线。`waveRadius`/`waveHeight` 可调（最小可到 0.01，做很细小的波）。

### 12.5 配置
- **分组设置**：页面左侧「✈️ 飞线设置」表格，每行 = 起点城市(下拉) + 终点城市(下拉) + 增加/删除；「＋」复制本行起点以给同一组加终点，「－」删除本行，「＋新增分组」加一行。所有行按**起点相同**归成一组（`{source, targets:[...]}`），修改即 `rebuild()->flightLines.rebuild(groups, arcHeight)`。
  > 内部数据 `flightRows=[{source,target}]`，分组由 `rowGroups()` 按 source 聚合。
- **样式**（`flightLines.update(delta, elapsed, style)` 每帧传入）：
  飞线 `flightLineColor / flightLineOpacity / flightCometLength / flightCometWidth / flightCometSize / flightSpeed`；
  轨道线 `flightTrackWidth / flightTrackColor / flightTrackOpacity`；
  扩散波 `waveColor / waveOpacity / waveHeight / waveRadius / waveSpeed / waveBright`；弧线 `flightArcHeight`（改高度需重建）。
- **轨道线宽度/颜色** 等几何参数在创建时定死，改宽度要重建飞线（滑杆用 `.onFinishChange` 松手才重建）。

---

## 附：多语言（i18n）说明

界面（`index.html` 静态文本、lil-gui 面板、城市标注、飞线表格）全量多语言。语言包在根目录 `Languages/`，每语言一个 JSON：

```json
{ "code": "zh-CN", "name": "中文", "texts": { "gui.title": "🌍 地球参数", ... } }
```

- 右上角下拉框即时切换；`js/i18n.js` 负责加载、切换、`localStorage` 持久化、`t(key, vars)` 翻译与 `{var}` 插值。
- 缺失的 key 自动回退到 `zh-CN`；新增语言只需复制 `zh-CN.json` 改名、改 `code`/`name`/`texts` 放进 `Languages/`，点「⟳ 刷新语言列表」即可。
- 切换语言会销毁并重建 lil-gui 面板（标题/分组/控件名都用 `t()`），城市名与飞线表格下拉用 `city.<name>` 本地化显示；数据键仍是中文名，保证持久化兼容。

---

## 13. 常见坑

- **贴图颜色发灰/发黑**：忘记设 `texture.colorSpace = SRGBColorSpace`（颜色贴图）。法线贴图用默认线性。
- **file:// 打不开**：浏览器安全策略禁本地贴图，**必须用本地服务器**。
- **护罩贴图出现接缝**：生成时没在边界外多画一圈，或没设 `RepeatWrapping`。
- **面板刷新无效**：用了 `gui.controllers` 而没用 `gui.controllersRecursive()`。
- **法线贴图看不到效果**：没调 `normalStrength`（=0 会关闭），或没 `computeTangents()`。
- **飞线在地球背面也显示**：飞线材质不要设 `depthTest:false`，否则会被"透视"画出来；应设 `depthTest:true` 让地球遮挡背面飞线。
```
