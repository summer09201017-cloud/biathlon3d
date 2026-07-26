// biathlon3d 端到端驗證(Playwright,任務規格 §5):
// ①完整跑完 3 圈含兩次射擊段並衝線出名次(window.__game 後門直接設里程加速)
// ②射擊:屏息時晃動幅度確實變小(讀 sh.offX/offY 數值)、打中靶倒(fallT/變白)、脫靶有罰圈(inPenalty+HUD)
// ③Number.isFinite(camera.position.x)(含選單期)
// ④同一 evaluate 內先 g.update+g.render 再 canvas.toDataURL 非黑圖
// 全程 0 pageerror 才綠;截圖存 <outDir>/。
// 用法:node scripts/verify-biathlon.mjs <url> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [url, outDir] = process.argv.slice(2);
if (!url || !outDir) {
  console.error("用法:node scripts/verify-biathlon.mjs <url> <outDir>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });
const EXE = process.env.CHROME_EXE ||
  "C:/Users/HFP/AppData/Local/ms-playwright/chromium-1223/chrome-win64/chrome.exe";
const errors = [];
const results = {};
const browser = await chromium.launch({ executablePath: EXE });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

await page.goto(url, { waitUntil: "load", timeout: 25000 });
await page.bringToFront();
await page.waitForTimeout(1500);

const G = "__biathlon3d";
const ev = (fn, arg) => page.evaluate(fn, arg);
const snap = () => ev((g) => {
  const game = window[g];
  return {
    phase: game.phase,
    p1: {
      dist: Math.round(game.p1.dist * 10) / 10,
      speed: Math.round(game.p1.speed * 100) / 100,
      lap: game.p1.lap,
      inPenalty: game.p1.inPenalty,
      penaltyLeft: Math.round(game.p1.penaltyLeft * 10) / 10,
      boutsDone: game.p1.boutsDone,
    },
    opp: { dist: Math.round(game.opp.dist * 10) / 10, speed: Math.round(game.opp.speed * 100) / 100, visible: game.opp.figure.group.visible },
    sh: { stage: game.sh.stage, shots: game.sh.shots, hits: game.sh.hits, misses: game.sh.misses, holding: game.sh.holding, air: Math.round(game.sh.air * 100) / 100 },
    overlay: { visible: game.overlay.visible, title: game.overlay.title, eyebrow: game.overlay.eyebrow },
    camFinite: Number.isFinite(game.camera.position.x) && Number.isFinite(game.camera.position.y) && Number.isFinite(game.camera.position.z),
  };
}, G);
const waitPhase = async (phase, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const p = await ev((g) => window[g].phase, G);
    if (p === phase) return true;
    await page.waitForTimeout(120);
  }
  return false;
};
const taps = async (n, gapMs = 400) => {
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
    await page.waitForTimeout(gapMs);
  }
};
// 量晃動幅度:取樣 sampleMs 內 |off| 的最大值
const measureSway = (sampleMs) => ev(async ({ g, sampleMs }) => {
  const game = window[g];
  let max = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const id = setInterval(() => {
      max = Math.max(max, Math.hypot(game.sh.offX, game.sh.offY));
      if (performance.now() - t0 > sampleMs) { clearInterval(id); resolve(); }
    }, 30);
  });
  return Math.round(max * 1000) / 1000;
}, { g: G, sampleMs });

// —— ③选单期 NaN 鏡頭 + ④非黑圖(同一 evaluate 內 render→toDataURL) ——
results.menu = await ev((g) => {
  const game = window[g];
  game.update(0.016);
  game.render();
  const data = game.canvas.toDataURL("image/png");
  return { camFinite: Number.isFinite(game.camera.position.x), dataLen: data.length };
}, G);
await page.screenshot({ path: outDir + "/ss-menu.png" });

// —— ①開一場 kids 單人競賽 ——
await page.selectOption("#menuDifficultySelect", "kids");
await page.click('.mode-card[data-mode="race"]');
await page.click("#startMatchButton");
await page.waitForTimeout(400);
await page.keyboard.press("Space"); // 出發
await page.waitForTimeout(200);
await taps(10, 380);
results.skating = await snap();
await page.screenshot({ path: outDir + "/ss-skating.png" });

// —— 傳到第 1 圈末:過圈界=自動進射擊段(臥射) ——
await ev((g) => { const game = window[g]; game.p1.dist = 245; game.opp.dist = 60; }, G);
await taps(3, 380);
results.enteredBout1 = await waitPhase("shooting", 8000);
results.bout1Start = await snap();
await page.screenshot({ path: outDir + "/ss-shoot-prone.png" });

// —— ②屏息晃動對比(臥射):未屏息 vs 按住 Shift ——
const swayFree1 = await measureSway(1300);
await page.keyboard.down("ShiftLeft");
await page.waitForTimeout(350);
const swayHeld1 = await measureSway(1300);
results.sway = { stage1Free: swayFree1, stage1Held: swayHeld1 };

// —— 5 發全中(屏息時晃動遠小於 kids 靶半徑 0.5) ——
for (let i = 0; i < 5; i += 1) {
  await page.keyboard.press("KeyJ");
  await page.waitForTimeout(450);
}
await page.keyboard.up("ShiftLeft");
results.bout1 = await snap();
results.bout1Targets = await ev((g) => {
  const game = window[g];
  return {
    fallen: game.targets.filter((t) => t.fallT >= 0).length,
    whitePlates: game.targets.filter((t) => t.plate.material.color.getHex() === 0xf5f6f8).length,
  };
}, G);
await page.screenshot({ path: outDir + "/ss-shoot-hit.png" });
results.backToSkate1 = await waitPhase("skating", 8000);
results.afterBout1 = await snap();

