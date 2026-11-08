/// <reference path="./graphy-plugin.d.ts" />
// @ts-check
/*
 * パノラマ X 線 1 枚から、歯の検出（FDI 番号）・診断候補・欠損歯・歯式チャート・構造化レポートを作る GRAPHY-Next のプラグイン。
 * 研究・教育用。診断機器ではない。
 *
 * 着想: Baseri Saadi S, et al. Panognostics-Plus. J Imaging Inform Med 2026. doi:10.1007/s10278-026-02479-w（CC BY 4.0）。
 * 論文の「検出 → 歯式への割り当て → チャート → 構造化レポート」の流れを再現する。モデルは論文のものではない（非公開）。
 *
 * 分担:
 *   計算機の Python（この PC・endpointId "local" 固定）… 検出した生の結果（歯: FDI・bbox・輪郭、診断: クラス・bbox）だけを返す
 *   この ui.js … 歯式への割り当て・欠損歯・レポート・SR・CSV・チャートを作る純関数と画面（Python なしで node から検算できる）
 */

export const PLUGIN_ID = "vis-dental-pano";

/**
 * 重み。置き場は ~/.graphy-next/models/vis-dental-pano/。sha256 が空のあいだは版の固定が済んでいない（試作）。
 * dx は任意（無ければ歯と欠損歯だけを出す）。
 */
export const WEIGHTS = {
  teeth: { file: "teeth-seg.pt", sha256: "", required: true, task: "seg" },
  dx: { file: "dx-det.pt", sha256: "", required: false, task: "detect" },
};
/** 動作を確かめた ultralytics の版（空なら版は問わない） */
export const ULTRALYTICS = "";
/** 検出の信頼度のしきい値（モデル出力の下限。統計的に導いた値ではなく、既定の運用値） */
export const CONF = { teeth: 0.25, dx: 0.25 };
export const IMGSZ = 1280;

// ---------------------------------------------------------------------------
// FDI・診断クラス
// ---------------------------------------------------------------------------

/** 患者の右が画像の左（歯式チャートの並び）。上顎 18→28、下顎 48→38 */
export const UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
export const LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
export const PERMANENT = [...UPPER, ...LOWER];

/** 診断の 4 クラス（DENTEX の diagnosis）。色は色覚多様性に配慮した 4 色（Okabe-Ito） */
export const DX = {
  caries: { ja: "う蝕", en: "Caries", color: "#E69F00" },
  deep_caries: { ja: "深在性う蝕", en: "Deep caries", color: "#D55E00" },
  periapical: { ja: "根尖病変", en: "Periapical lesion", color: "#CC79A7" },
  impacted: { ja: "埋伏歯", en: "Impacted tooth", color: "#0072B2" },
};
export const DX_KEYS = Object.keys(DX);

export const DISCLAIMERS = {
  ja:
    "研究用の下書きです。診断・治療の判断に使わないでください。結果は誤りを含みます（検出漏れ・誤検出・番号の取り違え）。" +
    "「欠損」は、検出されなかった永久歯です。実際の欠損・補綴（インプラント・ブリッジ）・未萌出・乳歯・検出漏れを区別できません。" +
    "面積・距離は出しません（パノラマの拡大率は位置で変わり、mm には直せません）。外部の施設での検証はしていません。",
  en:
    "Research draft only. Do not use for diagnosis or treatment decisions. Results contain errors (missed or false detections, wrong tooth numbers). " +
    "\"Missing\" means a permanent tooth that was not detected; it cannot be told apart from true absence, prostheses (implants, bridges), unerupted teeth, deciduous teeth or a missed detection. " +
    "No areas or distances are reported (panoramic magnification varies with position and cannot be converted to mm). Not validated at any external site.",
};

// ---------------------------------------------------------------------------
// 文言（ja / en）
// ---------------------------------------------------------------------------

