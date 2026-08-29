# 🌍 Three.js 3D Earth (Three.js-3D-Earth)

**🌐 Language / 语言：** [English](README.en.md) | [中文](README.md)

> 🕹️ **Live Demo / 在线预览**：<https://ZGdadong.github.io/Three.js-3D-Earth/> （GitHub Pages, enabled in repo Settings → Pages）

> ⭐ If this project helps you, please consider leaving a **Star** before using it — thanks!

A **realistic 3D Earth** built with **Three.js**, featuring dynamic **day/night switching**, a **smooth terminator line**, **clouds**, **atmospheric glow**, **twinkling stars**, **normal-map terrain detail**, **city light markers**, and an **energy-wave shield that scans one-way from the North Pole to the South Pole**.

<img width="1275" height="702" alt="Demo" src="https://github.com/user-attachments/assets/0d2080a9-b1b8-4f26-b8ac-dd49d6275396" />


> This scene intentionally **removes the sun and moon**, keeping only the lighting and the Earth itself. Every parameter can be adjusted live through the `lil-gui` panel on the right, and **save/load/export/import** is supported.

---

## ✨ Features

- **Day/night switching + smooth terminator**: a custom Shader blends day/night textures; `smoothstep` produces a soft terminator band.
- **Time-of-day lighting**: distinguishes Noon / Dusk / Dawn / Night — noon is bright, dusk/dawn get a golden warm tint, night shows city lights.
- **Normal map**: layered on the lighting to give terrain height and depth (most visible under low-angle dusk/dawn light).
- **Clouds**: an independent sphere, lit by the light, slowly drifting, with adjustable opacity.
- **Atmospheric glow**: back-side Fresnel blue edge, brightness adjustable.
- **Stars**: rotating + swaying + **random opacity twinkling**.
- **Shield · Energy wave**: an octagonal mesh shield around the Earth; an energy wave scans in a set direction (North→South / South→North), period and single-scan duration, lighting up only where the wave passes.
- **City markers**: light-point labels for Beijing / Shanghai / Tokyo / New York / London / Sydney / Cairo / Rio.
- **Dynamic flight lines**: multiple groups of **1 source + n targets** (track tube + flowing comet); endpoints get a **circular ripple**; configurable color / shape (arc height, comet length & width) / endpoints (JSON); city names are not shown.
- **Parameter panel**: `lil-gui` adjusts almost all parameters.
- **Parameter persistence**: saved to browser `localStorage` and restored on refresh; supports export/import JSON and reset to defaults.
- **Multi-language (i18n)**: the whole UI is localized (text / lil-gui panel / city markers / flight table); one JSON per language under `Languages/`, switch instantly from the top-right dropdown, and missing keys fall back to Chinese.
- **China map · province drill-down**: switch between "Earth" and "China map" with one button at the bottom-right, or **click China directly on the Earth** — hover highlights China and shows a "中国" tooltip, and clicking transitions into the China map with a cloud wipe. GeoJSON-extruded provinces using a custom **gradient + glow** material (deep navy → cyan top), glowing cyan boundary lines; **hover to float up + highlight and show the name**, single-click to drill into a province (sub-regions), double-click / the top-left "Back" button to return to the whole country. The floor is a glowing gradient disc + grid + two rotating rings with a configurable gap, and the whole map has a bottom-to-top **scan energy wave**. Fully offline, bundled under `data/geojson/`; adjust glow / float / ring color-opacity-width-gap / scan wave from the right-side lil-gui panel.
- **Canvas recording**: the "🎬 Record" button at the bottom-right records the WebGL canvas to **WebM/VP9** video (visually lossless + low size), with selectable quality (High / Balanced / Small); stop and download with one click. Works in both the Earth and China map views.

---

## 🖼️ Demo


https://github.com/user-attachments/assets/c67d653e-11fb-4e3e-a795-9dbbf4480a80


---

## 📁 Directory Structure

