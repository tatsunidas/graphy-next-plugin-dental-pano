// node --test   （Python 前半は numpy のある python3 で試す。GRAPHY_TEST_PYTHON で変えられる）
// モデル本体（torch / ultralytics）は使わない。確かめるのは「割り当て・欠損歯・レポート・SR・CSV・チャート・計算機の前半・画面の往復」。
// モデルの実行は実機（README の検証）で確かめる。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { JSDOM } from "jsdom";

import {
  CELL, DX, LOWER, PERMANENT, PY, PY_PREP, PY_PROBE, UPPER, activate, assignDiagnoses, boxCorners, buildAnalysisResult, buildCsv, buildProbeScript,
  buildReport, buildScript, buildSrRequest, chartModel, diagnosisByClass, explain, failureText, installCommand, intersectionArea, missingTeeth,
  normalizeResult, placeRois, renderChart, simplifyPolygon, targetProblem,
} from "./ui.js";

const PYTHON = process.env.GRAPHY_TEST_PYTHON || "python3";
const py = (code, cwd, env) => spawnSync(PYTHON, ["-I", "-c", code], { cwd, encoding: "utf8", env: { ...process.env, ...env } });

/** 1 本の歯の枠（10×20 の長方形） */
const tooth = (fdi, x, conf = 0.9, y = 0) => ({ fdi, conf, bbox: [x, y, x + 10, y + 20], poly: boxCorners([x, y, x + 10, y + 20]) });
const ring = (n, r, cx = 100, cy = 100) => Array.from({ length: n }, (_, i) => [cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
const area = (p) => Math.abs(p.reduce((s, q, i) => s + (q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1]), 0)) / 2;

test("FDI の並び: 永久歯 32 本・重複なし・チャートの左が患者の右", () => {
  assert.equal(PERMANENT.length, 32);
  assert.equal(new Set(PERMANENT).size, 32);
  assert.deepEqual(UPPER.slice(0, 3), [18, 17, 16]);
  assert.deepEqual(UPPER.slice(7, 9), [11, 21]);
  assert.deepEqual(LOWER.slice(7, 9), [41, 31]);
});

test("targetProblem: 通る画像と止める画像（PX / DX / CR の 1 枚だけ）", () => {
  const ok = { kind: "image", modality: "PX", sliceCount: 1 };
  assert.equal(targetProblem(ok), null);
  assert.equal(targetProblem({ ...ok, modality: "dx" }), null);
  assert.equal(targetProblem({ ...ok, modality: "CR" }), null);
  assert.match(targetProblem(null), /タイル/);
  assert.match(targetProblem({ ...ok, kind: "video" }), /動画/);
  for (const m of ["CT", "MR", "PT", "US", "XA", "NM", "MG", "IO", "OT", ""]) assert.match(targetProblem({ ...ok, modality: m }) ?? "", /PX \/ DX \/ CR/, m);
  assert.match(targetProblem({ ...ok, sliceCount: 3 }), /3/);
});

test("intersectionArea / assignDiagnoses: 重なり最大の歯へ。重なり 0 は null（正例と負例）", () => {
  assert.equal(intersectionArea([0, 0, 10, 10], [5, 5, 15, 15]), 25);
  assert.equal(intersectionArea([0, 0, 10, 10], [10, 0, 20, 10]), 0);
  const teeth = [tooth(36, 0), tooth(37, 8)]; // 36: x0..10、37: x8..18
  const [a, b, c] = assignDiagnoses(teeth, [
    { cls: "caries", conf: 0.8, bbox: [1, 2, 6, 8] },      // 36 に全部入る
    { cls: "periapical", conf: 0.7, bbox: [7, 2, 17, 12] }, // 36 と 2、37 と 9 列分 → 37 が最大
    { cls: "impacted", conf: 0.6, bbox: [100, 100, 110, 110] }, // どの歯とも重ならない
  ]);
  assert.equal(a.fdi, 36); assert.equal(a.overlap, 1);
  assert.equal(b.fdi, 37); assert.ok(b.overlap > 0 && b.overlap < 1);
  assert.equal(c.fdi, null); assert.equal(c.overlap, 0);
});

test("normalizeResult: 重複 FDI は信頼度の高い方、不正な検出は捨てて数える、診断は割り当て済み", () => {
  const res = normalizeResult({
    rows: 100, cols: 200, device: "cpu", seconds: 1.2, model: "m",
    teeth: [tooth(36, 0, 0.5), tooth(36, 50, 0.9), tooth(99, 0), { fdi: 11, conf: 0.9, bbox: [5, 5, 5, 9] }, tooth(11, 100)],
    dx: [{ cls: "caries", conf: 0.8, bbox: [51, 1, 55, 5] }, { cls: "weird", conf: 0.8, bbox: [0, 0, 5, 5] }],
  });
  assert.deepEqual(res.teeth.map((t) => t.fdi), [11, 36]);
  assert.equal(res.teeth.find((t) => t.fdi === 36).bbox[0], 50, "信頼度の高い方を採る");
  assert.deepEqual(res.duplicates, [36]);
  assert.equal(res.dropped, 3, "不正な FDI・潰れた bbox・未知のクラス");
  assert.equal(res.dx.length, 1);
  assert.equal(res.dx[0].fdi, 36);
  assert.throws(() => normalizeResult({}), /teeth/);
  assert.equal(normalizeResult({ teeth: [], dx: null }).dx, null, "診断モデル無しは null のまま（空配列と区別する）");
});

test("missingTeeth: 検出されなかった永久歯を、チャートの並びで返す", () => {
  const m = missingTeeth([{ fdi: 18 }, { fdi: 11 }, { fdi: 48 }]);
  assert.equal(m.upper.length, 14);
  assert.equal(m.lower.length, 15);
  assert.ok(!m.upper.includes(18) && !m.upper.includes(11) && !m.lower.includes(48));
  assert.deepEqual(m.upper.slice(0, 2), [17, 16]);
  assert.deepEqual(missingTeeth(PERMANENT.map((fdi) => ({ fdi }))), { upper: [], lower: [] });
});

test("simplifyPolygon: 円を 64 点以下に間引いても面積が 2% 以内。3 点未満は null。閉じる重複点は除く", () => {
  const c = ring(600, 50);
  const s = simplifyPolygon(c, 64);
  assert.ok(s.length <= 64 && s.length >= 3);
  assert.ok(Math.abs(area(s) - area(c)) / area(c) < 0.02);
  assert.equal(simplifyPolygon([[0, 0], [1, 1]]), null);
  assert.equal(simplifyPolygon([[0, 0], [1, 0], [1, 1], [0, 0]]).length, 3, "終点が始点と同じなら落とす");
  assert.deepEqual(simplifyPolygon(boxCorners([0, 0, 4, 4]), 64), boxCorners([0, 0, 4, 4]));
  const tight = simplifyPolygon(c, 16);
  assert.ok(tight.length <= 16);
});

test("buildReport: 歯の本数・欠損・診断の歯番号が入る（ja / en）。診断モデル無しは明記する", () => {
  const raw = {
    rows: 1, cols: 1, device: "cpu", model: "M",
    teeth: [tooth(16, 0), tooth(17, 20), tooth(46, 40)],
    dx: [{ cls: "caries", conf: 0.8, bbox: [1, 1, 5, 5] }, { cls: "caries", conf: 0.7, bbox: [41, 1, 45, 5] }, { cls: "impacted", conf: 0.7, bbox: [500, 1, 505, 5] }],
  };
  const res = normalizeResult(raw);
  const ja = buildReport(res, "ja");
  assert.match(ja, /検出した歯: 3 本（16、17、46）/);
  assert.match(ja, /う蝕の候補がある歯: 16、46/);
  assert.match(ja, /埋伏歯の候補（歯を特定できず）: 1 件/);
  assert.match(ja, /上顎 18、15/);
  assert.match(ja, /研究用の下書き/);
  const en = buildReport(res, "en");
  assert.match(en, /Detected teeth: 3 \(16, 17, 46\)/);
  assert.match(en, /Teeth with Caries candidates: 16, 46/);
  const noModel = buildReport(normalizeResult({ ...raw, dx: null }), "ja");
  assert.match(noModel, /診断モデルは使っていません/);
  assert.doesNotMatch(noModel, /候補がある歯/);
  assert.match(buildReport(normalizeResult({ ...raw, dx: [] }), "ja"), /診断の候補はありません/);
});

test("buildSrRequest: 所見だけ（group は空）。本体が拒否する空の計測を作らない", () => {
  const res = normalizeResult({ teeth: [tooth(16, 0)], dx: [{ cls: "caries", conf: 0.8, bbox: [1, 1, 5, 5] }] });
  const r = buildSrRequest(res, "ja");
  assert.deepEqual(r.groups, []);
  assert.ok(r.findings.length >= 4);
  assert.ok(r.findings.every((f) => f.label && typeof f.text === "string" && f.text.length));
  assert.equal(r.findings.find((f) => f.label === "う蝕").text, "16");
  assert.match(r.findings.at(-1).text, /研究用/);
  assert.ok(buildSrRequest(normalizeResult({ teeth: [], dx: null }), "en").findings.some((f) => /No diagnosis model/.test(f.text)));
});

test("buildAnalysisResult: caveats が 1 つ以上、kind は plugin、sop は渡したときだけ", () => {
  const res = normalizeResult({ teeth: [tooth(16, 0)], dx: [] });
  const a = buildAnalysisResult(res, "en", "1.2.3");
  assert.equal(a.kind, "plugin");
  assert.deepEqual(a.sopInstanceUids, ["1.2.3"]);
  assert.ok(a.caveats.length >= 1 && a.caveats.every((c) => c.trim()));
  assert.equal("sopInstanceUids" in buildAnalysisResult(res, "en", null), false);
});

test("buildCsv: BOM・CRLF・見出し・行の種類。自由な文字列は入らない", () => {
  const res = normalizeResult({ teeth: [tooth(16, 0)], dx: [{ cls: "caries", conf: 0.8, bbox: [1, 1, 5, 5] }] });
  const csv = buildCsv(res);
  assert.ok(csv.startsWith("\ufeffkind,fdi,class,confidence,x0,y0,x1,y1,overlap_with_tooth\r\n"));
  const lines = csv.trim().split("\r\n");
  assert.equal(lines.filter((l) => l.startsWith("tooth,")).length, 1);
  assert.equal(lines.filter((l) => l.startsWith("diagnosis,16,caries")).length, 1);
  assert.equal(lines.filter((l) => l.startsWith("not_detected,")).length, 31);
  assert.ok(lines.slice(1).every((l) => l.split(",").length === 9), "全行が 9 列");
});

test("chartModel: 32 マス・上顎が上段・中央に隙間・検出と診断が反映される", () => {
  const res = normalizeResult({ teeth: [tooth(16, 0), tooth(36, 50)], dx: [{ cls: "caries", conf: 0.8, bbox: [1, 1, 5, 5] }, { cls: "impacted", conf: 0.8, bbox: [2, 2, 6, 6] }] });
  const m = chartModel(res);
  assert.equal(m.length, 32);
  const by = (f) => m.find((c) => c.fdi === f);
  assert.equal(by(16).detected, true);
  assert.equal(by(17).detected, false);
  assert.deepEqual(by(16).dx, ["caries", "impacted"]);
  assert.deepEqual(by(36).dx, []);
  assert.ok(by(18).y < by(48).y);
  assert.equal(by(11).x + CELL.w + CELL.gap + CELL.mid, by(21).x, "11 と 21 の間にだけ中央の隙間がある");
  assert.equal(by(18).x, by(48).x);
});

const dom = () => {
  const { window } = new JSDOM("<!doctype html><body></body>");
  return window;
};

test("renderChart（jsdom）: 32 個の歯、欠損は破線、診断は色付きの印、選択で枠が変わる、クリックで通知", () => {
  const w = dom();
  const res = normalizeResult({ teeth: [tooth(16, 0), tooth(36, 50)], dx: [{ cls: "caries", conf: 0.8, bbox: [1, 1, 5, 5] }] });
  let clicked = null;
  const svg = renderChart(w.document, chartModel(res), "ja", { selected: 36, onSelect: (f) => { clicked = f; } });
  assert.equal(svg.querySelectorAll('[data-testid^="fdi-"]').length, 32);
  assert.equal(svg.querySelectorAll('[data-state="detected"]').length, 2);
  assert.equal(svg.querySelectorAll('[data-state="missing"]').length, 30);
  assert.equal(svg.querySelector('[data-testid="fdi-17"] rect').getAttribute("stroke-dasharray"), "4 3");
  assert.equal(svg.querySelector('[data-testid="fdi-16"] [data-dx-key="caries"]').getAttribute("fill"), DX.caries.color);
  assert.equal(svg.querySelector('[data-testid="fdi-36"] rect').getAttribute("stroke"), "#FF6900");
  svg.querySelector('[data-testid="fdi-16"]').dispatchEvent(new w.Event("click"));
  assert.equal(clicked, 16);
  clicked = null;
  svg.querySelector('[data-testid="fdi-17"]').dispatchEvent(new w.Event("click"));
  assert.equal(clicked, null, "検出されなかった歯は選べない");
});

test("placeRois: 多角形を置く。自己交差は粗くして再試行→それでも駄目なら枠。失敗は数える", () => {
  const res = normalizeResult({ teeth: [tooth(11, 0), tooth(12, 20), tooth(13, 40)], dx: [{ cls: "caries", conf: 0.8, bbox: [1, 1, 5, 5] }] });
  /** @type {any[]} */
  const calls = [];
  const host = {
    createRoi: (_t, req) => {
      calls.push(req);
      if (req.label === "FDI 12" && req.verticesPx.length > 4) return { ok: false, reason: "self-intersecting" };
      if (req.label === "FDI 13") return { ok: false, reason: "off-slice" };
      return { ok: true, roiUid: "uid-" + calls.length };
    },
  };
  const p = placeRois(host, "t0", "teeth", res);
  assert.equal(p.uids.size, 2);
  assert.ok(p.uids.has(11) && p.uids.has(12) && !p.uids.has(13));
  assert.equal(p.failed, 1, "off-slice は再試行せず失敗に数える");
  assert.ok(calls.every((c) => c.tool === "PolygonROI" && c.verticesPx.every((v) => v.length === 2)));
  const d = placeRois(host, "t0", "dx", res);
  assert.equal(d.all.length, 1);
  assert.equal(calls.at(-1).label, "caries 36".replace("36", "11"), "診断の枠は bbox の 4 隅で、割り当てた歯の番号がラベルに入る");
  assert.equal(calls.at(-1).verticesPx.length, 4);
});

// ---------------------------------------------------------------------------
// 計算機の上の Python（前半）
// ---------------------------------------------------------------------------

test("buildScript: 固定の設定だけが入り、本体の上限と埋め込み検査の目安に収まる", () => {
  for (const s of [buildScript(), buildProbeScript()]) {
    assert.ok(s.startsWith("GRAPHY = __import__('json').loads("));
    assert.ok(s.length < 64 * 1024);
    assert.ok(!/[A-Za-z0-9+/=]{200}/.test(s), "base64 らしい長い連なりがある");
    assert.ok(!/[\d.,\s-]{400}/.test(s.replace(/\s{2,}/g, " ")), "数字の長い並びがある");
  }
});

test("PY 全体・事前チェックは Python として構文が正しい", () => {
  for (const code of [buildScript(), buildProbeScript()]) {
    const r = spawnSync(PYTHON, ["-I", "-c", "import ast,sys; ast.parse(sys.stdin.read())"], { input: code, encoding: "utf-8" });
    assert.equal(r.status, 0, r.stderr);
  }
});

const HEAD = (extra = "") => `
import json
GRAPHY = json.loads(${JSON.stringify(JSON.stringify({
  ultralytics: "", conf: { teeth: 0.25, dx: 0.25 }, imgsz: 1280, permanent: PERMANENT, teethFdiByClass: null,
  weights: { teeth: { file: "t.pt", sha256: "", required: true }, dx: { file: "d.pt", sha256: "", required: false } },
}))})
${extra}
`;

test("fdi_of / dx_key: 番号を含むクラス名を読む。範囲外・番号なしは None（正例と負例）", () => {
  const r = py(HEAD() + PY_PREP + `
print(json.dumps([fdi_of('36', 0), fdi_of('tooth_11', 5), fdi_of('Tooth 48', 1), fdi_of('19', 0), fdi_of('tooth', 0), fdi_of('123', 0),
  dx_key('Caries'), dx_key('Deep Caries'), dx_key('deep_caries'), dx_key('Periapical Lesion'), dx_key('Impacted'), dx_key('Impacted tooth'), dx_key('filling')]))`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), [36, 11, 48, null, null, null, "caries", "deep_caries", "deep_caries", "periapical", "impacted", "impacted", null]);
});