const S = {
  ja: {
    title: "パノラマ X 線 歯式チャート（試作）",
    about:
      "パノラマ X 線 1 枚（PX / DX / CR）を、この PC の計算機だけで解析します。画像は外へ出ません。" +
      "歯（FDI 番号）を検出し、診断の候補（う蝕・深在性う蝕・根尖病変・埋伏歯）を歯に割り当て、歯式チャートと構造化レポートを作ります。" +
      "乳歯・混合歯列には対応しません。",
    target: "対象",
    run: "実行",
    sending: "送っています…",
    checking: "環境を確認しています…",
    cancelled: "取り消しました",
    done: "できました",
    envReady: "環境は整いました。「実行」を押してください",
    envNeed: "足りないものがあります。下の手順で入れて、［再確認］を押してください",
    envTitle: "実行の前に、この PC の計算機の Python に足りないものがあります",
    envPython: "使われる Python",
    envAnyVersion: "（版は問わない）",
    envMissing: "✗ 入っていません",
    envWrongVersion: "（版が違います）",
    envHow: "ターミナル（Windows は PowerShell かコマンドプロンプト）で、次を実行してください。このプラグインは環境を書き換えません。",
    envGpu: "GPU（CUDA）で動かしたいときは、torch だけ pytorch.org の案内の版を入れてください。パスを引用符で囲んだ場合、PowerShell では先頭に & を付けてください。",
    envCopy: "コマンドをコピー",
    envRecheck: "再確認",
    envAfter: "入れたら［再確認］を押してください（本体の再起動は要りません）。",
    weightsTitle: "重みファイルの置き場",
    weightsHow: "次のファイルを、この PC の計算機の上の次のフォルダに置いてください。",
    weightsOptional: "（任意。無ければ診断の候補は出さず、歯と欠損歯だけを出します）",
    chart: "歯式チャート（FDI）",
    legend: "凡例",
    detected: "検出",
    missing: "検出されず",
    right: "患者の右",
    left: "患者の左",
    upper: "上顎",
    lower: "下顎",
    overlays: "画像への重ね表示",
    showTeeth: "歯の輪郭",
    showDx: "診断候補の枠",
    clear: "すべて消す",
    placed: (n, f, x) => `輪郭 ${n} 件を置きました` + (f ? `（うち ${f} 件は形が不正で枠に置き換え）` : "") + (x ? `。${x} 件は置けませんでした` : ""),
    teethTable: "歯",
    dxTable: "診断の候補",
    noDx: "診断モデルが入っていないので、診断の候補は出していません。",
    noDxFound: "診断の候補は検出されませんでした。",
    unassigned: "歯に割り当てられませんでした",
    report: "レポート（下書き）",
    copy: "コピー",
    saveSr: "DICOM SR を保存",
    saveCsv: "CSV を保存",
    publish: "解析結果をレポート画面へ送る",
    srSaved: "SR を保存しました",
    srCancelled: "SR の保存を取りやめました",
    csvSaved: "CSV を保存しました",
    published: "レポート画面の候補に登録しました",
    meta: (r) => `${r.device}・${r.seconds} 秒・歯 ${r.teeth.length} 本・診断 ${r.dx ? r.dx.length : "—"} 件`,
    // レポート
    rTitle: "パノラマ X 線 AI 解析（研究用の下書き）",
    rDetected: (n, list) => `検出した歯: ${n} 本（${list || "なし"}）`,
    rMissing: (u, l) =>
      `検出されなかった永久歯（欠損・補綴・未萌出・検出漏れのいずれでもありえます）: 上顎 ${u || "なし"} ／ 下顎 ${l || "なし"}`,
    rDx: (name, list) => `${name}の候補がある歯: ${list}`,
    rDxUnassigned: (name, n) => `${name}の候補（歯を特定できず）: ${n} 件`,
    rNoDxModel: "診断モデルは使っていません。",
    rNoDx: "診断の候補はありません。",
    rDup: (list) => `同じ番号が重複して検出されたため、信頼度の高い方だけを採りました: ${list}`,
    rDropped: (n) => `形式が不正で捨てた検出: ${n} 件`,
    rModel: (r) => `モデル: ${r.model}`,
    rSummary: "まとめ",
    sep: "、",
  },
  en: {
    title: "Panoramic radiograph dental chart (prototype)",
    about:
      "Analyses one panoramic radiograph (PX / DX / CR) on this PC only; the image never leaves it. " +
      "Detects teeth (FDI numbers), assigns diagnosis candidates (caries, deep caries, periapical lesion, impacted tooth) to teeth, and builds a dental chart and a structured report. " +
      "Deciduous and mixed dentition are not supported.",
    target: "Target",
    run: "Run",
    sending: "Sending…",
    checking: "Checking the environment…",
    cancelled: "Cancelled",
    done: "Done",
    envReady: "The environment is ready. Press Run.",
    envNeed: "Something is missing. Install it as shown below, then press Re-check.",
    envTitle: "Before running: the Python of this PC's compute endpoint lacks something",
    envPython: "Python in use",
    envAnyVersion: "(any version)",
    envMissing: "✗ not installed",
    envWrongVersion: "(wrong version)",
    envHow: "Run the following in a terminal (PowerShell or Command Prompt on Windows). This plugin does not modify your environment.",
    envGpu: "To use a GPU (CUDA), install only torch as instructed at pytorch.org. If the path is quoted, prefix the command with & in PowerShell.",
    envCopy: "Copy command",
    envRecheck: "Re-check",
    envAfter: "After installing, press Re-check (no need to restart the app).",
    weightsTitle: "Where the weight files go",
    weightsHow: "Place the following files in this folder on this PC's compute endpoint.",
    weightsOptional: "(optional; without it no diagnosis candidates are shown, only teeth and missing teeth)",
    chart: "Dental chart (FDI)",
    legend: "Legend",
    detected: "detected",
    missing: "not detected",
    right: "patient's right",
    left: "patient's left",
    upper: "Maxilla",
    lower: "Mandible",
    overlays: "Overlays on the image",
    showTeeth: "Tooth outlines",
    showDx: "Diagnosis boxes",
    clear: "Clear all",
    placed: (n, f, x) => `Placed ${n} outlines` + (f ? ` (${f} replaced by boxes because the outline was invalid)` : "") + (x ? `; ${x} could not be placed` : ""),
    teethTable: "Teeth",
    dxTable: "Diagnosis candidates",
    noDx: "No diagnosis model is installed, so no diagnosis candidates are shown.",
    noDxFound: "No diagnosis candidates were detected.",
    unassigned: "not assigned to a tooth",
    report: "Report (draft)",
    copy: "Copy",
    saveSr: "Save DICOM SR",
    saveCsv: "Save CSV",
    publish: "Send results to the report screen",
    srSaved: "SR saved",
    srCancelled: "SR save cancelled",
    csvSaved: "CSV saved",
    published: "Registered as a candidate on the report screen",
    meta: (r) => `${r.device} · ${r.seconds} s · ${r.teeth.length} teeth · ${r.dx ? r.dx.length : "—"} diagnoses`,
    rTitle: "Panoramic radiograph AI analysis (research draft)",
    rDetected: (n, list) => `Detected teeth: ${n} (${list || "none"})`,
    rMissing: (u, l) =>
      `Permanent teeth not detected (may be absent, prosthetic, unerupted, or missed): maxilla ${u || "none"} / mandible ${l || "none"}`,
    rDx: (name, list) => `Teeth with ${name} candidates: ${list}`,
    rDxUnassigned: (name, n) => `${name} candidates not assigned to a tooth: ${n}`,
    rNoDxModel: "No diagnosis model was used.",
    rNoDx: "No diagnosis candidates.",
    rDup: (list) => `Duplicate tooth numbers were detected; only the higher-confidence one was kept: ${list}`,
    rDropped: (n) => `Detections dropped for invalid format: ${n}`,
    rModel: (r) => `Model: ${r.model}`,
    rSummary: "Summary",
    sep: ", ",
  },
};

/** @param {string | undefined} locale */
export const langOf = (locale) => (/^ja/i.test(String(locale ?? "")) ? "ja" : "en");
/** @param {"ja"|"en"} lang */
export const strings = (lang) => S[lang];

// ---------------------------------------------------------------------------
// 結果の整形・割り当て（純関数）
// ---------------------------------------------------------------------------

const isNum = (/** @type {any} */ v) => typeof v === "number" && Number.isFinite(v);
const isBox = (/** @type {any} */ b) => Array.isArray(b) && b.length === 4 && b.every(isNum) && b[2] > b[0] && b[3] > b[1];

/**
 * 計算機の結果を検査して整える。使えない検出は捨てて件数を数える（黙って 0 にしない）。
 * 同じ FDI が複数あれば信頼度の高い 1 つだけを採り、捨てた番号を duplicates に残す。
 * @param {any} raw
 */
export function normalizeResult(raw) {
  if (!raw || !Array.isArray(raw.teeth)) throw new Error("result.json に teeth がありません");
  let dropped = 0;
  /** @type {Map<number, any>} */
  const byFdi = new Map();
  /** @type {number[]} */
  const duplicates = [];
  for (const t of raw.teeth) {
    if (!PERMANENT.includes(t?.fdi) || !isBox(t?.bbox) || !isNum(t?.conf)) { dropped++; continue; }
    const poly = Array.isArray(t.poly) && t.poly.every((/** @type {any} */ p) => Array.isArray(p) && isNum(p[0]) && isNum(p[1])) ? t.poly : null;
    const cur = byFdi.get(t.fdi);
    if (cur) { duplicates.push(t.fdi); if (cur.conf >= t.conf) continue; }
    byFdi.set(t.fdi, { fdi: t.fdi, conf: t.conf, bbox: t.bbox, poly });
  }
  /** @type {any[] | null} */
  let dx = null;
  if (Array.isArray(raw.dx)) {
    dx = [];
    for (const d of raw.dx) {
      if (!DX_KEYS.includes(d?.cls) || !isBox(d?.bbox) || !isNum(d?.conf)) { dropped++; continue; }
      dx.push({ cls: d.cls, conf: d.conf, bbox: d.bbox });
    }
  }
  const teeth = [...byFdi.values()].sort((a, b) => PERMANENT.indexOf(a.fdi) - PERMANENT.indexOf(b.fdi));
  return {
    rows: raw.rows, cols: raw.cols, device: String(raw.device ?? "?"), seconds: raw.seconds ?? null,
    model: String(raw.model ?? ""), teeth, dx: dx ? assignDiagnoses(teeth, dx) : null,
    duplicates: [...new Set(duplicates)], dropped,
  };
}

