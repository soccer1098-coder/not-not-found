/* ==========================================================
   Not Not Found — Self-Healing Patches
   ----------------------------------------------------------
   ・image01.jpg と最後の imageXX.jpg は「静止スライド」（ノイズなし）
   ・中間の画像だけ、ランダムなパッチ欠損 ＋ ほぼ自然な自己修復
   ・PC: ← / → で前後移動
   ・スマホ/PC: 画面タップでも前後移動
   ========================================================== */

// =========================
// ▶ 調整パネル（ここだけ触ればOK）
// =========================

// 読み込む画像（ゼロ埋めで配置：image01.jpg, image02.jpg, ...）
const IMG_COUNT = 20;            // 実際に置く枚数に合わせて変更

// 表示や時間まわり
const FPS = 60;
const BG_COLOR = 0;              // 背景（0=黒, 255=白）

// パッチ生成テンポ（※1枚目・最終枚には適用されない）
const PATCH_INTERVAL_FRAMES   = 6; // 何フレームごとにパッチ生成するか（小さいほど頻繁）
const PATCHES_MIN_PER_TICK    = 1;  // 1回のタイミングで生成するパッチ数の最小
const PATCHES_MAX_PER_TICK    = 4;  // 1回のタイミングで生成するパッチ数の最大（含む）

// パッチのサイズ（画像ピクセル単位）
const PATCH_MIN = 30;            // 最小辺
const PATCH_MAX = 500;           // 最大辺（大きめにすると大胆に欠損）

// 欠損と修復の所要フレーム
const DECAY_FRAMES   = 15;       // 欠損にかける時間（長いほどゆっくり暗く/崩れる）
const RESTORE_FRAMES = 30;      // 修復にかける時間（長いほどゆっくり戻る）

// 欠損表現の強さ（控えめ設定）
const DECAY_DARKEN_MAX = 25;     // 最大暗化量（0〜255の加算的黒）
const DECAY_NOISE_MAX  = 5;      // ノイズの振れ幅（±）

// 不完全修復の“違和感”コントロール（控えめ）
const REPAIR_JITTER_PX     = 0.4;   // 元画像から貼るときの微小座標ズレ（px）
const REPAIR_SCALE_JITTER  = 0.006; // 0.6%くらいのスケール誤差
const REPAIR_CHROMA_DRIFT  = 0.003; // RGBのわずかな係数ズレ
const REPAIR_SEAM_STRENGTH = 0.04;  // パッチ縫い目の残り具合（0〜0.3）
const REPAIR_UNSHARP       = 0.10;  // 過補正ハロー（0で無効、控えめ）
const REPAIR_BLEND_BIAS    = 0.0;   // アルファに加える微小バイアス

// 自動遷移（不要なら false）
const AUTO_ADVANCE = false;
const AUTO_SECONDS = 60;         // 1枚あたりの目安秒数（AUTO_ADVANCE=true時のみ有効）

// =========================
// ▶ 内部変数（触らない）
// =========================
let originals = [];              // 元画像（読み取り専用）
let workImg   = null;            // 表示用（ここだけ欠損/修復をかける）
let curr      = 0;               // 現在インデックス（0〜IMG_COUNT-1）
let frameLocal= 0;               // その画像での経過フレーム
let patches   = [];              // アクティブなパッチ配列
let fitCache  = null;            // 描画フィット用キャッシュ

// 1枚目・最終枚を「静止スライド」にするための判定
function isStaticIndex(i){
  return i === 0 || i === (IMG_COUNT - 1);
}

// =========================
// ▶ 画像のプリロード（ゼロ埋め固定）
// =========================
function preload(){
  for(let i=1; i<=IMG_COUNT; i++){
    const name = `image${String(i).padStart(2,'0')}.jpg`; // image01.jpg, image02.jpg, ...
    originals.push(loadImage(name));
  }
}

// =========================
// ▶ セットアップ
// =========================
function setup(){
  createCanvas(windowWidth, windowHeight);
  frameRate(FPS);
  pixelDensity(1);
  noSmooth();
  background(BG_COLOR);

  if (originals.length === 0){
    console.error('画像がありません。image01.jpg〜を同フォルダに置いてください。');
    noLoop();
    return;
  }
  prepareFromCurrent();
}