test("env_problem: 入っていない・版違いを理由つきで返し、入っていれば None", () => {
  const r = py(HEAD() + PY_PREP + `
need = {'ultralytics': '9.9.9', 'torch': None}
print(json.dumps([env_problem({'ultralytics': None, 'torch': '2.0'}, need), env_problem({'ultralytics': '9.0.0', 'torch': '2.0'}, need), env_problem({'ultralytics': '9.9.9+cu1', 'torch': '2.0'}, need)]))`);
  assert.equal(r.status, 0, r.stderr);
  const [a, b, c] = JSON.parse(r.stdout.trim());
  assert.match(a, /^missing-packages: .*ultralytics==9\.9\.9/);
  assert.match(b, /^unsupported-version: .*9\.0\.0/);
  assert.equal(c, null);
});

test("installCommand: 不足だけを、使われる Python を名指しして出す。揃っていれば null", () => {
  const need = { ultralytics: null, torch: null };
  assert.equal(installCommand("/usr/bin/python3", { ultralytics: "8", torch: "2" }, need), null);
  assert.equal(installCommand("/usr/bin/python3", { ultralytics: null, torch: "2" }, need), "/usr/bin/python3 -m pip install ultralytics");
  assert.match(installCommand("C:\\Program Files\\Py\\python.exe", { ultralytics: null, torch: null }, need), /^"C:\\Program Files\\Py\\python\.exe" -m pip install ultralytics torch$/);
});