/** 2 つの bbox [x0,y0,x1,y1] の重なりの面積 */
export function intersectionArea(/** @type {number[]} */ a, /** @type {number[]} */ b) {
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * 診断の枠を、重なりが最大の歯へ割り当てる（論文の歯式マッピングと同じ考え方）。重なりが 0 なら fdi は null。
 * overlap は「診断の枠のうち、その歯の枠に入っている割合」。
 * @param {{fdi:number, bbox:number[]}[]} teeth
 * @param {{cls:string, conf:number, bbox:number[]}[]} dx
 */
export function assignDiagnoses(teeth, dx) {
  return dx.map((d) => {
    const area = (d.bbox[2] - d.bbox[0]) * (d.bbox[3] - d.bbox[1]);
    let best = null, bestA = 0;
    for (const t of teeth) {
      const a = intersectionArea(d.bbox, t.bbox);
      if (a > bestA) { best = t; bestA = a; }
    }
    return { ...d, fdi: best ? best.fdi : null, overlap: best ? bestA / area : 0 };
  });
}

/** 検出されなかった永久歯（上顎・下顎それぞれ、チャートの並び順） */
export function missingTeeth(/** @type {{fdi:number}[]} */ teeth) {
  const have = new Set(teeth.map((t) => t.fdi));
  return { upper: UPPER.filter((f) => !have.has(f)), lower: LOWER.filter((f) => !have.has(f)) };
}

/** FDI を 象限→歯の順（11,12,…,18,21,…）に並べる */
export const fdiSort = (/** @type {number[]} */ list) => [...list].sort((a, b) => a - b);

function perpDist(/** @type {number[]} */ p, /** @type {number[]} */ a, /** @type {number[]} */ b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dx * (a[1] - p[1]) - (a[0] - p[0]) * dy) / len;
}

/**
 * 閉じた多角形を maxPts 点以下に間引く（Douglas-Peucker。許容を増やしながら収まるまで繰り返す）。
 * 始点と最遠点で 2 本の鎖に分けて処理する。3 点未満なら null。
 * @param {number[][]} pts
 * @param {number} [maxPts]
 */
export function simplifyPolygon(pts, maxPts = 64) {
  /** @type {number[][]} */
  let p = [];
  for (const q of pts) {
    const last = p[p.length - 1];
    if (!last || last[0] !== q[0] || last[1] !== q[1]) p.push([q[0], q[1]]);
  }
  if (p.length > 1 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
  if (p.length < 3) return null;
  if (p.length <= maxPts) return p;
  let k = 0, far = -1;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > far) { far = d; k = i; }
  }
  const ring = [...p, p[0]];
  for (let eps = 0.25; ; eps *= 1.5) {
    const keep = new Array(ring.length).fill(false);
    keep[0] = keep[k] = keep[ring.length - 1] = true;
    for (const [lo0, hi0] of [[0, k], [k, ring.length - 1]]) {
      const stack = [[lo0, hi0]];
      while (stack.length) {
        const [lo, hi] = /** @type {number[]} */ (stack.pop());
        let m = -1, md = eps;
        for (let i = lo + 1; i < hi; i++) {
          const d = perpDist(ring[i], ring[lo], ring[hi]);
          if (d > md) { md = d; m = i; }
        }
        if (m >= 0) { keep[m] = true; stack.push([lo, m], [m, hi]); }
      }
    }
    const out = ring.slice(0, -1).filter((_, i) => keep[i]);
    if (out.length <= maxPts || eps > 1e6) return out.length >= 3 ? out : null;
  }
}

/** bbox の 4 隅（多角形の代わりに置く枠） */
export const boxCorners = (/** @type {number[]} */ b) => [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];

// ---------------------------------------------------------------------------
// レポート・SR・CSV
// ---------------------------------------------------------------------------

/**
 * 診断を種類ごとに、歯の番号の一覧にまとめる。
 * @param {ReturnType<typeof normalizeResult>} res
 */
export function diagnosisByClass(res) {
  return DX_KEYS.map((key) => {
    const items = (res.dx ?? []).filter((d) => d.cls === key);
    return { key, teeth: fdiSort([...new Set(items.filter((d) => d.fdi != null).map((d) => /** @type {number} */ (d.fdi)))]), unassigned: items.filter((d) => d.fdi == null).length, count: items.length };
  }).filter((g) => g.count > 0);
}

/** @param {ReturnType<typeof normalizeResult>} res @param {"ja"|"en"} lang */
export function buildReport(res, lang) {
  const s = S[lang];
  const m = missingTeeth(res.teeth);
  const lines = [s.rTitle, ""];
  lines.push(s.rDetected(res.teeth.length, fdiSort(res.teeth.map((t) => t.fdi)).join(s.sep)));
  lines.push(s.rMissing(m.upper.join(s.sep), m.lower.join(s.sep)));
  if (res.dx === null) lines.push(s.rNoDxModel);
  else if (!res.dx.length) lines.push(s.rNoDx);
  else {
    for (const g of diagnosisByClass(res)) {
      const name = DX[/** @type {keyof typeof DX} */ (g.key)][lang];
      if (g.teeth.length) lines.push(s.rDx(name, g.teeth.join(s.sep)));
      if (g.unassigned) lines.push(s.rDxUnassigned(name, g.unassigned));
    }
  }
  if (res.duplicates.length) lines.push(s.rDup(res.duplicates.join(s.sep)));
  if (res.dropped) lines.push(s.rDropped(res.dropped));
  lines.push("", s.rModel(res), DISCLAIMERS[lang]);
  return lines.join("\n");
}

/**
 * DICOM SR の保存要求。**所見（findings）だけ**で作る。本体は計測が空の group を拒否し（MeasurementReportService）、
 * 画素数の面積を cm2 などの単位に偽って入れることもしないため。
 * @param {ReturnType<typeof normalizeResult>} res @param {"ja"|"en"} lang
 */
export function buildSrRequest(res, lang) {
  const s = S[lang];
  const m = missingTeeth(res.teeth);
  /** @type {{label:string,text:string}[]} */
  const findings = [
    { label: lang === "ja" ? "検出した歯" : "Detected teeth", text: fdiSort(res.teeth.map((t) => t.fdi)).join(" ") || (lang === "ja" ? "なし" : "none") },
    { label: lang === "ja" ? "検出されなかった永久歯" : "Permanent teeth not detected", text: [...m.upper, ...m.lower].join(" ") || (lang === "ja" ? "なし" : "none") },
  ];
  if (res.dx === null) findings.push({ label: lang === "ja" ? "診断の候補" : "Diagnosis candidates", text: s.rNoDxModel });
  else for (const g of diagnosisByClass(res)) {
    findings.push({
      label: DX[/** @type {keyof typeof DX} */ (g.key)][lang],
      text: (g.teeth.length ? g.teeth.join(" ") : "") + (g.unassigned ? ` (${s.unassigned}: ${g.unassigned})` : ""),
    });
  }
  findings.push({ label: lang === "ja" ? "注意" : "Caution", text: DISCLAIMERS[lang] });
  return { seriesDescription: "Dental panoramic AI draft", documentTitle: s.rTitle, groups: [], findings };
}

/** CSV（UTF-8・BOM 付き・数式として解釈されないよう、先頭が = + - @ の文字列は引用符＋アポストロフィで保護） */
export function buildCsv(/** @type {ReturnType<typeof normalizeResult>} */ res) {
  const esc = (/** @type {any} */ v) => {
    let t = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t) && !/^-?\d+(\.\d+)?$/.test(t)) t = "'" + t;
    return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = [["kind", "fdi", "class", "confidence", "x0", "y0", "x1", "y1", "overlap_with_tooth"]];
  for (const t of res.teeth) rows.push(["tooth", t.fdi, "", t.conf.toFixed(3), ...t.bbox.map((v) => v.toFixed(1)), ""]);
  for (const d of res.dx ?? []) rows.push(["diagnosis", d.fdi ?? "", d.cls, d.conf.toFixed(3), ...d.bbox.map((v) => v.toFixed(1)), d.overlap.toFixed(3)]);
  for (const f of [...missingTeeth(res.teeth).upper, ...missingTeeth(res.teeth).lower]) rows.push(["not_detected", f, "", "", "", "", "", "", ""]);
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n") + "\r\n";
}