// =========================
// ▶ メインループ
// =========================
function draw(){
  // 画像がまだ準備できていないときは何もしない（真っ黒防止）
  if (!workImg){
    background(BG_COLOR);
    return;
  }

  background(BG_COLOR);

  const staticSlide = isStaticIndex(curr);

  if (!staticSlide){
    // 中間の写真だけ、パッチ生成＆更新を行う
    if (frameCount % PATCH_INTERVAL_FRAMES === 0){
      const numPatches = int(random(
        PATCHES_MIN_PER_TICK,
        PATCHES_MAX_PER_TICK + 1
      )); // 2〜4個
      for(let n=0; n<numPatches; n++){
        spawnPatch();
      }
    }

    updatePatches();
  } else {
    // タイトル／コンセプトのスライドではパッチをクリアして完全静止
    patches = [];
  }

  // 表示
  drawFit(workImg);

  // 自動遷移（オプション）
  frameLocal++;
  if (AUTO_ADVANCE && frameLocal >= AUTO_SECONDS*FPS){
    gotoNext();
  }
}

// =========================
// ▶ 現在画像を準備（元画像→作業用コピー）
// =========================
function prepareFromCurrent(){
  const src = originals[curr];
  src.loadPixels();

  // 表示用ワーク（ソースのコピー；ここだけ壊す）
  workImg = createImage(src.width, src.height);
  workImg.loadPixels();
  for (let i=0; i<src.pixels.length; i++){
    workImg.pixels[i] = src.pixels[i];
  }
  workImg.updatePixels();

  // パッチ初期化
  patches = [];
  frameLocal = 0;

  // フィット係数を計算
  computeFit(src.width, src.height, width, height);
}

// =========================
// ▶ 画像切り替え（前後）
// =========================
function gotoNext(){
  curr = (curr + 1) % originals.length;
  prepareFromCurrent();
}
function gotoPrev(){
  curr = (curr - 1 + originals.length) % originals.length;
  prepareFromCurrent();
}

// =========================
// ▶ パッチ生成（画像座標系で）
// =========================
function spawnPatch(){
  const w = workImg.width;
  const h = workImg.height;
  const pw = int(random(PATCH_MIN, PATCH_MAX));
  const ph = int(random(PATCH_MIN, PATCH_MAX));
  const x  = int(random(0, max(1, w - pw)));
  const y  = int(random(0, max(1, h - ph)));

  patches.push({
    x, y, w: pw, h: ph,
    t: 0,            // 経過フレーム
    phase: 'decay'   // 'decay' → 'restore'
  });
}

// =========================
// ▶ パッチ更新
// =========================
function updatePatches(){
  for (let i = patches.length - 1; i >= 0; i--){
    const p = patches[i];
    if (p.phase === 'decay'){
      const k = constrain(p.t / DECAY_FRAMES, 0, 1); // 0→1
      decayPatch(workImg, p.x, p.y, p.w, p.h, k);
      p.t++;
      if (p.t >= DECAY_FRAMES){
        p.phase = 'restore';
        p.t = 0;
      }
    } else {
      const k = constrain((p.t / RESTORE_FRAMES) + REPAIR_BLEND_BIAS, 0, 1);
      restorePatchFromOriginal(workImg, originals[curr], p.x, p.y, p.w, p.h, k);
      p.t++;
      if (p.t >= RESTORE_FRAMES){
        patches.splice(i,1);
      }
    }
  }
}

// =========================
// ▶ 欠損処理：少し暗く＋ごく薄いノイズ＋なじませブラー
// =========================
function decayPatch(img, x, y, w, h, k){
  img.loadPixels();
  const W = img.width, H = img.height;

  const dark     = DECAY_DARKEN_MAX * k;
  const noiseAmp = DECAY_NOISE_MAX * k;

  for(let yy=y; yy<y+h; yy++){
    if(yy<0||yy>=H) continue;
    for(let xx=x; xx<x+w; xx++){
      if(xx<0||xx>=W) continue;
      const i = 4*(yy*W + xx);
      // 暗化（やり過ぎない）
      img.pixels[i  ] = max(0, img.pixels[i  ] - dark);
      img.pixels[i+1] = max(0, img.pixels[i+1] - dark);
      img.pixels[i+2] = max(0, img.pixels[i+2] - dark);
      // ごく薄いノイズ（±）
      const n = (Math.random()*2-1) * noiseAmp;
      img.pixels[i  ] = constrain(img.pixels[i  ] + n, 0, 255);
      img.pixels[i+1] = constrain(img.pixels[i+1] + n, 0, 255);
      img.pixels[i+2] = constrain(img.pixels[i+2] + n, 0, 255);
    }
  }
  img.updatePixels();

  // 極薄の“なじませ”ブラー（1px横方向）
  boxBlurRect(img, x, y, w, h, 1);
}