// —— 傳到第 2 圈末:立射(晃更大)+故意脫靶 1 發 → 罰圈 ——
await ev((g) => { const game = window[g]; game.p1.dist = 2 * 248.3 - 3; game.opp.dist = 200; }, G);
await taps(3, 380);
results.enteredBout2 = await waitPhase("shooting", 8000);
const swayFree2 = await measureSway(1300);
results.sway.stage2Free = swayFree2;
await page.screenshot({ path: outDir + "/ss-shoot-stand.png" });

// 逐發打完 5 發:先湊出至少 1 發脫靶(等準星晃出靶半徑外再開槍),其餘屏息打中
for (let i = 0; i < 5; i += 1) {
  const st = await ev((g) => ({ shots: window[g].sh.shots, misses: window[g].sh.misses }), G);
  if (st.shots >= 5) break;
  if (st.misses === 0) {
    // 等準星偏移 > 靶半徑(kids targetR=0.5)再開槍=確定脫靶
    await ev(async (g) => {
      const game = window[g];
      await new Promise((resolve) => {
        const id = setInterval(() => {
          if (Math.hypot(game.sh.offX, game.sh.offY) > 0.58) { clearInterval(id); resolve(); }
        }, 25);
        setTimeout(() => { clearInterval(id); resolve(); }, 6000);
      });
    }, G);
    await page.keyboard.press("KeyJ");
    await page.waitForTimeout(250);
  } else {
    await page.keyboard.down("ShiftLeft");
    await page.waitForTimeout(400);
    await page.keyboard.press("KeyJ");
    await page.keyboard.up("ShiftLeft");
    await page.waitForTimeout(300);
  }
}
results.bout2 = await snap();
results.backToSkate2 = await waitPhase("skating", 9000);
results.afterBout2 = await snap();
results.penaltyHud = await ev(() => {
  const b = document.querySelector("#penaltyBanner");
  return { visible: !!b && !b.hidden, text: b ? b.textContent : "" };
});
await page.screenshot({ path: outDir + "/ss-penalty.png" });

// 罰圈滑完(縮短剩餘距離,照樣用真按鍵滑)
await ev((g) => { const game = window[g]; if (game.p1.inPenalty) game.p1.penaltyLeft = 2; }, G);
await taps(6, 380);
results.penaltyCleared = await ev((g) => !window[g].p1.inPenalty, G);

// —— 第 3 圈衝線:出名次 ——
await ev((g) => { const game = window[g]; game.p1.dist = game.finishDist - 10; game.opp.dist = game.finishDist - 200; game.opp.inPenalty = false; game.opp.aiShooting = false; }, G);
for (let i = 0; i < 14; i += 1) {
  await page.keyboard.press(i % 2 === 0 ? "KeyA" : "KeyD");
  await page.waitForTimeout(380);
  const p = await ev((g) => window[g].phase, G);
  if (p === "ended") break;
}
await page.waitForTimeout(700);
results.finish = await snap();
results.rankText = await ev(() => document.querySelector("#rankLabel").textContent);
await page.screenshot({ path: outDir + "/ss-finish.png" });

// —— ③④ 完賽期再驗一次 NaN+非黑圖 ——
results.endFrame = await ev((g) => {
  const game = window[g];
  game.update(0.016);
  game.render();
  const data = game.canvas.toDataURL("image/png");
  return { camFinite: Number.isFinite(game.camera.position.x), dataLen: data.length };
}, G);

// —— 驗收判定 ——
const checks = {
  // ③ NaN 鏡頭(選單期+完賽期)
  menuCamFinite: results.menu.camFinite === true,
  endCamFinite: results.endFrame.camFinite === true,
  // ④ 非黑圖(黑圖 PNG 會壓到極小;>60k 字元=有內容)
  menuFrameNotBlack: results.menu.dataLen > 60000,
  endFrameNotBlack: results.endFrame.dataLen > 60000,
  // ① 完整賽制
  speedUp: results.skating.p1.speed > 3,
  aiMoves: results.skating.opp.speed > 2,
  bout1Entered: results.enteredBout1 === true && results.bout1Start.sh.stage === 1,
  bout1AllHit: results.bout1.sh.hits === 5 && results.bout1.sh.misses === 0,
  targetsFellAndWhite: results.bout1Targets.fallen === 5 && results.bout1Targets.whitePlates === 5,
  noPenaltyWhenClean: results.afterBout1.p1.inPenalty === false,
  bout2Standing: results.enteredBout2 === true && results.bout2.sh.stage === 2,
  bout2HasMiss: results.bout2.sh.misses >= 1,
  penaltyTriggered: results.afterBout2.p1.inPenalty === true && results.afterBout2.p1.penaltyLeft > 0,
  penaltyHudShown: results.penaltyHud.visible === true && /罰圈/.test(results.penaltyHud.text),
  penaltyCleared: results.penaltyCleared === true,
  finished: results.finish.phase === "ended" && /第一個衝線|勝利/.test(results.finish.overlay.title + results.finish.overlay.eyebrow),
  rankShown: /第 1 位/.test(results.rankText),
  lapsWere3: results.finish.p1.lap === 3 && results.finish.p1.boutsDone === 2,
  // ② 屏息晃動變小(數值:held < free 的一半)+立射晃動 > 臥射
  breathCalms: results.sway.stage1Held < results.sway.stage1Free * 0.5,
  standingSwaysMore: results.sway.stage2Free > results.sway.stage1Free,
  camAlwaysFinite: [results.skating, results.bout1, results.bout2, results.finish].every((s) => s.camFinite),
  zeroPageErrors: errors.length === 0,
};
const allGreen = Object.values(checks).every(Boolean);
console.log(JSON.stringify({ checks, results, errors, allGreen }, null, 2));
await browser.close();
process.exit(allGreen ? 0 : 1);