/** 本体のレポート画面へ登録する解析結果（caveats は必須） */
export function buildAnalysisResult(/** @type {ReturnType<typeof normalizeResult>} */ res, /** @type {"ja"|"en"} */ lang, /** @type {string | null | undefined} */ sop) {
  const m = missingTeeth(res.teeth);
  const metrics = [
    { label: lang === "ja" ? "検出した歯" : "Detected teeth", value: String(res.teeth.length), unit: lang === "ja" ? "本" : "" },
    { label: lang === "ja" ? "検出されなかった永久歯" : "Permanent teeth not detected", value: String(m.upper.length + m.lower.length), unit: lang === "ja" ? "本" : "" },
  ];
  if (res.dx) for (const g of diagnosisByClass(res)) metrics.push({ label: DX[/** @type {keyof typeof DX} */ (g.key)][lang], value: g.teeth.join(" ") || String(g.count), unit: "" });
  return {
    id: "dental-pano",
    kind: /** @type {const} */ ("plugin"),
    ...(sop ? { sopInstanceUids: [sop] } : {}),
    frameLabel: lang === "ja" ? "パノラマ 1 枚" : "1 panoramic image",
    title: S[lang].title,
    metrics,
    provenance: [
      { label: lang === "ja" ? "モデル" : "Model", value: res.model || "?" },
      { label: lang === "ja" ? "実行" : "Run", value: `${res.device}` },
    ],
    caveats: [DISCLAIMERS[lang]],
  };
}

// ---------------------------------------------------------------------------
// 歯式チャート
// ---------------------------------------------------------------------------

export const CELL = { w: 38, h: 60, gap: 4, mid: 16, top: 30, rowGap: 34, left: 8 };

/** チャートのモデル（描画から切り離して検算できる）。 */
export function chartModel(/** @type {ReturnType<typeof normalizeResult>} */ res) {
  const have = new Map(res.teeth.map((t) => [t.fdi, t]));
  const cell = (/** @type {number} */ fdi, /** @type {number} */ col, /** @type {"upper"|"lower"} */ row) => ({
    fdi, row, col,
    x: CELL.left + col * (CELL.w + CELL.gap) + (col >= 8 ? CELL.mid : 0),
    y: row === "upper" ? CELL.top : CELL.top + CELL.h + CELL.rowGap,
    detected: have.has(fdi),
    conf: have.get(fdi)?.conf ?? null,
    dx: DX_KEYS.filter((k) => (res.dx ?? []).some((d) => d.cls === k && d.fdi === fdi)),
  });
  return [...UPPER.map((f, i) => cell(f, i, "upper")), ...LOWER.map((f, i) => cell(f, i, "lower"))];
}

export const CHART_SIZE = { width: CELL.left * 2 + 16 * (CELL.w + CELL.gap) + CELL.mid, height: CELL.top + CELL.h * 2 + CELL.rowGap + 36 };

/**
 * チャートを SVG で描く。背景・文字色は固定（明るい・暗いどちらのテーマでも読める）。
 * @param {Document} doc @param {ReturnType<typeof chartModel>} model @param {"ja"|"en"} lang
 * @param {{ onSelect?: (fdi:number)=>void, selected?: number | null }} [opts]
 */
export function renderChart(doc, model, lang, opts = {}) {
  const NS = "http://www.w3.org/2000/svg";
  const mk = (/** @type {string} */ tag, /** @type {Record<string,string|number>} */ attrs = {}, /** @type {string} */ text = "") => {
    const e = doc.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    return e;
  };
  const s = S[lang];
  const svg = mk("svg", { viewBox: `0 0 ${CHART_SIZE.width} ${CHART_SIZE.height}`, width: "100%", role: "img", "data-testid": "dental-chart" });
  svg.setAttribute("style", "background:#fff;border-radius:4px;max-width:720px");
  svg.append(mk("text", { x: CELL.left, y: 14, "font-size": 11, fill: "#444" }, s.right));
  svg.append(mk("text", { x: CHART_SIZE.width - CELL.left, y: 14, "font-size": 11, fill: "#444", "text-anchor": "end" }, s.left));
  svg.append(mk("line", { x1: CHART_SIZE.width / 2, x2: CHART_SIZE.width / 2, y1: 20, y2: CHART_SIZE.height - 30, stroke: "#bbb", "stroke-width": 1 }));
  for (const c of model) {
    const g = mk("g", { "data-testid": `fdi-${c.fdi}`, "data-state": c.detected ? "detected" : "missing", "data-dx": c.dx.join(" "), style: c.detected ? "cursor:pointer" : "" });
    const sel = opts.selected === c.fdi;
    g.append(mk("rect", c.detected
      ? { x: c.x, y: c.y, width: CELL.w, height: CELL.h, rx: 8, fill: "#f4f1ea", stroke: sel ? "#FF6900" : "#8a8578", "stroke-width": sel ? 3 : 1.2 }
      : { x: c.x, y: c.y, width: CELL.w, height: CELL.h, rx: 8, fill: "none", stroke: "#b5b5b5", "stroke-width": 1.2, "stroke-dasharray": "4 3" }));
    g.append(mk("text", { x: c.x + CELL.w / 2, y: c.y + CELL.h / 2 + 4, "font-size": 13, "text-anchor": "middle", fill: c.detected ? "#222" : "#999" }, c.detected ? String(c.fdi) : "–"));
    if (!c.detected) g.append(mk("text", { x: c.x + CELL.w / 2, y: c.y + CELL.h + 12, "font-size": 9, "text-anchor": "middle", fill: "#888" }, String(c.fdi)));
    c.dx.forEach((k, i) => {
      const bw = (CELL.w - 8) / c.dx.length;
      g.append(mk("rect", { x: c.x + 4 + i * bw, y: c.y + CELL.h - 12, width: bw - 1, height: 8, rx: 2, fill: DX[/** @type {keyof typeof DX} */ (k)].color, "data-dx-key": k }));
    });
    if (c.detected && opts.onSelect) g.addEventListener("click", () => /** @type {(f:number)=>void} */ (opts.onSelect)(c.fdi));
    svg.append(g);
  }
  svg.append(mk("text", { x: CELL.left, y: CELL.top - 6, "font-size": 10, fill: "#666" }, s.upper));
  svg.append(mk("text", { x: CELL.left, y: CELL.top + CELL.h * 2 + CELL.rowGap + 16, "font-size": 10, fill: "#666" }, s.lower));
  // 凡例
  let lx = CELL.left + 60;
  const ly = CHART_SIZE.height - 10;
  for (const k of DX_KEYS) {
    svg.append(mk("rect", { x: lx, y: ly - 8, width: 10, height: 8, rx: 2, fill: DX[/** @type {keyof typeof DX} */ (k)].color }));
    const label = DX[/** @type {keyof typeof DX} */ (k)][lang];
    svg.append(mk("text", { x: lx + 14, y: ly, "font-size": 10, fill: "#444" }, label));
    lx += 22 + label.length * (lang === "ja" ? 10 : 6);
  }
  return svg;
}

// ---------------------------------------------------------------------------
// 画像への重ね表示（ROI）
// ---------------------------------------------------------------------------

/**
 * 歯の輪郭・診断の枠を ROI として置く。多角形は 64 点以下に間引き、本体が自己交差・面積ゼロで拒否したら
 * 粗くして再試行し、それでも置けなければ bbox の 4 隅で置く。
 * @param {any} host @param {string} tileId @param {"teeth"|"dx"} kind @param {ReturnType<typeof normalizeResult>} res
 */