// =========================
// ▶ 修復処理：同一写真の元データから“ほぼ自然に”貼り戻す
// =========================
function restorePatchFromOriginal(dest, src, x, y, w, h, alpha){
  alpha = constrain(alpha, 0, 1);

  // 幾何ズレ＆拡縮誤差（かなり控えめ）
  const jx = (Math.random()*2-1) * REPAIR_JITTER_PX;
  const jy = (Math.random()*2-1) * REPAIR_JITTER_PX;
  const sJ = 1.0 + (Math.random()*2-1) * REPAIR_SCALE_JITTER;

  // ソース矩形（元画像の座標）
  const sx = int(x + jx);
  const sy = int(y + jy);
  const sw = max(1, int(w * sJ));
  const sh = max(1, int(h * sJ));

  // 一旦小キャンバスへ貼る
  const tmp = createImage(w, h);
  tmp.loadPixels();
  src.loadPixels();

  // src → tmp（copy相当）
  for(let yy=0; yy<h; yy++){
    const syy = constrain(sy + int(yy * (sh / h)), 0, src.height-1);
    for(let xx=0; xx<w; xx++){
      const sxx = constrain(sx + int(xx * (sw / w)), 0, src.width-1);
      const si  = 4*(syy*src.width + sxx);
      const di  = 4*(yy*w + xx);
      tmp.pixels[di  ] = src.pixels[si  ];
      tmp.pixels[di+1] = src.pixels[si+1];
      tmp.pixels[di+2] = src.pixels[si+2];
      tmp.pixels[di+3] = 255;
    }
  }

  // 色ドリフト（ほんの少し）
  for(let i=0; i<tmp.pixels.length; i+=4){
    tmp.pixels[i  ] = constrain(tmp.pixels[i  ]*(1+REPAIR_CHROMA_DRIFT*0.6), 0,255);
    tmp.pixels[i+1] = constrain(tmp.pixels[i+1]*(1-REPAIR_CHROMA_DRIFT*0.3), 0,255);
    tmp.pixels[i+2] = constrain(tmp.pixels[i+2]*(1-REPAIR_CHROMA_DRIFT*0.6), 0,255);
  }
  tmp.updatePixels();

  // 過補正ハロー（弱め）
  if (REPAIR_UNSHARP > 0) unsharpOnce(tmp, REPAIR_UNSHARP);

  // 宛先へアルファブレンド
  dest.loadPixels();
  tmp.loadPixels();
  const W = dest.width, H = dest.height;
  for(let yy=0; yy<h; yy++){
    const dy = y + yy; if(dy<0||dy>=H) continue;
    for(let xx=0; xx<w; xx++){
      const dx = x + xx; if(dx<0||dx>=W) continue;
      const di = 4*(dy*W + dx);
      const si = 4*(yy*w + xx);
      dest.pixels[di  ] = dest.pixels[di  ]*(1-alpha) + tmp.pixels[si  ]*alpha;
      dest.pixels[di+1] = dest.pixels[di+1]*(1-alpha) + tmp.pixels[si+1]*alpha;
      dest.pixels[di+2] = dest.pixels[di+2]*(1-alpha) + tmp.pixels[si+2]*alpha;
    }
  }
  dest.updatePixels();

  // 縫い目をほんの少しだけ残す
  if (REPAIR_SEAM_STRENGTH > 0){
    seamFrame(dest, x, y, w, h, REPAIR_SEAM_STRENGTH);
  }

  // なじませ（極薄）
  boxBlurRect(dest, x, y, w, h, 1);
}

// =========================
// ▶ フィット描画（アスペクト維持）
// =========================
function computeFit(iw, ih, cw, ch){
  const s  = Math.min(cw/iw, ch/ih);
  const dw = iw * s;
  const dh = ih * s;
  const ox = (cw - dw)*0.5;
  const oy = (ch - dh)*0.5;
  fitCache = {dw, dh, ox, oy};
}
function drawFit(img){
  if (!img) return;
  if (!fitCache) computeFit(img.width, img.height, width, height);
  const {dw, dh, ox, oy} = fitCache;
  image(img, ox, oy, dw, dh);
}