test("cuda_usable: torch にこの GPU 用のカーネルがあるときだけ真（実機で踏んだ: 2.15 の既定ビルドは GTX 1050 Ti = sm_61 に無い）", () => {
  const r = py(HEAD() + PY_PREP + `
class Cu:
    def __init__(self, avail, cc, archs): self.a, self.cc, self.ar = avail, cc, archs
    def is_available(self): return self.a
    def get_device_capability(self, i): return self.cc
    def get_arch_list(self): return self.ar
class T:
    def __init__(self, *a): self.cuda = Cu(*a)
cu132 = ['sm_75', 'sm_80', 'sm_86', 'sm_90', 'sm_100', 'sm_120']
cu126 = ['sm_50', 'sm_60', 'sm_70', 'sm_75', 'sm_80', 'sm_86', 'sm_90']
cases = [
  (True, (6, 1), cu132), (True, (6, 1), cu126), (True, (7, 5), cu132), (True, (8, 9), ['sm_80']),
  (True, (8, 0), ['sm_86']), (False, (8, 6), cu126), (True, (8, 9), ['compute_80']), (True, (7, 0), ['compute_80']),
  (True, (12, 0), cu132),
]
print(json.dumps([cuda_usable(T(*c)) for c in cases]))`);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim()), [false, true, true, true, false, false, true, false, true]);
});

