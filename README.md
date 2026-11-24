# graphy-next-plugin-dental-pano（試作）

**研究・教育用（Research Use Only）。診断機器ではありません。診断・治療の判断に使わないでください。**
試作です。結果は誤りを含みます。ライセンスは AGPL-3.0（重みは下の「ライセンスと帰属」を必ず読んでください）。

パノラマ X 線 1 枚（PX / DX / CR）から、歯の検出（FDI 番号）・診断の候補・欠損歯・歯式チャート・構造化レポートを作る
[GRAPHY-Next](https://github.com/tatsunidas/GRAPHY-Next) のプラグイン（`id: vis-dental-pano`、`engines.graphy >=0.6.3`）。計算はこの PC の計算機（Python）だけで行い、画像は外へ出ない。

## 導入

導入は 4 段です。**(1) プラグイン本体 → (2) この PC の計算機（Python）→ (3) モデルの重み → (4) 実行**。(2) と (3) は、プラグインを入れただけでは入りません（下の「なぜ手で入れるのか」）。初回だけ 20〜30 分ほど見てください（重みの取得と、`torch` の導入に時間がかかります）。

### 0. 用意するもの

| 必要なもの | 内容 |
|---|---|
| GRAPHY-Next 本体 | **v0.6.3 以降**（このプラグインが要る機能が入った版）。動作確認は v0.6.6（Linux の AppImage）。v0.6.5 以前では、置いた輪郭の脇に面積などの文字が重なって出ます（mm² は信用できません）。**最新版をお勧めします** |
| Python | この PC に入っている Python 3（動作確認は 3.13.5。ほかの版は未確認）。専用の仮想環境を作ってもよい |
| ディスクの空き | 重み 約 170 MB（125 MB ＋ 44 MB）。`torch` などの Python パッケージの分が、別に要ります（容量は環境しだいで、未計測） |
| 画像 | パノラマ X 線 1 枚（Modality が PX・DX・CR）。**画素間隔（PixelSpacing など）が無い画像には、輪郭を置けません**（歯式チャートとレポートは出ます） |
| GPU | 無くても動く（CPU のみ）。ある場合の注意は「手順 2」の最後に |

### 1. プラグイン本体を入れる

1. GRAPHY-Next を起動し、画面右上の Settings（環境設定）を開いて、左の一覧から **Plugins（プラグイン）** を選びます。
2. **Allow installing plugins** にチェックを入れます。**既定では、プラグインの導入は許可されていません。** 導入したプラグインは、本体と同じ権限で動くので、署名を確かめられる出所だけを入れてください。
3. **URL / ZIP** のタブを開き、欄に次を入れて **Install from GitHub** を押します。

   ```
   tatsunidas/graphy-next-plugin-dental-pano
   ```

   版を決めたいときは、右の「version (optional)」に版を入れます（空のままなら、版は指定しません）。
4. 導入できたら、**Installed** のタブを開き、このプラグイン（Dental Panoramic Chart (prototype)）の行の信頼の欄が **verified** になっていることを確かめます。verified は、公式の鍵で署名を確かめられた、という意味です。verified でないときは、**使わずに**、導入元（上の `owner/repo`）が正しいかを確かめてください。
5. メニューに反映するため、本体を**再読み込み（または再起動）**します。

> **インターネットにつながらない PC（オフライン）の場合**: Release から `vis-dental-pano-0.1.0.zip` と `vis-dental-pano-0.1.0.zip.minisig` を取得し、**Install from zip** で zip を選びます。署名つきで入れ直すときは、同じ画面で、対応する `.minisig` のファイルも選びます。

### 2. この PC の計算機（Python）を用意する

このプラグインの計算は、**この PC の中の Python だけ**で行います。画像は外へ出ません。

1. Settings の **Compute (This PC / External)**（計算機）で、この PC の計算機を使えるようにし、使う Python を指定します。その Python には、`jupyter_server` と `ipykernel` が要ります。入っていないときは、実行時に「この PC の計算機を使えません（Python・jupyter_server・ipykernel が揃っていません）」と出ます。そのときは、次を実行します（`<python>` は指定した Python のパス）。

   ```
   <python> -m pip install jupyter_server ipykernel
   ```

2. パノラマ X 線を 2D ビューアで開き、**Analysis** メニューからこのプラグインを開いて、**［Run］**を押します（手順 4 の最初の部分です）。
3. 足りないパッケージがあれば、画像を送らない**事前チェック**が、次の 3 つを出して止まります。
   - 使われる Python のパスと版
   - 足りないパッケージの一覧（`ultralytics==8.4.208`・`torch`・`numpy`・`pillow`。版が決まっているのは ultralytics だけ）
   - **その Python を名指しした導入コマンド**と、［Copy command］・［Re-check］のボタン
4. ［Copy command］で導入コマンドをコピーし、**ターミナル（Windows は PowerShell かコマンドプロンプト）**で実行します。例（パスは自分の環境のものになります）:

   ```
   /path/to/python3 -m pip install ultralytics==8.4.208 torch numpy pillow
   ```

   パスに空白があって引用符で囲まれているときは、PowerShell では先頭に `&` を付けます。**このプラグインは、環境を勝手には書き換えません。入れるのは利用者です。**
5. 入れ終わったら、**［Re-check］（再確認）**を押します。**本体の再起動は要りません。** 全部そろえば、事前チェックの表は消えます。

> **GPU（CUDA）を使いたい場合**: 上のコマンドで入る `torch` は、環境によっては CPU 用です。GPU を使うときは、`torch` だけを、PyTorch の公式（pytorch.org）の案内どおりに入れてください。GPU で失敗したときは、自動で CPU でやり直します。
> **旧世代の GPU（Pascal など。GTX 10 シリーズ）**: torch 2.15 の既定のビルド（CUDA 13）には、この GPU 用の計算部品がありません。「CUDA は使える」と返るのに動きません。プラグインはこれを見抜いて CPU に切り替えますが、GPU で動かすなら、torch の cu126 ビルドと `nvidia-cudnn-cu12==9.10.2.21` が要ります（GTX 1050 Ti で確認）。**CPU だけの環境は、依存を入れたあとの確認が未了です。**

### 3. モデルの重みを置く

**重みはプラグインに入っていません。** 導入しても自動では入らないので、自分で取得して、決まったフォルダに置きます。

1. [Releases](https://github.com/tatsunidas/graphy-next-plugin-dental-pano/releases) のページを開き、次の 2 つをダウンロードします。

   | ファイル | 役割 | 大きさ | 必須か |
   |---|---|---|---|
   | `teeth-seg.pt` | 歯の検出（FDI 番号）と輪郭 | 125,015,124 B（約 125 MB） | **必須** |
   | `dx-det.pt` | 診断の候補（う蝕・深在性う蝕・根尖病変・埋伏歯） | 44,112,409 B（約 44 MB） | 任意 |

   `dx-det.pt` を置かなければ、診断の候補は出さず、歯と「検出されなかった歯」だけを出します。
2. 次のフォルダに置きます。**プラグインの導入先ではなく、自分のホームフォルダの下です。**

   | OS | 置き場所 |
   |---|---|
   | Linux・macOS | `~/.graphy-next/models/vis-dental-pano/` |
   | Windows | `%USERPROFILE%\.graphy-next\models\vis-dental-pano\` |

   フォルダが無ければ作ります。

   ```bash
   # Linux・macOS
   mkdir -p ~/.graphy-next/models/vis-dental-pano
   mv ~/Downloads/teeth-seg.pt ~/Downloads/dx-det.pt ~/.graphy-next/models/vis-dental-pano/
   ```

   ```powershell
   # Windows（PowerShell）
   New-Item -ItemType Directory -Force "$env:USERPROFILE\.graphy-next\models\vis-dental-pano"
   Move-Item "$env:USERPROFILE\Downloads\teeth-seg.pt","$env:USERPROFILE\Downloads\dx-det.pt" "$env:USERPROFILE\.graphy-next\models\vis-dental-pano\"
   ```
3. **（任意）ファイルが壊れていないか確かめる。** プラグインは実行のたびに、重みの SHA-256（ファイルの指紋）を、固定した値と照合します。置く前に自分で確かめたいときは、次の値と比べます（Release の `SHA256SUMS` にも同じ値があります）。

   | ファイル | SHA-256 |
   |---|---|
   | `teeth-seg.pt` | `75dd697a133d1cf9474228e3ca2e5993722334ceffa4a68f23064bd6eb1a16d7` |
   | `dx-det.pt` | `62a498a7c000a5462bf716d7b854bb3c5812d7dae8d173bc4a64309e12f4f4e8` |

   ```bash
   sha256sum ~/.graphy-next/models/vis-dental-pano/*.pt          # Linux
   shasum -a 256 ~/.graphy-next/models/vis-dental-pano/*.pt      # macOS
   ```
   ```powershell
   Get-FileHash "$env:USERPROFILE\.graphy-next\models\vis-dental-pano\*.pt" -Algorithm SHA256   # Windows
   ```
4. 置いたら、プラグインの画面で **［Re-check］** を押します。本体の再起動は要りません。

**重みは、下の「ライセンスと帰属」の条件で配布しています。必ず読んでください**（研究・教育用の範囲で使うこと）。

#### なぜ手で入れるのか

- 重みには**ライセンスと帰属の条件**があり、研究・教育用として別に配布しているからです。
- 重みの `.pt` ファイルは、読み込むときにプログラムが動くことがあります（pickle を含む）。そのため、**このリポジトリの Release の決まった版（SHA-256 が一致するもの）しか動かさない**作りにしてあります。**Release 以外から得た重みを、検査せずに置かないでください。**

### 4. 実行する

1. パノラマ X 線（PX / DX / CR の 1 枚）を 2D ビューアで開きます。
2. **Analysis** メニューから、このプラグイン（Dental Panoramic Chart (prototype)）を開き、**［Run］（実行）**を押します。
3. 実行のたびに**同意画面**が出ます。何をどこへ渡すのか（この PC の計算機。画像は外へ出ない）と、実行されるコードを確かめてから進みます。
4. 結果が出ます。歯式チャート（FDI）、画像の上の歯の輪郭と診断の枠、診断の候補の表、レポート（下書き）です。DICOM SR・CSV での保存と、本体のレポート画面への登録もできます。

1 枚あたり、GPU（GTX 1050 Ti 4 GB）で約 5 秒でした。CPU だけの所要時間は未計測です。

### うまくいかないとき

| 画面の表示（日本語 ‖ English のうち、画面の言語のほう） | 原因と直し方 |
|---|---|
| 「重み `teeth-seg.pt` がありません。（フォルダ）に置いてください」（`missing-weights`） | 重みが無い、またはフォルダが違います。表示されたフォルダに置きます。`dx-det.pt` は任意なので、無くても実行できます |
| 「内容が固定した版と違います（sha256 不一致）。置き直してください」（`bad-weights`） | ファイルが壊れているか、別のファイルです。Release から取り直して置き直します。**ほかの場所から得た重みは使えません** |
| 「Something is missing. Install it as shown below, then press Re-check.」 | パッケージが足りません。表示された導入コマンドを、**表示された Python で**実行し、［Re-check］を押します |
| 「この PC の計算機を使えません（Python・jupyter_server・ipykernel が揃っていません）」（`local-unavailable`） | 手順 2 の 1 を実行します |
| 「このプラグインに計算機を使う許可がありません」（`permission-denied`） | プラグインの権限の問題です。直し方は未確認です（Issue に知らせてください） |
| 輪郭が置けず、理由が出る（`no-geometry`） | 画素間隔の無い画像です。歯式チャートとレポートは出ます |
| プラグインがメニュー（Analysis）に出ない | 本体を再読み込み（または再起動）します。それでも出なければ、本体が v0.6.3 以降か確かめます |
| 「画像が大きすぎます」（`npz-too-large`） | 画像が大きすぎて、計算機へ渡せません。小さい画像で試してください |

### 更新・削除

- 更新: 新しい版を、手順 1 の画面から入れ直します（更新の細かい動きは未確認です）。**重みはプラグインの外（ホームフォルダ）にあるので、プラグインを入れ替えても残る設計です**。重みが見つからないと出たら、手順 3 を確かめてください。
- 削除: Settings の Plugins の **Installed** から外します。重みは自動では消えないので、不要なら `~/.graphy-next/models/vis-dental-pano/` を自分で削除します。

## 着想と、論文との違い

Baseri Saadi S, Sola Gracea R, Ver Berne J, Claes P, Jacobs R. *Panognostics-Plus: An Integrated Multi-Task AI Framework for Automated
Panoramic Radiograph Interpretation with Dental Charting and Structured Reporting.* J Imaging Inform Med 2026.
doi:10.1007/s10278-026-02479-w（CC BY 4.0）。

論文の貢献は個々のモデルではなく、**検出 → 歯式への割り当て → 歯式チャート → 構造化レポート**の統合。このプラグインはその流れを再現する。
論文のモデル・コード・重みは公開されていないので、**論文の数値は再現していない**。

| | 論文 | このプラグイン（V1 試作） |
|---|---|---|
| 対象 | 歯・歯槽骨頂・上顎洞底／インプラント・ブリッジ・根管・クラウン・充填／歯根嚢胞・根尖肉芽腫 | 歯（永久歯 32 本・FDI）。診断の候補 4 種（う蝕・深在性う蝕・根尖病変・埋伏歯）。治療 5 種・上顎洞底・歯槽骨頂は公開データが見つからず対象外 |
| 構成 | 項目ごとに 検出 → ROI → セグメンテーションの 2 段 | 1 段（歯はインスタンスセグメンテーション、診断は検出） |
| 割り当て | 治療の枠と歯の枠の重なり最大 | 診断の枠と歯の枠の重なり最大（同じ考え方）。重なり 0 は「歯を特定できず」 |
| 出力 | オーバーレイ・歯式チャート・Word レポート | 画像への輪郭（ROI）・歯式チャート（SVG）・テキスト・DICOM SR・CSV・レポート画面への登録。Word は未対応 |
| 評価 | 1,595 枚・5 分割 CV・独立テスト 20% | 公開データ DENTEX の中の分割（下の「現在の状態」）。データ・分割が違うので直接比較しない |

## 現在の状態（2026-11-22 時点）

test は学習にも重みの選択にも使っていない分割。**同じ DENTEX の中の分割で、外部施設・他機種での検証ではない**。学習・評価のコードは別のリポジトリ（非公開）にあり、ここには数値の要約だけを載せる。

| 部分 | 状態 |
|---|---|
| 歯の検出・FDI・輪郭 | 動く。重みは Kölüş & Güleç 2025 の YOLO11x-seg を DENTEX の歯 444 枚で fine-tune したもの（バックボーン凍結・左右反転なし、60 epoch の予定のうち epoch 21 で中断した途中の重みから、val 最良の epoch 12 を採用）。test 127 枚: IoU 0.8 の F1 **0.576**（元の重みは 0.100）、IoU 0.5 の F1 0.946、位置の合った歯の番号の正答率 96.6% |
| 診断 4 クラス | 動く（重み `dx-det.pt` があるとき。無ければ従来どおり診断の候補を出さず歯と欠損歯だけ）。yolo26m を DENTEX の診断 494 枚で学習。test 141 枚: IoU 0.8 の F1 0.460（95% CI 0.424–0.494）、mAP50-95 0.366。**埋伏歯は強い（IoU 0.5 で F1 0.86）が、根尖病変は test に 25 箱しかなく F1 0.2〜0.26 で信頼できない**。DENTEX の診断の注釈は**歯単位の枠**（病変の位置ではない）で、診断の無い歯は「注釈が無い」だけで健常とは限らない（precision は実際より低く出ている可能性がある） |
| 歯式チャート・レポート・CSV・SR・レポート画面への登録 | 動く |
| 実アプリでの検証 | 本体の dev ビルド（Electron・専用ポート・jar 再ビルド）で、DENTEX の test の PX 1 枚（8 bit、画素間隔は合成の 0.1 mm）に対し、診断の重みあり 33 件・なし 23 件・負例（固定と違う歯の重み 8 件・重みなし 8 件・画素間隔なし 17 件）が合格。診断ありの結果は、同じ重みを本体を通さず直接動かした結果と、歯 32 本・診断 8 件とも件数・番号・クラス・枠（3 px 以内）が一致。参照を改ざんすると、狙った 2 項目だけが落ちる（負例）。画面も目で確認。依存なし→導入→再確認（27 件）は今回は再実行していない（前回は合格） |
| 未検証 | 実機の（患者由来の）PX の DICOM、外部施設・他機種の画像、Windows・macOS、別の DICOM ビューアでの SR の見え方、**依存を入れたあとの CPU のみの環境**、60 epoch まで回した歯の重み |

文書: [`docs/technical-note.docx`](docs/technical-note.docx)（テクニカルノート。論文形式で、統合の設計・評価・制限事項・再現性。PDF は [`docs/technical-note-v0.1.0.pdf`](docs/technical-note-v0.1.0.pdf)）。

## できること

- 歯式チャート（FDI 18…11｜21…28 / 48…41｜31…38）。検出されなかった歯は破線、診断の候補は色付きの印。歯を押すと画像上のその歯の ROI を選ぶ
- 画像への重ね表示: 歯の輪郭（多角形 ROI、64 点以下）と診断の枠。チェックで出し入れ。ウィンドウを閉じると、このプラグインが置いた ROI は消える
- レポート（下書き）、DICOM SR（所見のみ）、CSV、本体のレポート画面への登録
- 診断モデルが無ければ、診断の候補は出さず歯と欠損だけを出す（診断の重みは任意）
- **各機能に tooltip**（ボタン・チェック・チャートのマス・診断の色の印・凡例・診断の行・見出し）。使いかたと意味を、本体の言語（日本語・英語）で補足する。マスには、検出なら FDI・信頼度・診断の候補、未検出なら「欠損・補綴・未萌出・乳歯・検出漏れを区別できない」旨が出る。診断の種類の説明は DENTEX の定義の範囲に抑え、**枠は歯単位で病変の位置ではない**ことを添える
- 計算機（Python）が返す失敗理由は「日本語 ‖ English」の 1 文字列で、画面の言語の側だけを出す

## できないこと・注意

- 「検出されなかった永久歯」は、**欠損・補綴（インプラント・ブリッジ）・未萌出・乳歯・検出漏れを区別できない**。乳歯・混合歯列は対象外
- 面積・距離は出さない。パノラマの拡大率は位置で変わり、mm に直せない（SR も所見のみで、計測値を入れない）。このプラグインが置いた ROI には、本体が面積・平均値の文字を出さない（`createRoi` の `showStats: false`。本体 v0.6.5 より後の版のみ。v0.6.5 以前の本体では出るが、**パノラマの mm² は信用できないので参考にしない**。ROI のテキストは本体の［Text］で隠せる）
- 部位は判定しない。パノラマ以外の X 線でも実行はできるが、結果は無意味
- 外部の施設での検証はしていない。臨床の判断に使わない

## 画像の条件

- Modality は PX・DX・CR の 1 枚。PX・IO は本体で「焼き込みの危険な種類」（外部の計算機へは送らない、この PC の計算機だけ）。本体 v0.6.3 で追加（**v0.6.3 以降の本体が要る**）
- **画素間隔（PixelSpacing など）の無い画像には、本体が ROI を置けない**（`no-geometry`）。その場合も歯式チャートとレポートは出し、理由を画面に出す
- `BurnedInAnnotation=YES` と宣言された画像は、マスクを登録しないと本体が計算機へ渡さない（local でも）。機器によっては宣言される

## 計算機の環境（初回）

実行の前に、画像を送らない事前チェックで、この PC の計算機の Python に足りないものを調べる。足りなければ、**使われる Python を名指しした** `pip install` コマンドと
［再確認］を出す（環境は書き換えない。入れるのは利用者。本体の再起動は要らない）。

- パッケージ: `ultralytics`・`torch`・`numpy`・`pillow`
- 重み（同梱しない）: `~/.graphy-next/models/vis-dental-pano/` に `teeth-seg.pt`（必須。125,015,124 B）、`dx-det.pt`（任意。44,112,409 B）。`ui.js` の `WEIGHTS` に sha256 を固定してあり、内容が違えば止める。入手はこのリポジトリの Release（`SHA256SUMS` つき）。sha256: 歯 `75dd697a133d1cf9474228e3ca2e5993722334ceffa4a68f23064bd6eb1a16d7`、診断 `62a498a7c000a5462bf716d7b854bb3c5812d7dae8d173bc4a64309e12f4f4e8`
- 1 枚あたり: GPU（GTX 1050 Ti 4 GB）で約 5 秒。GPU で失敗したら CPU でやり直す（メモリ不足・torch に GPU 用のカーネルが無い・cuDNN が古い GPU に非対応のとき）
- **旧世代の GPU（Pascal など）の注意**: torch 2.15 の既定ビルド（CUDA 13）は Pascal（sm_61）のカーネルを含まず、cuDNN 9.11 以降も SM 7.5 未満に非対応。CUDA は「使える」と返るのに動かない。プラグインは `cuda_usable` で判定して CPU に退避するが、GPU で動かすなら torch の cu126 ビルド＋ `nvidia-cudnn-cu12==9.10.2.21` が要る（2026-11-09 に GTX 1050 Ti で確認）

## ライセンスと帰属

**プラグインのコード**: [AGPL-3.0](LICENSE)（Copyright (c) 2026 Visionary Imaging Services, Inc.）。実行時に Ultralytics（YOLO、AGPL-3.0）を呼ぶため、同じライセンスにそろえている。改変して配布する、またはネットワーク越しのサービスとして提供する場合は、AGPL-3.0 に従ってソースを公開すること。

**重み（Release の `teeth-seg.pt`・`dx-det.pt`）**: 研究・教育用として配布する。次の条件と帰属を守って使うこと。

- **Ultralytics の YOLO で学習したモデル**（YOLO11x-seg・YOLO26m）。Ultralytics は学習済みの重みにも AGPL-3.0 が及ぶとしている。重みは AGPL-3.0 で配布する。AGPL-3.0 に従えない用途（ソースを公開しない製品への組み込みなど）には、Ultralytics の Enterprise ライセンスが要る。
- **歯の重み `teeth-seg.pt`** は、Kölüş & Güleç 2025 の公開重み（Mendeley Data、CC BY 4.0、doi:10.17632/83k2rtz4bc.1）を、DENTEX の歯の注釈 444 枚で fine-tune した派生物。**元の重みの作者への帰属表示が要る**。
- **診断の重み `dx-det.pt`** は、DENTEX の診断の注釈 494 枚で学習した。
- **学習データ DENTEX**（Hamamci et al., DENTEX Challenge 2023）: 配布元によって表記が食い違う。Zenodo（record 7812323。学習に使ったのはここから取得したもの）は CC BY 4.0、GitHub・Hugging Face は CC BY-NC-SA 4.0。**この食い違いは解消できていないので、重みは非商用（研究・教育）の範囲で使うこと**。商用の利用を考える場合は、DENTEX の権利者に条件を確かめること。
- 重みの `.pt` は pickle を含む。配布している重みは、含まれる参照先が ultralytics・torch・collections・set だけであることを静的に調べてある。**このリポジトリの Release 以外から得た重みを、検査せずに読み込まないこと**（プラグインは sha256 が一致しない重みを止める）。

**着想を得た論文**: Baseri Saadi S, et al. *Panognostics-Plus.* J Imaging Inform Med 2026. doi:10.1007/s10278-026-02479-w（CC BY 4.0）。論文のモデル・コード・重みは使っていない。

**無保証**: 研究用の試作であり、医療機器ではない。外部施設での検証はしていない。出力を診断・治療の判断に使わないこと。

## 開発

```bash
npm ci && npm run verify   # 純関数・チャート・計算機の前半（Python）・画面の往復（jsdom）
```

設計の要点: 計算機の Python は「生の検出」だけを返す（歯: FDI・bbox・輪郭、診断: クラス・bbox）。割り当て・欠損歯・レポート・SR・CSV・チャートは
`ui.js` の純関数で、Python なしで検算できる。SR は所見（findings）だけで作る（本体は計測が空の group を拒否する。画素数の面積を cm2 などに偽って入れない）。

患者情報・検査データ・ローカルパス・トークンはリポジトリに入れない。