export function placeRois(host, tileId, kind, res) {
  /** @type {Map<number, string>} */
  const uids = new Map();
  /** @type {string[]} */
  const all = [];
  let fallback = 0, failed = 0;
  const create = (/** @type {number[][]} */ verts, /** @type {string} */ label) => host.createRoi(tileId, { tool: "PolygonROI", verticesPx: verts, label });
  const place = (/** @type {number[][] | null} */ poly, /** @type {number[]} */ bbox, /** @type {string} */ label) => {
    for (const max of [64, 32, 16]) {
      const v = poly ? simplifyPolygon(poly, max) : null;
      if (!v) break;
      const r = create(v, label);
      if (r.ok) return r.roiUid;
      if (r.reason !== "self-intersecting" && r.reason !== "degenerate") { failed++; return null; }
    }
    const r = create(boxCorners(bbox), label);
    if (r.ok) { if (poly) fallback++; return r.roiUid; }
    failed++;
    return null;
  };
  if (kind === "teeth") {
    for (const t of res.teeth) {
      const uid = place(t.poly, t.bbox, `FDI ${t.fdi}`);
      if (uid) { uids.set(t.fdi, uid); all.push(uid); }
    }
  } else {
    for (const d of res.dx ?? []) {
      const uid = place(null, d.bbox, `${d.cls} ${d.fdi ?? "?"}`);
      if (uid) all.push(uid);
    }
  }
  return { uids, all, fallback, failed };
}

// ---------------------------------------------------------------------------
// 計算機の上で走る Python。先頭に GRAPHY（設定）が足される。
// 前半（PY_PREP）は numpy だけで試験できる。後半が torch / ultralytics を使う。
// ---------------------------------------------------------------------------

export const PY_PREP = String.raw`
import json, os, sys, time, hashlib, re
from importlib import metadata as _md

T0 = time.time()


def stage(name, p):
    print('__progress__', p, name, flush=True)


def version_of(dist):
    try:
        return _md.version(dist)
    except _md.PackageNotFoundError:
        return None


def need_packages():
    """必要なパッケージ（版は指定があるものだけ）。事前チェックと本処理で同じ表を使う"""
    need = {'ultralytics': GRAPHY['ultralytics'] or None, 'torch': None, 'numpy': None, 'pillow': None}
    return need


def env_problem(installed, need):
    """入っていない・版が違うパッケージがあれば理由（先頭が missing-packages: / unsupported-version:）。無ければ None"""
    missing = [d for d in need if installed.get(d) is None]
    if missing:
        return 'missing-packages: この計算機に ' + ' '.join(missing) + ' を入れてください（pip install ' + ' '.join(
            d + ('==' + need[d] if need[d] else '') for d in missing) + '）'
    bad = [d for d, want in need.items() if want and installed[d].split('+')[0] != want]
    if bad:
        return 'unsupported-version: ' + '、'.join(
            d + ' ' + installed[d] + '（動作を確かめた版は ' + need[d] + '）' for d in bad
        ) + '。環境を書き換えないので、専用の環境で pip install ' + ' '.join(d + '==' + need[d] for d in bad) + ' を入れてください'
    return None


def weights_dir():
    return os.path.join(os.path.expanduser('~'), '.graphy-next', 'models', 'vis-dental-pano')


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def weights_state():
    """重みの有無と、固定した sha256 との一致。sha256 が空のあいだは一致の確認をしない（試作）"""
    out = {}
    for key, w in GRAPHY['weights'].items():
        path = os.path.join(weights_dir(), w['file'])
        exists = os.path.isfile(path)
        sha = sha256_file(path) if exists else None
        out[key] = {'file': w['file'], 'path': path, 'exists': exists, 'required': w['required'], 'sha256': sha,
                    'pinned': bool(w['sha256']), 'match': (sha == w['sha256']) if (exists and w['sha256']) else None}
    return out


def weights_problem(state):
    for key, s in state.items():
        if s['required'] and not s['exists']:
            return 'missing-weights: 重み ' + s['file'] + ' がありません。' + s['path'] + ' に置いてください'
        if s['exists'] and s['match'] is False:
            return 'bad-weights: ' + s['file'] + ' の内容が固定した版と違います（sha256 不一致）。置き直してください'
    return None


def load_image(path):
    """npz の volume[1, y, x] を窓で 8bit にする。使えない画像は not-applicable: で止める"""
    import numpy as np
    z = np.load(path)
    meta = json.loads(bytes(z['meta.json']))
    if meta.get('modality') not in ('PX', 'DX', 'CR'):
        raise RuntimeError('not-applicable: パノラマ X 線（PX / DX / CR）の 1 枚だけに使えます（このシリーズは ' + str(meta.get('modality')) + '）')
    vol = z['volume']
    if vol.ndim != 3 or vol.shape[0] != 1:
        raise RuntimeError('not-applicable: 1 枚の画像だけに使えます（このシリーズは ' + str(vol.shape[0]) + ' 枚・多フレームを含む）')
    a = vol[0].astype(np.float32)
    wc, ww = meta.get('windowCenter'), meta.get('windowWidth')
    func = meta.get('voiLutFunction') or 'LINEAR'
    window = 'minmax'
    lo, hi = float(a.min()), float(a.max())
    if wc and ww and func == 'LINEAR' and float(ww[0]) > 1:
        c, w = float(wc[0]), float(ww[0])
        lo, hi, window = c - 0.5 - (w - 1) / 2, c - 0.5 + (w - 1) / 2, 'dicom'
    if not hi > lo:
        raise RuntimeError('not-applicable: 画素値が一定で、画像として使えません')
    y = np.clip((a - lo) / (hi - lo), 0.0, 1.0)
    if meta.get('photometricInterpretation') == 'MONOCHROME1':
        y = 1.0 - y
    return (y * 255.0 + 0.5).astype(np.uint8), {'window': window, 'rows': int(a.shape[0]), 'cols': int(a.shape[1]),
                                                 'monochrome1': meta.get('photometricInterpretation') == 'MONOCHROME1'}


def fdi_of(name, index):
    """歯のクラス名から FDI（11〜48）を取る。クラス名に 2 桁の番号が無ければ設定の teethFdiByClass（クラス番号の順）を使う"""
    valid = {int(f) for f in GRAPHY['permanent']}
    m = re.search(r'(?<!\d)(\d{2})(?!\d)', str(name))
    if m and int(m.group(1)) in valid:
        return int(m.group(1))
    table = GRAPHY.get('teethFdiByClass')
    if table and 0 <= index < len(table) and table[index] in valid:
        return int(table[index])
    return None


DX_ALIASES = {
    'caries': 'caries', 'deepcaries': 'deep_caries', 'periapicallesion': 'periapical', 'periapical': 'periapical',
    'impacted': 'impacted', 'impactedtooth': 'impacted',
}


def dx_key(name):
    return DX_ALIASES.get(re.sub(r'[^a-z]', '', str(name).lower()))
`;