test("weights_state / weights_problem: 必須の重みが無ければ置き場つきで止める。任意の重みは無くても通る。sha256 不一致は止める", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "dp-home-"));
  try {
    const run = (extraCfg = "") => py(HEAD(extraCfg) + PY_PREP + `
st = weights_state()
print(json.dumps({'problem': weights_problem(st), 'dx': st['dx']['exists'], 'teeth': st['teeth']['exists']}))`, undefined, { HOME: home, USERPROFILE: home });
    let r = run();
    assert.equal(r.status, 0, r.stderr);
    let out = JSON.parse(r.stdout.trim());
    assert.match(out.problem, /^missing-weights: .*t\.pt.*vis-dental-pano/);
    const dir = path.join(home, ".graphy-next", "models", "vis-dental-pano");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "t.pt"), "abc");
    out = JSON.parse(run().stdout.trim());
    assert.equal(out.problem, null, "任意の dx が無くても通る");
    assert.equal(out.dx, false);
    // 固定した sha256 が違えば止める
    out = JSON.parse(run("GRAPHY['weights']['teeth']['sha256'] = '0' * 64").stdout.trim());
    assert.match(out.problem, /^bad-weights: /);
    // 一致すれば通る（abc の sha256）
    out = JSON.parse(run("GRAPHY['weights']['teeth']['sha256'] = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'").stdout.trim());
    assert.equal(out.problem, null);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function withNpz(meta, rows, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dp-"));
  try {
    fs.mkdirSync(path.join(dir, "inputs"));
    const make = py(`
import json, numpy as np
rows = json.loads(${JSON.stringify(JSON.stringify(rows))})
meta = ${JSON.stringify(JSON.stringify(meta))}
np.savez('inputs/0.npz', volume=np.array([rows], dtype=np.float32), **{'meta.json': np.frombuffer(meta.encode(), dtype=np.uint8)})
`, dir);
    assert.equal(make.status, 0, make.stderr);
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("load_image: PX を窓で 8bit にする。MONOCHROME1 は反転。CT・多フレーム・定数画像は理由つきで止める", () => {
  const rows = [[0, 100, 200, 400], [400, 200, 100, 0]];
  const load = (meta, dir) => py(HEAD() + PY_PREP + `
g, info = load_image('inputs/0.npz')
print(json.dumps({'g': g.tolist(), 'info': info}))`, dir);
  withNpz({ modality: "PX", windowCenter: [200], windowWidth: [400], voiLutFunction: "LINEAR", photometricInterpretation: "MONOCHROME2" }, rows, (dir) => {
    const r = load(null, dir);
    assert.equal(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout.trim());
    assert.equal(o.info.window, "dicom");
    assert.equal(o.g[0][0], 0);
    assert.equal(o.g[0][3], 255);
    assert.ok(o.g[0][1] < o.g[0][2]);
  });
  withNpz({ modality: "DX", photometricInterpretation: "MONOCHROME1" }, rows, (dir) => {
    const o = JSON.parse(load(null, dir).stdout.trim());
    assert.equal(o.info.window, "minmax");
    assert.equal(o.g[0][0], 255, "MONOCHROME1 は反転");
    assert.equal(o.g[0][3], 0);
  });
  withNpz({ modality: "CT" }, rows, (dir) => {
    const r = load(null, dir);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /not-applicable: パノラマ X 線/);
  });
  withNpz({ modality: "PX" }, [[5, 5], [5, 5]], (dir) => {
    assert.match(load(null, dir).stderr, /not-applicable: 画素値が一定/);
  });
});

// ---------------------------------------------------------------------------
// 画面の往復（jsdom + 偽の host）。既定のまま通す経路を含む。
// ---------------------------------------------------------------------------

function fakeHost(w, opts = {}) {
  const calls = { notify: [], createRoi: [], removeCreatedRoi: [], selectRoi: [], sr: [], saveAs: [], publish: [], jobs: [] };
  const raw = opts.raw ?? {
    rows: 1000, cols: 2000, device: "cpu", seconds: 3.4, model: "teeth=t.pt@abc12345 dx=d.pt@def45678",
    teeth: [tooth(16, 100), tooth(17, 130), tooth(46, 100, 0.8, 300)],
    dx: [{ cls: "caries", conf: 0.8, bbox: [101, 2, 108, 10] }, { cls: "periapical", conf: 0.6, bbox: [102, 301, 108, 330] }],
  };
  const env = opts.env ?? { python: "/venv/bin/python", pyVersion: "3.13.0", installed: { ultralytics: "8.4.1", torch: "2.5", numpy: "2", pillow: "11" }, need: { ultralytics: null, torch: null, numpy: null, pillow: null }, problem: null, weights: {}, weightsDir: "/h/.graphy-next/models/vis-dental-pano" };
  let probeCount = 0;
  const files = (obj) => ({ ok: true, status: "ok", readFile: async (n) => new TextEncoder().encode(JSON.stringify(obj)) });
  const host = {
    locale: opts.locale ?? "ja-JP",
    getTargets: () => opts.targets ?? [{ kind: "image", tileId: "t0", modality: "PX", sliceCount: 1, studyUid: "1.1", seriesUid: "1.2", seriesLabel: "PANO", sopInstanceUid: "1.2.3" }],
    notify: (m) => calls.notify.push(m),
    openWindow: () => { const c = w.document.createElement("div"); w.document.body.append(c); return { container: c, close() {}, onClose() {}, closed: false }; },
    compute: {
      runJob: async (req) => {
        calls.jobs.push({ endpointId: req.endpointId, inputs: req.inputs.length });
        if (req.inputs.length === 0) { probeCount++; return files(typeof env === "function" ? env(probeCount) : env); }
        return opts.jobResult ?? files(raw);
      },
    },
    createRoi: (t, req) => { calls.createRoi.push(req); return { ok: true, roiUid: "roi-" + calls.createRoi.length, centerLps: [0, 0, 0] }; },
    removeCreatedRoi: (u) => { calls.removeCreatedRoi.push(u); return true; },
    selectRoi: (t, u) => calls.selectRoi.push(u),
    saveStructuredReport: async (t, req) => { calls.sr.push(req); return { ok: true }; },
    file: { saveAs: async (o) => { calls.saveAs.push(o); return { ok: true, filePath: "/x.csv" }; } },
    publishAnalysisResult: (t, i) => { calls.publish.push(i); return { ok: true }; },
  };
  return { host, calls };
}

const tick = () => new Promise((r) => setTimeout(r, 20));
async function until(fn, n = 100) { for (let i = 0; i < n; i++) { if (fn()) return; await tick(); } throw new Error("timeout"); }

function mount(opts) {
  const w = dom();
  Object.defineProperty(globalThis, "document", { value: w.document, configurable: true });
  Object.defineProperty(globalThis, "window", { value: w, configurable: true });
  Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
  const f = fakeHost(w, opts);
  return { w, ...f };
}
const q = (w, id) => w.document.querySelector(`[data-testid="${id}"]`);

test("画面（既定のまま）: 開く → 実行 → チャート・輪郭・レポート。送るのは local だけ。診断の歯番が出る", async () => {
  const { w, host, calls } = mount();
  await activate(host);
  assert.ok(q(w, "dp-disclaimer").textContent.includes("研究用の下書き"));
  assert.ok(q(w, "dp-result").style.display !== "flex");
  q(w, "dp-run").click();
  await until(() => q(w, "dp-result").style.display === "flex");
  assert.deepEqual(calls.jobs.map((j) => j.endpointId), ["local", "local"], "事前チェックと本処理の両方が local");
  assert.equal(calls.jobs[0].inputs, 0);
  assert.equal(calls.jobs[1].inputs, 1);
  assert.equal(w.document.querySelectorAll('[data-state="detected"]').length, 3);
  assert.equal(w.document.querySelectorAll('[data-state="missing"]').length, 29);
  assert.equal(w.document.querySelector('[data-testid="fdi-16"]').dataset.dx, "caries");
  assert.equal(w.document.querySelector('[data-testid="fdi-46"]').dataset.dx, "periapical");
  assert.match(q(w, "dp-report").value, /う蝕の候補がある歯: 16/);
  assert.match(q(w, "dp-report").value, /根尖病変の候補がある歯: 46/);
  // 既定で歯の輪郭と診断の枠が置かれる（3 本 + 2 診断）
  assert.equal(calls.createRoi.length, 5);
  assert.deepEqual(calls.createRoi.map((c) => c.label).slice(0, 3), ["FDI 17", "FDI 16", "FDI 46"], "歯は上顎 18→28、下顎 48→38 の並びで置く");
  assert.equal(q(w, "dp-show-teeth").checked, true);
  assert.equal(q(w, "dp-show-dx").checked, true);
  assert.equal(window.__dentalPanoState.phase, "done");
});

test("画面: 歯をクリックでその ROI を選ぶ。輪郭のチェックを外すと本体の ROI を消す。保存系が本体の API へ渡る", async () => {
  const { w, host, calls } = mount();
  await activate(host);
  q(w, "dp-run").click();
  await until(() => q(w, "dp-result").style.display === "flex");
  q(w, "fdi-17").dispatchEvent(new w.Event("click"));
  const uid17 = "roi-" + (calls.createRoi.findIndex((c) => c.label === "FDI 17") + 1);
  assert.deepEqual(calls.selectRoi, [uid17], "押した歯の ROI を選ぶ（隣の歯ではない）");
  q(w, "dp-show-teeth").checked = false;
  q(w, "dp-show-teeth").dispatchEvent(new w.Event("change"));
  assert.ok(calls.removeCreatedRoi.length >= 5, "いったん全部消してから、残すものだけを置き直す");
  q(w, "dp-save-sr").click();
  await until(() => calls.sr.length === 1);
  assert.deepEqual(calls.sr[0].groups, []);
  q(w, "dp-save-csv").click();
  await until(() => calls.saveAs.length === 1);
  assert.equal(calls.saveAs[0].defaultName, "dental-pano.csv");
  assert.ok(new TextDecoder().decode(calls.saveAs[0].bytes).includes("tooth,16"));
  q(w, "dp-publish").click();
  assert.equal(calls.publish.length, 1);
  assert.ok(calls.publish[0].caveats.length >= 1);
});

test("画面（負例）: 環境が足りなければ導入コマンドと［再確認］を出し、実行を送らない。入れて再確認すると通る", async () => {
  const bad = { python: "/usr/bin/python3", pyVersion: "3.12.0", installed: { ultralytics: null, torch: null, numpy: "2", pillow: "11" }, need: { ultralytics: null, torch: null, numpy: null, pillow: null }, problem: "missing-packages: x", weights: { teeth: { file: "teeth-seg.pt", exists: false, required: true } }, weightsDir: "/h/.graphy-next/models/vis-dental-pano" };
  const good = { ...bad, installed: { ultralytics: "8", torch: "2", numpy: "2", pillow: "11" }, problem: null, weights: {} };
  const { w, host, calls } = mount({ env: (n) => (n === 1 ? bad : good) });
  await activate(host);
  q(w, "dp-run").click();
  await until(() => q(w, "dp-env").style.display === "flex");
  assert.equal(calls.jobs.length, 1, "本処理は送っていない");
  assert.equal(q(w, "dp-env-command").value, "/usr/bin/python3 -m pip install ultralytics torch");
  assert.match(q(w, "dp-env-python").textContent, /\/usr\/bin\/python3/);
  assert.match(q(w, "dp-env").textContent, /teeth-seg\.pt/);
  assert.ok(q(w, "dp-result").style.display !== "flex");
  q(w, "dp-env-recheck").click();
  await until(() => q(w, "dp-env").style.display === "none");
  q(w, "dp-run").click();
  await until(() => q(w, "dp-result").style.display === "flex");
  assert.equal(calls.jobs.length, 3);
});

test("画面（負例）: CT のタイルでは開かず通知する。計算機の失敗は理由を出して結果を出さない", async () => {
  const ct = mount({ targets: [{ kind: "image", tileId: "t0", modality: "CT", sliceCount: 1, seriesLabel: "CT" }] });
  await activate(ct.host);
  assert.equal(ct.calls.notify.length, 1);
  assert.match(ct.calls.notify[0], /PX \/ DX \/ CR/);
  const ng = mount({ jobResult: { ok: true, status: "error", errorName: "RuntimeError", errorValue: "missing-weights: 重み teeth-seg.pt がありません。/h に置いてください", readFile: async () => null } });
  await activate(ng.host);
  q(ng.w, "dp-run").click();
  await until(() => /重み teeth-seg\.pt/.test(q(ng.w, "dp-status").textContent));
  assert.ok(q(ng.w, "dp-result").style.display !== "flex");
  assert.equal(ng.calls.createRoi.length, 0);
});

test("画面: 診断モデルが無い結果（dx: null）は歯と欠損だけを出し、診断の枠は置かない。英語ロケール", async () => {
  const { w, host, calls } = mount({ locale: "en-US", raw: { rows: 10, cols: 10, device: "cpu", seconds: 1, model: "m", teeth: [tooth(11, 0)], dx: null } });
  await activate(host);
  q(w, "dp-run").click();
  await until(() => q(w, "dp-result").style.display === "flex");
  assert.ok(q(w, "dp-no-dx"));
  assert.equal(q(w, "dp-show-dx").disabled, true);
  assert.equal(calls.createRoi.length, 1);
  assert.match(q(w, "dp-report").value, /No diagnosis model was used/);
  assert.match(q(w, "dp-disclaimer").textContent, /Research draft only/);
});

test("explain / failureText", () => {
  assert.match(explain("dataset-local-only"), /この PC/);
  assert.equal(explain("zzz"), "zzz");
  assert.equal(failureText("missing-weights: 置いてください"), "置いてください");
  assert.match(failureText("Boom: x"), /失敗/);
});

test("diagnosisByClass: 種類ごとに歯番号を昇順でまとめる。歯に割り当たらないものは件数だけ", () => {
  const res = normalizeResult({ teeth: [tooth(46, 0), tooth(16, 40)], dx: [{ cls: "caries", conf: 0.8, bbox: [1, 1, 5, 5] }, { cls: "caries", conf: 0.8, bbox: [41, 1, 45, 5] }, { cls: "caries", conf: 0.5, bbox: [900, 1, 905, 5] }] });
  assert.deepEqual(diagnosisByClass(res), [{ key: "caries", teeth: [16, 46], unassigned: 1, count: 3 }]);
});

test("PY の本処理は ultralytics の API を想定どおりに呼ぶ（呼び出しの形の静的確認）", () => {
  assert.match(PY, /retina_masks=True/);
  assert.match(PY, /r\.masks\.xy/);
  assert.match(PY, /kernel image/);
  assert.match(PY, /cuDNN\|CUDNN/);
  assert.match(PY, /unable to find an engine/);
  assert.match(PY, /cuda_usable\(torch\)/);
  assert.match(PY_PROBE, /weights_state\(\)/);
});