// =========================
// ▶ ユーティリティ（縫い目・アンシャープ・簡易ブラー）
// =========================
function seamFrame(g, x, y, w, h, k=0.04){
  g.loadPixels();
  const W=g.width, H=g.height;
  const dark=v=>constrain(v*(1-k),0,255);
  const lite=v=>constrain(v*(1+k*0.5),0,255);
  // 上下ライン
  for(let xx=x; xx<x+w; xx++){
    const iTop = 4*(y*W + xx);
    const iBot = 4*((y+h-1)*W + xx);
    if(y>=0 && y<H){
      g.pixels[iTop]   = dark(g.pixels[iTop]);
      g.pixels[iTop+1] = dark(g.pixels[iTop+1]);
      g.pixels[iTop+2] = dark(g.pixels[iTop+2]);
    }
    if(y+h-1>=0 && y+h-1<H){
      g.pixels[iBot]   = lite(g.pixels[iBot]);
      g.pixels[iBot+1] = lite(g.pixels[iBot+1]);
      g.pixels[iBot+2] = lite(g.pixels[iBot+2]);
    }
  }
  // 左右ライン
  for(let yy=y; yy<y+h; yy++){
    const iL = 4*(yy*W + x);
    const iR = 4*(yy*W + (x+w-1));
    if(x>=0 && x<W){
      g.pixels[iL]   = dark(g.pixels[iL]);
      g.pixels[iL+1] = dark(g.pixels[iL+1]);
      g.pixels[iL+2] = dark(g.pixels[iL+2]);
    }
    if(x+w-1>=0 && x+w-1<W){
      g.pixels[iR]   = lite(g.pixels[iR]);
      g.pixels[iR+1] = lite(g.pixels[iR+1]);
      g.pixels[iR+2] = lite(g.pixels[iR+2]);
    }
  }
  g.updatePixels();
}

function unsharpOnce(g, amount=0.1){
  // 横方向だけの簡易アンシャープ（かなり弱め）
  const src = g.get();
  src.loadPixels();
  g.loadPixels();
  const W=g.width, H=g.height;
  const blur = new Uint8ClampedArray(src.pixels.length);

  // 簡易ぼかし（横1px）
  for(let y=0; y<H; y++){
    for(let x=0; x<W; x++){
      let rr=0,gg=0,bb=0,c=0;
      for(let k=-1;k<=1;k++){
        const xx = constrain(x+k,0,W-1);
        const i  = 4*(y*W + xx);
        rr+=src.pixels[i]; gg+=src.pixels[i+1]; bb+=src.pixels[i+2]; c++;
      }
      const o = 4*(y*W + x);
      blur[o  ] = rr/c; blur[o+1] = gg/c; blur[o+2] = bb/c; blur[o+3] = 255;
    }
  }

  // 元 − ぼかし → 足し戻し
  for(let i=0; i<g.pixels.length; i+=4){
    const dR = g.pixels[i  ] - blur[i  ];
    const dG = g.pixels[i+1] - blur[i+1];
    const dB = g.pixels[i+2] - blur[i+2];
    g.pixels[i  ] = constrain(g.pixels[i  ] + dR*amount, 0,255);
    g.pixels[i+1] = constrain(g.pixels[i+1] + dG*amount, 0,255);
    g.pixels[i+2] = constrain(g.pixels[i+2] + dB*amount, 0,255);
  }
  g.updatePixels();
}

function boxBlurRect(g, x, y, w, h, r=1){
  if(r<=0) return;
  g.loadPixels();
  const W=g.width, H=g.height;
  const src = g.pixels.slice();
  for(let yy=y; yy<y+h; yy++){
    if(yy<0||yy>=H) continue;
    for(let xx=x; xx<x+w; xx++){
      if(xx<0||xx>=W) continue;
      let rr=0,gg=0,bb=0,c=0;
      for(let k=-r;k<=r;k++){
        const xxx = constrain(xx+k,0,W-1);
        const ii  = 4*(yy*W + xxx);
        rr+=src[ii]; gg+=src[ii+1]; bb+=src[ii+2]; c++;
      }
      const o = 4*(yy*W + xx);
      g.pixels[o  ] = rr/c;
      g.pixels[o+1] = gg/c;
      g.pixels[o+2] = bb/c;
    }
  }
  g.updatePixels();
}

// =========================
// ▶ 入力（←/→・タップ）＆リサイズ
// =========================
function keyPressed(){
  if (keyCode === RIGHT_ARROW) gotoNext();
  else if (keyCode === LEFT_ARROW) gotoPrev();
}

// PCクリック & スマホタップ両方対応
function mousePressed(){
  // 画面の右半分タップ → 次へ
  // 左半分タップ → 前へ
  if (mouseX > width / 2){
    gotoNext();
  } else {
    gotoPrev();
  }
}

// スマホ用（必要なら）※mousePressedだけでも動くブラウザが多い
function touchStarted(){
  if (touches.length > 0){
    const t = touches[0];
    if (t.x > width / 2){
      gotoNext();
    } else {
      gotoPrev();
    }
  }
  // デフォルト動作（スクロールなど）を止めないために false は返さない
}

function windowResized(){
  resizeCanvas(windowWidth, windowHeight);
  if (workImg){
    computeFit(workImg.width, workImg.height, width, height);
  }
}