export const PY_MODEL = String.raw`

stage('setup', 0.02)
NEED = need_packages()
problem = env_problem({d: version_of(d) for d in NEED}, NEED)
if problem:
    raise RuntimeError(problem)
wstate = weights_state()
problem = weights_problem(wstate)
if problem:
    raise RuntimeError(problem)
import numpy as np
import torch
import ultralytics
from ultralytics import YOLO

gray, info = load_image('inputs/0.npz')
img = np.ascontiguousarray(np.repeat(gray[:, :, None], 3, axis=2))
stage('image', 0.1)


def predict(model, **kw):
    """CUDA のメモリが足りなければ CPU でやり直す（4 GB 級の GPU で 1280 px の x サイズを動かすため）"""
    global device
    try:
        return model.predict(img, imgsz=GRAPHY['imgsz'], device=device, verbose=False, **kw)[0]
    except torch.cuda.OutOfMemoryError:
        torch.cuda.empty_cache()
        device = 'cpu'
        return model.predict(img, imgsz=GRAPHY['imgsz'], device='cpu', verbose=False, **kw)[0]


device = 0 if torch.cuda.is_available() else 'cpu'
valid = {int(f) for f in GRAPHY['permanent']}

tm = YOLO(wstate['teeth']['path'])
if tm.task != 'segment':
    raise RuntimeError('unsupported-model: 歯の重みはセグメンテーション（segment）のモデルです（この重みは ' + str(tm.task) + '）')
stage('teeth-model', 0.3)
r = predict(tm, conf=GRAPHY['conf']['teeth'], iou=0.5, retina_masks=True, max_det=64)
teeth, skipped = [], []
for i, b in enumerate(r.boxes):
    cls = int(b.cls[0])
    fdi = fdi_of(r.names[cls], cls)
    if fdi is None:
        skipped.append(str(r.names[cls]))
        continue
    xy = r.masks.xy[i] if (r.masks is not None and i < len(r.masks.xy)) else None
    teeth.append({'fdi': fdi, 'conf': round(float(b.conf[0]), 4), 'bbox': [round(float(v), 1) for v in b.xyxy[0].tolist()],
                  'poly': [[round(float(x), 1), round(float(y), 1)] for x, y in xy] if xy is not None and len(xy) >= 3 else None})
if skipped and not teeth:
    raise RuntimeError('unsupported-model: 歯のクラス名から FDI を読めません: ' + ', '.join(sorted(set(skipped))[:6]))
stage('teeth', 0.6)

dx = None
if wstate['dx']['exists']:
    dm = YOLO(wstate['dx']['path'])
    if dm.task != 'detect':
        raise RuntimeError('unsupported-model: 診断の重みは検出（detect）のモデルです（この重みは ' + str(dm.task) + '）')
    dr = predict(dm, conf=GRAPHY['conf']['dx'], iou=0.5, max_det=100)
    dx = []
    for b in dr.boxes:
        key = dx_key(dr.names[int(b.cls[0])])
        if key is None:
            raise RuntimeError('unsupported-model: 診断のクラス名を解釈できません: ' + str(dr.names[int(b.cls[0])]))
        dx.append({'cls': key, 'conf': round(float(b.conf[0]), 4), 'bbox': [round(float(v), 1) for v in b.xyxy[0].tolist()]})
stage('dx', 0.9)

os.makedirs('outputs', exist_ok=True)
json.dump({
    'rows': info['rows'], 'cols': info['cols'], 'window': info['window'], 'device': 'cuda' if device == 0 else 'cpu',
    'torch': torch.__version__, 'ultralytics': ultralytics.__version__, 'seconds': round(time.time() - T0, 1),
    'model': 'teeth=' + wstate['teeth']['file'] + '@' + (wstate['teeth']['sha256'] or '?')[:8]
             + (' dx=' + wstate['dx']['file'] + '@' + (wstate['dx']['sha256'] or '?')[:8] if dx is not None else ' dx=none'),
    'skippedClasses': sorted(set(skipped)), 'teeth': teeth, 'dx': dx,
}, open('outputs/result.json', 'w', encoding='utf-8'), ensure_ascii=False)
stage('done', 1.0)
`;

/** 画像を送らない事前チェック。入っているパッケージ・重み・Python の場所を env.json に書くだけ（何も入れない・書き換えない） */
export const PY_PROBE = String.raw`
stage('probe', 0.3)
need = need_packages()
installed = {d: version_of(d) for d in need}
torch_error = None
cuda = None
if installed['torch']:
    try:
        import torch
        cuda = bool(torch.cuda.is_available())
    except Exception as e:
        torch_error = type(e).__name__ + ': ' + str(e)[:200]
problem = env_problem(installed, need)
if problem is None and torch_error:
    problem = 'broken-package: torch を読み込めません（' + torch_error + '）。入れ直してください'
wstate = weights_state()
if problem is None:
    problem = weights_problem(wstate)
os.makedirs('outputs', exist_ok=True)
json.dump({'python': sys.executable, 'pyVersion': sys.version.split()[0], 'installed': installed, 'need': need,
           'problem': problem, 'torchError': torch_error, 'cuda': cuda, 'weights': wstate, 'weightsDir': weights_dir()},
          open('outputs/env.json', 'w', encoding='utf-8'), ensure_ascii=False)
stage('done', 1.0)
`;

export const PY = PY_PREP + PY_MODEL;

function config() {
  return {
    ultralytics: ULTRALYTICS, weights: WEIGHTS, conf: CONF, imgsz: IMGSZ, permanent: PERMANENT,
    // 歯のクラス名に番号が無い重みのための表（クラス番号の順に FDI）。重みを確定したら埋める
    teethFdiByClass: null,
  };
}

/** 計算機に送るコード。差し込むのは固定の設定だけ。 */
export function buildScript() {
  return `GRAPHY = __import__('json').loads(${JSON.stringify(JSON.stringify(config()))})\n` + PY;
}

/** 事前チェックのコード（画像は送らない） */
export function buildProbeScript() {
  return `GRAPHY = __import__('json').loads(${JSON.stringify(JSON.stringify(config()))})\n` + PY_PREP + PY_PROBE;
}

/**
 * 不足・版違いを入れる pip のコマンド。計算機が実際に使う Python（sys.executable）を名指しする
 * （Windows では python と py が別物のことがある）。空白などを含むパスは引用符で囲む。
 */
export function installCommand(/** @type {string} */ python, /** @type {Record<string, string | null>} */ installed, /** @type {Record<string, string | null>} */ need) {
  const wanted = Object.keys(need).filter((d) => installed[d] == null || (need[d] && String(installed[d]).split("+")[0] !== need[d]));
  if (!wanted.length) return null;
  const exe = /^[\w./:\\-]+$/.test(python) ? python : `"${python}"`;
  return `${exe} -m pip install ${wanted.map((d) => d + (need[d] ? "==" + need[d] : "")).join(" ")}`;
}

/** 本体がデータを作らなかった・送らなかった理由（よく出るものだけ）。 */
const REFUSALS = {
  "burnin-risky-modality": "この本体は、この種類の X 線を計算機へ渡せません。この PC の計算機（local）を使えるようにしてください",
  "dataset-local-only": "この画像はこの PC の計算機にしか渡せません（外部の計算機は選べません）",
  "npz-too-large": "画像が大きすぎます",
  "permission-denied": "このプラグインに計算機を使う許可がありません",
  "no-endpoint": "環境設定 ＞ 外部の計算機 で、この PC の計算機（local）を使えるようにしてください",
  "local-unavailable": "この PC の計算機を使えません（Python・jupyter_server・ipykernel が揃っていません）",
};
export const explain = (/** @type {string | undefined} */ code) =>
  code && /** @type {Record<string,string>} */ (REFUSALS)[code] ? `${/** @type {Record<string,string>} */ (REFUSALS)[code]}（${code}）` : String(code);

/** 対象のタイルを使えるか。使えなければ理由を返す。 */
export function targetProblem(/** @type {any} */ t) {
  if (!t) return "画像のタイルを選んでから開いてください / Select an image tile first";
  if (t.kind !== "image") return "動画は対象外です / Videos are not supported";
  const m = String(t.modality ?? "").toUpperCase();
  if (m !== "PX" && m !== "DX" && m !== "CR") return `パノラマ X 線（PX / DX / CR）の 1 枚だけに使えます（このシリーズは ${m || "?"}） / Only a single panoramic radiograph (PX / DX / CR) (this series is ${m || "?"})`;
  if (t.sliceCount > 1) return `1 枚の画像だけに使えます（このシリーズは ${t.sliceCount} 枚） / Single image only (this series has ${t.sliceCount})`;
  return null;
}