```
Three.js-3D-Earth/
├─ index.html            # Entry page (importmap loads three.js + lil-gui; loader/HUD/language bar)
├─ js/
│  ├─ main.js            # All scene & logic (shaders, materials, GUI, persistence, animation, i18n)
│  ├─ i18n.js            # i18n loader (reads Languages/*.json, switching, persistence, t() translation)
│  ├─ flightlines.js     # Dynamic flight-line module (city db + flight lines + endpoint ripples)
│  └─ chinaMap.js        # China map module (GeoJSON extruded provinces + drill-down + hover/back)
├─ data/
│  └─ geojson/           # China & province GeoJSON (bundled offline, drill-down data source)
├─ Languages/            # Language packs (one JSON per language, see below)
│  ├─ zh-CN.json         # 中文
│  ├─ en-US.json         # English
│  └─ 语言代码说明.txt    # BCP 47 language-tag reference + how to add a language
├─ images/
│  ├─ 8k_earth_daymap.jpg        # Day surface texture
│  ├─ 8k_earth_nightmap.jpg      # Night city-lights texture
│  ├─ 8k_earth_clouds.jpg        # Cloud texture
│  ├─ 8k_earth_normal_map.tif    # Normal map (original TIFF)
│  ├─ 8k_earth_normal_map.png    # Normal map (converted PNG for browsers)
│  ├─ 8k_stars.jpg               # Star texture
│  └─ 8k_stars_milky_way.jpg     # Milky-way star texture (backup)
└─ Demo.png             # Preview thumbnail
```

---

## 🚀 How to Run

Opening the page with `file://` blocks local textures because of browser security policy, so you need to start a local static server.

Run either of the following from the project root:

```bash
# Option 1: Python
python -m http.server 8080

# Option 2: Node's (npx) http-server / serve
npx serve -l 8080
```

Then open **<http://127.0.0.1:8080/index.html>**.

---

## 🎮 Controls

| Action | Effect |
|--------|--------|
| Left-drag | Rotate view |
| Scroll wheel | Zoom |
| Right-drag | Pan |
| Click China on the Earth | Hover highlights China and shows "中国"; click transitions into the China map with a cloud wipe |
| Right-side lil-gui panel | Adjust all parameters live |
| "🎬 Record / ⏹ Stop" (bottom-right) | Start/stop the canvas recording; auto-downloads a WebM video on stop |

---

## ⚙️ Parameter Panel (lil-gui)

