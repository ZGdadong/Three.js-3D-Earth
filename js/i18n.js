// ============================================================================
//  i18n（多语言）加载器 —— 与语言包规范一致
//
//  语言包放在程序根目录的 Languages/ 文件夹下，每个语言一个 JSON 文件：
//     Languages/zh-CN.json   中文
//     Languages/en-US.json   English
//
//  结构（BCP 47 语言标签，见 README「语言代码说明」）：
//     {
//       "code": "zh-CN",                    // 语言代码（BCP 47）
//       "name": "中文",                      // 下拉框里显示的语言名
//       "texts": { "key": "..." }           // 翻译键值对
//     }
//
//  新增语言：复制 zh-CN.json 改名（如 ja-JP.json），改 code/name/texts，
//  放进 Languages/ 文件夹 → 点「刷新语言列表」（或重启应用）即可切换。
//
//  本模块提供一个极简的加载/切换/持久化机制，非第三方库：
//    - 读取 localStorage 记住用户选择的语言
//    - fetch 加载字符串资源
//    - 扫描 Languages/ 目录自动发现可用语言
//    - t(key, vars) 做翻译 + {var} 插值
// ============================================================================

const DEFAULT_LANG = "zh-CN";
const LANG_STORAGE_KEY = "earth_lang";
// 内置已知语言（即使目录不可枚举也能保证这两个可用）
const KNOWN_NAMES = { "zh-CN": "中文", "en-US": "English" };

let currentCode = DEFAULT_LANG;
let currentDict = null; // 当前语言的 texts
let fallbackDict = null; // 默认（zh-CN）语言的 texts，用于缺失键兜底
let availableLanguages = []; // [{ code, name }]
let listeners = [];

// 取翻译文本；缺失时兜底到 zh-CN，再不行就返回 key 本身
export function t(key, vars) {
  let s;
  if (currentDict && Object.prototype.hasOwnProperty.call(currentDict, key)) {
    s = currentDict[key];
  } else if (fallbackDict && Object.prototype.hasOwnProperty.call(fallbackDict, key)) {
    s = fallbackDict[key];
  } else {
    s = key;
  }
  if (vars) {
    for (const k of Object.keys(vars)) s = s.split("{" + k + "}").join(vars[k]);
  }
  return s;
}

export function getCurrentCode() {
  return currentCode;
}

export function getLanguages() {
  return availableLanguages;
}

// 拉取某个语言包文件
async function fetchLang(code) {
  const res = await fetch("./Languages/" + code + ".json", { cache: "no-store" });
  if (!res.ok) throw new Error("语言文件不存在: " + code);
  const data = await res.json();
  if (!data || !data.texts) throw new Error("语言文件格式无效: " + code);
  return data;
}

// 加载某个语言到当前内容（不触发通知）
async function loadLang(code) {
  const data = await fetchLang(code);
  currentCode = code;
  currentDict = data.texts;
  const index = availableLanguages.findIndex((l) => l.code === code);
  const meta = { code, name: data.name || code };
  if (index >= 0) availableLanguages[index] = meta;
  else availableLanguages.push(meta);
}

// 扫描 Languages/ 目录，发现可用语言（失败则退化为内置列表）
async function discoverLanguages() {
  const builtin = [
    { code: "zh-CN", name: KNOWN_NAMES["zh-CN"] },
    { code: "en-US", name: KNOWN_NAMES["en-US"] },
  ];

  let codes = [];
  try {
    const res = await fetch("./Languages/", { cache: "no-store" });
    if (res.ok) {
      const html = await res.text();
      // 目录列表里形如 <a href="en-US.json"> 的链接
      const matches = [...new Set([...html.matchAll(/([A-Za-z]{2}-[A-Za-z]{2})\.json/g)].map((m) => m[1]))];
      codes = matches;
    }
  } catch (e) {
    /* 目录不可枚举，忽略 */
  }

  const pool = new Map(builtin.map((l) => [l.code, l]));
  // 为目录中发现但不在内置表里的语言补读 name（能读到才被采用）
  for (const c of codes) {
    if (!pool.has(c)) {
      try {
        const d = await fetchLang(c);
        pool.set(c, { code: c, name: d.name || c });
      } catch (e) {
        pool.set(c, { code: c, name: c });
      }
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const l of builtin) {
    if (!seen.has(l.code)) {
      seen.add(l.code);
      ordered.push(l);
    }
  }
  for (const c of codes) {
    if (!seen.has(c)) {
      seen.add(c);
      ordered.push(pool.get(c));
    }
  }

  availableLanguages = ordered;
  return ordered;
}

export async function initI18n() {
  let code = DEFAULT_LANG;
  try {
    const saved = localStorage.getItem(LANG_STORAGE_KEY);
    if (saved) code = saved;
  } catch (e) {
    /* 无 localStorage */
  }

  await discoverLanguages();

  // 兜底字典（zh-CN），保证缺失键也不显示裸 key
  try {
    fallbackDict = (await fetchLang(DEFAULT_LANG)).texts;
  } catch (e) {
    fallbackDict = null;
  }

  try {
    await loadLang(code);
  } catch (e) {
    try {
      await loadLang(DEFAULT_LANG);
    } catch (e2) {
      currentDict = null;
    }
  }

  applyStaticText();
  notify();
}

// 切换语言；成功返回 true
export async function switchTo(code) {
  try {
    await loadLang(code);
    try {
      localStorage.setItem(LANG_STORAGE_KEY, code);
    } catch (e) {
      /* 忽略 */
    }
    applyStaticText();
    notify();
    return true;
  } catch (e) {
    return false;
  }
}

// 重新扫描语言列表并应用
export async function refreshLanguages() {
  await discoverLanguages();
  applyStaticText();
  notify();
  return getLanguages();
}

// 注册语言变化回调，返回取消函数
export function onLanguageChange(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((c) => c !== cb);
  };
}

function notify() {
  listeners.forEach((cb) => {
    try {
      cb(currentCode);
    } catch (e) {
      console.error("[i18n] language listener error:", e);
    }
  });
}

// 把当前翻译应用到带 data-i18n 的静态节点上（文本），以及 data-i18n-title（title 提示）
export function applyStaticText() {
  if (!currentDict) return;
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && currentDict[key] !== undefined) el.textContent = currentDict[key];
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    const key = el.getAttribute("data-i18n-title");
    if (key && currentDict[key] !== undefined) el.title = currentDict[key];
  });
  document.documentElement.lang = currentCode;
}