/** 計算機の失敗（errorName: errorValue）を、画面に出す文にする。 */
export function failureText(/** @type {string | undefined} */ value) {
  const v = String(value ?? "");
  const m = /^(missing-packages|unsupported-version|not-applicable|missing-weights|bad-weights|unsupported-model): ?(.*)$/s.exec(v);
  return m ? m[2] : `失敗 / Failed: ${v}`;
}

// ---------------------------------------------------------------------------
// 画面
// ---------------------------------------------------------------------------

/** 明るい・暗いどちらのテーマでも読める（背景と文字色の両方を固定する） */
const BANNER_STYLE = "padding: 8px 10px; background: #fff4e5; border: 1px solid #f0b36b; border-radius: 4px; color: #5c3300";

/** @param {any} host */
export async function activate(host) {
  const lang = langOf(host.locale ?? globalThis.navigator?.language);
  const s = S[lang];
  const target = (host.getTargets?.() ?? []).find((/** @type {any} */ t) => t.kind === "image");
  const problem = targetProblem(target);
  if (problem) {
    host.notify(s.title + ": " + problem);
    return;
  }
  const win = host.openWindow({ title: s.title, width: 780, height: 820 });
  const root = win.container;
  root.style.cssText = "font: 13px system-ui, sans-serif; padding: 12px; overflow: auto; display: flex; flex-direction: column; gap: 8px;";
  /** @type {Record<string, any>} */
  const state = (/** @type {any} */ (window).__dentalPanoState = { phase: "idle" });

  const el = (/** @type {string} */ tag, /** @type {Record<string, any>} */ props = {}, /** @type {any[]} */ ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === "testid") e.dataset.testid = v;
      else if (k === "style") e.style.cssText = v;
      else /** @type {any} */ (e)[k] = v;
    }
    for (const c of kids) e.append(c);
    return e;
  };

  const banner = el("div", { testid: "dp-disclaimer", textContent: "⚠ " + DISCLAIMERS[lang], style: BANNER_STYLE });
  const about = el("div", { testid: "dp-about", style: "font-size: 12px; opacity: 0.85; line-height: 1.5", textContent: s.about });
  const runBtn = el("button", { textContent: s.run, testid: "dp-run", style: "align-self: flex-start; padding: 4px 18px" });
  const status = el("div", { testid: "dp-status", style: "min-height: 1.4em; opacity: 0.9" });
  const result = el("div", { testid: "dp-result", style: "display: none; flex-direction: column; gap: 10px" });
  const envBox = el("div", { testid: "dp-env", style: `display: none; flex-direction: column; gap: 6px; ${BANNER_STYLE}` });
  root.append(banner, about, el("div", { style: "opacity: 0.8" }, `${s.target}: ${target.seriesLabel ?? ""}`), runBtn, status, envBox, result);

  const setStatus = (/** @type {string} */ t) => { status.textContent = t; state.status = t; };
  const onProgress = (/** @type {number} */ p, /** @type {string | undefined} */ m) => setStatus(`${Math.round(p * 100)}% ${m ?? ""}`);

  /** 重ね表示（この窓で置いた ROI） */
  /** @type {{ teeth: Map<number,string>, tooth: string[], dx: string[] }} */
  const rois = { teeth: new Map(), tooth: [], dx: [] };
  const removeRois = (/** @type {"tooth"|"dx"|"all"} */ which) => {
    for (const k of /** @type {("tooth"|"dx")[]} */ (which === "all" ? ["tooth", "dx"] : [which])) {
      for (const uid of rois[k]) host.removeCreatedRoi?.(uid);
      rois[k] = [];
      if (k === "tooth") rois.teeth = new Map();
    }
  };
  win.onClose?.(() => removeRois("all"));

  let envOk = false;

  const showEnv = (/** @type {any} */ env) => {
    const kids = [el("div", { style: "font-weight: 600" }, s.envTitle)];
    kids.push(el("div", { testid: "dp-env-python", style: "font-size: 12px; word-break: break-all" }, `${s.envPython}: ${env.python}（${env.pyVersion}）`));
    for (const d of Object.keys(env.need)) {
      const v = env.installed[d];
      const want = env.need[d];
      const ok = v != null && (!want || String(v).split("+")[0] === want);
      kids.push(el("div", { style: "display: flex; gap: 12px; font-size: 12px" },
        el("span", { style: "width: 110px; font-weight: 600" }, d),
        el("span", { style: "width: 110px" }, want ? "== " + want : s.envAnyVersion),
        el("span", {}, v == null ? s.envMissing : ok ? "✓ " + v : "✗ " + v + s.envWrongVersion)));
    }
    if (env.problem && /^(broken-package|missing-weights|bad-weights)/.test(env.problem)) kids.push(el("div", { testid: "dp-env-problem", style: "font-size: 12px; word-break: break-all" }, failureText(env.problem)));
    for (const w of Object.values(/** @type {Record<string, any>} */ (env.weights ?? {}))) {
      if (w.exists) continue;
      kids.push(el("div", { style: "font-size: 12px; word-break: break-all" }, `${s.weightsTitle}: ${w.file}${w.required ? "" : " " + s.weightsOptional}`, el("br"), env.weightsDir));
    }
    const cmd = installCommand(env.python, env.installed, env.need);
    if (cmd) {
      const area = el("textarea", { value: cmd, readOnly: true, rows: 3, testid: "dp-env-command", style: "width: 100%; box-sizing: border-box; font: 12px ui-monospace, monospace" });
      const copy = el("button", { textContent: s.envCopy, testid: "dp-env-copy", style: "font-size: 11px" });
      copy.addEventListener("click", () => { void navigator.clipboard?.writeText(cmd); });
      kids.push(el("div", { style: "font-size: 12px" }, s.envHow), area, copy, el("div", { style: "font-size: 11px; opacity: 0.85; line-height: 1.5" }, s.envGpu));
    }
    const again = el("button", { textContent: s.envRecheck, testid: "dp-env-recheck", style: "align-self: flex-start; padding: 2px 14px" });
    again.addEventListener("click", async () => {
      again.disabled = true;
      if (await checkEnv()) setStatus(s.envReady);
      again.disabled = false;
    });
    kids.push(again, el("div", { style: "font-size: 11px; opacity: 0.85" }, s.envAfter));
    envBox.replaceChildren(...kids);
    envBox.style.display = "flex";
  };

  /** 画像を送らない小さなジョブで、計算機の Python と重みを確かめる。整っていれば true */
  const checkEnv = async () => {
    setStatus(s.checking);
    const r = await host.compute.runJob({ endpointId: "local", inputs: [], script: buildProbeScript(), timeoutSec: 600 }, { onProgress });
    if (!r.ok) {
      state.error = r.error;
      setStatus(r.cancelled ? s.cancelled : explain(r.error));
      return false;
    }
    if (r.status !== "ok") {
      state.error = `${r.errorName}: ${r.errorValue}`;
      setStatus(failureText(r.errorValue));
      return false;
    }
    const raw = await r.readFile("env.json");
    if (!raw) {
      state.error = "no-env";
      setStatus("失敗 / Failed: env.json");
      return false;
    }
    const env = JSON.parse(new TextDecoder().decode(raw));
    state.env = env;
    if (env.problem) {
      envOk = false;
      showEnv(env);
      setStatus(s.envNeed);
      return false;
    }
    envOk = true;
    envBox.style.display = "none";
    envBox.replaceChildren();
    return true;
  };

  /** 結果の画面 */
  const showResult = (/** @type {ReturnType<typeof normalizeResult>} */ res) => {
    state.result = res;
    /** @type {number | null} */
    let selected = null;
    const chartHost = el("div", { testid: "dp-chart-host" });
    const drawChart = () => {
      chartHost.replaceChildren(renderChart(document, chartModel(res), lang, {
        selected,
        onSelect: (fdi) => {
          selected = fdi;
          const uid = rois.teeth.get(fdi);
          if (uid) host.selectRoi?.(target.tileId, uid);
          state.selectedFdi = fdi;
          drawChart();
        },
      }));
    };
    drawChart();

    const overlayMsg = el("div", { testid: "dp-overlay-msg", style: "font-size: 12px; opacity: 0.85" });
    const showTeeth = el("input", { type: "checkbox", testid: "dp-show-teeth", checked: true });
    const showDx = el("input", { type: "checkbox", testid: "dp-show-dx", checked: res.dx !== null && res.dx.length > 0, disabled: !res.dx?.length });
    const clearBtn = el("button", { textContent: s.clear, testid: "dp-clear", style: "font-size: 11px" });
    const apply = () => {
      removeRois("all");
      let fb = 0, failed = 0, n = 0;
      if (showTeeth.checked) {
        const p = placeRois(host, target.tileId, "teeth", res);
        rois.teeth = p.uids; rois.tooth = p.all; fb += p.fallback; failed += p.failed; n += p.all.length;
      }
      if (showDx.checked) {
        const p = placeRois(host, target.tileId, "dx", res);
        rois.dx = p.all; failed += p.failed; n += p.all.length;
      }
      overlayMsg.textContent = n || failed ? s.placed(n, fb, failed) : "";
      state.overlay = { placed: n, fallback: fb, failed };
    };
    showTeeth.addEventListener("change", apply);
    showDx.addEventListener("change", apply);
    clearBtn.addEventListener("click", () => { showTeeth.checked = false; showDx.checked = false; removeRois("all"); overlayMsg.textContent = ""; state.overlay = { placed: 0, fallback: 0, failed: 0 }; });

    const tableRows = [];
    if (res.dx === null) tableRows.push(el("div", { testid: "dp-no-dx", style: "font-size: 12px" }, s.noDx));
    else if (!res.dx.length) tableRows.push(el("div", { testid: "dp-no-dx-found", style: "font-size: 12px" }, s.noDxFound));
    else for (const d of [...res.dx].sort((a, b) => (a.fdi ?? 99) - (b.fdi ?? 99))) {
      tableRows.push(el("div", { testid: "dp-dx-row", style: "display: flex; gap: 8px; align-items: center; font-size: 12px" },
        el("span", { style: `display:inline-block;width:10px;height:10px;border-radius:2px;background:${DX[/** @type {keyof typeof DX} */ (d.cls)].color}` }),
        el("span", { style: "width: 120px" }, DX[/** @type {keyof typeof DX} */ (d.cls)][lang]),
        el("span", { style: "width: 70px" }, d.fdi != null ? `FDI ${d.fdi}` : s.unassigned),
        el("span", { style: "opacity: 0.8" }, d.conf.toFixed(2))));
    }

    const reportText = buildReport(res, lang);
    const reportArea = el("textarea", { value: reportText, readOnly: true, rows: 12, testid: "dp-report", style: "width: 100%; box-sizing: border-box; font: 13px system-ui, sans-serif" });
    const copyBtn = el("button", { textContent: s.copy, testid: "dp-copy", style: "font-size: 11px" });
    copyBtn.addEventListener("click", () => { void navigator.clipboard?.writeText(reportText); });
    const srBtn = el("button", { textContent: s.saveSr, testid: "dp-save-sr" });
    const csvBtn = el("button", { textContent: s.saveCsv, testid: "dp-save-csv" });
    const pubBtn = el("button", { textContent: s.publish, testid: "dp-publish" });
    srBtn.addEventListener("click", async () => {
      const r = await host.saveStructuredReport(target.tileId, buildSrRequest(res, lang));
      state.sr = r;
      setStatus(r.ok ? s.srSaved : r.cancelled ? s.srCancelled : `SR: ${r.error}`);
    });
    csvBtn.addEventListener("click", async () => {
      const r = await host.file.saveAs({ defaultName: "dental-pano.csv", bytes: new TextEncoder().encode(buildCsv(res)), filters: [{ name: "CSV", extensions: ["csv"] }] });
      state.csv = r;
      if (r.ok) setStatus(s.csvSaved);
    });
    pubBtn.addEventListener("click", () => {
      const r = host.publishAnalysisResult(target.tileId, buildAnalysisResult(res, lang, target.sopInstanceUid));
      state.published = r;
      setStatus(r.ok ? s.published : `${r.error}`);
    });

    result.replaceChildren(
      el("div", { style: "font-weight: 600" }, s.chart),
      chartHost,
      el("div", { style: "display: flex; gap: 12px; align-items: center; flex-wrap: wrap" },
        el("span", { style: "font-weight: 600" }, s.overlays),
        el("label", {}, showTeeth, " " + s.showTeeth), el("label", {}, showDx, " " + s.showDx), clearBtn),
      overlayMsg,
      el("div", { style: "font-weight: 600" }, s.dxTable), ...tableRows,
      el("div", { style: "display: flex; gap: 8px; align-items: center; font-weight: 600" }, s.report, copyBtn),
      reportArea,
      el("div", { style: "display: flex; gap: 8px; flex-wrap: wrap" }, srBtn, csvBtn, pubBtn),
      el("div", { testid: "dp-meta", style: "font-size: 11px; opacity: 0.75" }, s.meta(res), " ", res.model),
    );
    result.style.display = "flex";
    apply();
  };

  runBtn.addEventListener("click", async () => {
    runBtn.disabled = true;
    if (!envOk && !(await checkEnv())) {
      runBtn.disabled = false;
      return;
    }
    removeRois("all");
    result.style.display = "none";
    result.replaceChildren();
    state.phase = "running"; state.error = undefined; state.result = undefined;
    setStatus(s.sending);
    const r = await host.compute.runJob({
      endpointId: "local",
      inputs: [{ studyUid: target.studyUid, seriesUid: target.seriesUid, format: "npz" }],
      script: buildScript(),
      timeoutSec: 3600,
    }, { onProgress });
    if (!r.ok) {
      state.phase = "failed"; state.error = r.error;
      setStatus(r.cancelled ? s.cancelled : explain(r.error));
      runBtn.disabled = false;
      return;
    }
    if (r.status !== "ok") {
      state.phase = "failed"; state.error = `${r.errorName}: ${r.errorValue}`; state.stderr = r.stderr;
      const envLost = /^(missing-packages|unsupported-version|missing-weights|bad-weights): /.test(String(r.errorValue));
      if (envLost) envOk = false; // 確認のあとで環境が変わった。次の「実行」でもう一度確かめて手順を出す
      setStatus(failureText(r.errorValue));
      runBtn.disabled = false;
      return;
    }
    const raw = await r.readFile("result.json");
    if (!raw) {
      state.phase = "failed"; state.error = "no-result";
      setStatus("失敗 / Failed: result.json");
      runBtn.disabled = false;
      return;
    }
    try {
      showResult(normalizeResult(JSON.parse(new TextDecoder().decode(raw))));
      state.phase = "done";
      setStatus(s.done);
    } catch (e) {
      state.phase = "failed"; state.error = String(e);
      setStatus("失敗 / Failed: " + (e instanceof Error ? e.message : String(e)));
    }
    runBtn.disabled = false;
  });
}