| Folder | Parameter | Description |
|--------|-----------|-------------|
| **Day/Night · Time** | Time preset | Auto / Noon / Dusk / Dawn / Night |
| | Sun elevation | Sun height above the horizon |
| | Auto day/night cycle / speed | Whether to auto-cycle day/night, and the speed |
| | Terminator width | Width of the day-to-night transition band |
| | Dusk warmth / range | Golden warm tint near the terminator |
| | Day brightness / night light brightness | Brightness tuning |
| | Normal map strength | Terrain depth (0 = off) |
| **Earth Rotation** | Toggle / speed | Auto-rotation |
| **Clouds** | Show / opacity | Clouds |
| **Atmosphere Glow** | Show / brightness | Earth's edge blue glow |
| **Stars** | Show / rotate / sway / twinkle / brightness | Stars |
| **Shield · Energy Wave** | Scan direction | North→South / South→North |
| | Scan period (s) | Delay between each scan start |
| | Scan duration (s) | How long one scan takes (a gap appears if less than the period) |
| | Energy band width / texture repeats (1~30) | Shield shape |
| | Edge glow / sharpness / color / shield opacity | Shield look |
| **City Markers** | Show city dots | City label toggle (off by default) |
| **✈️ Flight Lines** | Line color · opacity / arc height / comet length·width·size / flight speed / track width·color·opacity | Flight-line style & shape |
| | Ripple color · opacity / height / radius / speed / brightness | Endpoint ripple |
| **Flight-Line Table** | Source/target city dropdowns + add/delete | Edit every group row in the left table (＋ duplicates this row's source) |
| **💾 Parameters** | Save / load / import / reset / export | Parameter persistence |
| **🌐 Language (top-right)** | Language dropdown + ⟳ refresh list | Switch UI language, takes effect immediately |

---

## 🌐 Multi-language (i18n)

The whole UI supports multi-language. Language packs live in the root `Languages/` folder, one JSON per language.

### 1. Where the packs live

**`Languages/`** folder, one JSON file per language:

```
Languages/
├─ zh-CN.json            中文
├─ en-US.json            English
└─ 语言代码说明.txt      BCP 47 language-tag reference + how to add a language
```

> This is a web project, so it loads the matching file on demand from `./Languages/` — no need to copy to an output directory; just deploy the whole `Languages/` folder to the site root.

### 2. Pack structure

```json
{
  "code": "zh-CN",                       // Language code (BCP 47, see "语言代码说明.txt")
  "name": "中文",                         // Name shown in the dropdown
  "texts": {                             // Translation key/value pairs (keys must match other packs)
    "gui.title": "🌍 地球参数",
    "param.shieldOpacity": "护罩透明度",
    ...
  }
}
```

- `code`: BCP 47 language tag (e.g. `zh-CN` / `en-US`).
- `name`: the name shown in the language dropdown (e.g. "中文"/"English").
- `texts`: every UI string as a key/value pair. **A missing key automatically falls back to `zh-CN`**, so no raw key is ever shown.
- Keys that start with `city.` are city display names (e.g. `"city.东京": "Tokyo"`), used by the flight table dropdown and city markers.

### 3. Adding a new language (3 steps)

1. Copy `zh-CN.json` to e.g. `ja-JP.json`.
2. Change `code` to `ja-JP`, `name` to `日本語`, and translate `texts`.
3. Put it into the `Languages/` folder → click the top-right "⟳ 刷新语言列表" (or refresh the page) → the new language appears in the dropdown and is selected instantly.

### 4. Switching & persistence

- The top-right dropdown switches live: all UI text, the lil-gui panel, city markers, and the flight table update immediately.
- The chosen language is saved in browser `localStorage` and restored on refresh/reopen.
- On language switch the lil-gui parameter panel is **destroyed and rebuilt** in the current language, so every control name, folder name, and dropdown option updates too.

---

## 🧠 Technical Highlights (summary)

- **Earth**: custom `ShaderMaterial` GLSL — day/night textures are blended by the *dot product of sun direction and normal* through `smoothstep`; a golden warm tint is added near the terminator; brightness varies with the day factor.
- **Normal map**: tangent-space normal mapping (`computeTangents` + TBN matrix); the perturbed texture normal is transformed to world space for lighting.
- **Shield**: `ShaderMaterial` + Fresnel edge + Gaussian energy-band gating + adjustable roll direction; the band scans along latitude from the North Pole to the South Pole.
- **Shield texture**: procedurally generated on a Canvas with many **interlocking octagons** in a vector style; `RepeatWrapping` tiles seamlessly.
- **Star twinkle**: implemented by randomly adjusting the whole-sphere material `opacity`.
- **Dynamic flight lines**: great-circle + radially lifted arc sampling (or `quadratic/cubic bezier`); the track uses `TubeGeometry`, the comet uses `Points` + `aIndex/uTime` shader to show only a moving segment; endpoints use `TubeGeometry` (along the normal) + height gradient + radius expansion for the **circular ripple**.
- **Parameter persistence**: `localStorage` save + `controllersRecursive().forEach(c => c.updateDisplay())` to refresh the panel.

For the full derivation and line-by-line GLSL walkthrough, see **[docs/Three.js-3D-Earth-技术文档.md](docs/Three.js-3D-Earth-技术文档.md)** (Chinese).

---

## 📚 References

- [用 Three.js 创建一个酷炫且真实的地球（昼夜交替） — xieyufei](https://xieyufei.com/2026/01/22/Threejs-Real-Earth.html)
- [【Three.js】实现护罩(防御罩、金钟罩、护盾)效果](https://blog.csdn.net/wanghaoyingand/article/details/141996707)

---

## 📃 License

[MIT](LICENSE) (see the `LICENSE` file in the repo root). Feel free to use, modify, and share.
