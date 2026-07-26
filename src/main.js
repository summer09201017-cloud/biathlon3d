import "./styles.css";
import { BiathlonGame, GAME_MODES } from "./game.js";
import { AudioManager } from "./audio.js";
import { speakLine, setVoiceEnabled } from "./voice.js";
import { hasSavedGame, loadSettings, saveSettings } from "./storage.js";

const ui = {
  canvas: document.querySelector("#gameCanvas"),
  cameraButton: document.querySelector("#cameraButton"),
  rankLabel: document.querySelector("#rankLabel"),
  speedTopLabel: document.querySelector("#speedTopLabel"),
  modeCode: document.querySelector("#modeCode"),
  lapLabel: document.querySelector("#lapLabel"),
  timeLabel: document.querySelector("#timeLabel"),
  rhythmTopLabel: document.querySelector("#rhythmTopLabel"),
  phaseLabel: document.querySelector("#phaseLabel"),
  statusMessage: document.querySelector("#statusMessage"),
  modeLabel: document.querySelector("#modeLabel"),
  difficultyLabel: document.querySelector("#difficultyLabel"),
  gapLabel: document.querySelector("#gapLabel"),
  lapSideLabel: document.querySelector("#lapSideLabel"),
  speedLabel: document.querySelector("#speedLabel"),
  audioStatus: document.querySelector("#audioStatus"),
  saveStatus: document.querySelector("#saveStatus"),
  installButton: document.querySelector("#installButton"),
  installHint: document.querySelector("#installHint"),
  loadButton: document.querySelector("#loadButton"),
  menuButton: document.querySelector("#menuButton"),
  audioButton: document.querySelector("#audioButton"),
  pauseButton: document.querySelector("#pauseButton"),
  touchControls: document.querySelector("#touchControls"),
  speedMeterFill: document.querySelector("#speedMeterFill"),
  speedMeterText: document.querySelector("#speedMeterText"),
  rhythmFill: document.querySelector("#rhythmFill"),
  rhythmValue: document.querySelector("#rhythmValue"),
  bendFill: document.querySelector("#bendFill"),
  bendValue: document.querySelector("#bendValue"),
  matchOverlay: document.querySelector("#matchOverlay"),
  overlayEyebrow: document.querySelector("#overlayEyebrow"),
  overlayTitle: document.querySelector("#overlayTitle"),
  overlayText: document.querySelector("#overlayText"),
  resumeButton: document.querySelector("#resumeButton"),
  overlayMenuButton: document.querySelector("#overlayMenuButton"),
  homeScreen: document.querySelector("#homeScreen"),
  modeCardGrid: document.querySelector("#modeCardGrid"),
  modeDescription: document.querySelector("#modeDescription"),
  menuDifficultySelect: document.querySelector("#menuDifficultySelect"),
  audioSelect: document.querySelector("#audioSelect"),
  modeMetaTitle: document.querySelector("#modeMetaTitle"),
  modeMetaGoal: document.querySelector("#modeMetaGoal"),
  startMatchButton: document.querySelector("#startMatchButton"),
  commentaryBar: document.querySelector("#commentaryBar"),
  continueSavedButton: document.querySelector("#continueSavedButton"),
  // 射擊段 HUD(準星/靶況/罰圈)
  shootLayer: document.querySelector("#shootLayer"),
  shootDots: document.querySelector("#shootDots"),
  shootStageLabel: document.querySelector("#shootStageLabel"),
  penaltyBanner: document.querySelector("#penaltyBanner"),
};

const settings = loadSettings();
const audio = new AudioManager();
audio.setEnabled(settings.audioEnabled !== false);

const game = new BiathlonGame({
  canvas: ui.canvas,
  touchRoot: ui.touchControls,
});
window.__biathlon3d = game; // dev hook:Playwright 驗證用
window.__game = game; // /smoke3d 通用鉤子

let selectedModeId = game.modeId;
let selectedDifficulty = game.difficulty;
let audioEnabled = settings.audioEnabled !== false;

function persistSettings() {
  saveSettings({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
    audioEnabled,
  });
}

function setMeterFill(element, value) {
  element.style.transform = `scaleX(${Math.max(0, Math.min(1, value))})`;
}

function setAudioState(enabled) {
  audioEnabled = enabled;
  audio.setEnabled(enabled);
  setVoiceEnabled(enabled);
  ui.audioStatus.textContent = enabled ? "開啟" : "靜音";
  ui.audioButton.textContent = enabled ? "音效開啟" : "音效靜音";
  ui.audioSelect.value = enabled ? "on" : "off";
  persistSettings();
}

function syncMenuCards() {
  for (const button of ui.modeCardGrid.querySelectorAll(".mode-card")) {
    button.classList.toggle("selected", button.dataset.mode === selectedModeId);
  }
  const mode = GAME_MODES[selectedModeId];
  ui.modeDescription.textContent = mode.description;
  ui.modeMetaTitle.textContent = mode.label;
  ui.modeMetaGoal.textContent = mode.goal;
}

function syncMenuControls() {
  ui.menuDifficultySelect.value = selectedDifficulty;
  syncMenuCards();
}

function syncGameConfigurationToMenu() {
  selectedModeId = game.modeId;
  selectedDifficulty = game.difficulty;
  syncMenuControls();
}

function syncOverlay(overlay) {
  ui.matchOverlay.classList.toggle("visible", overlay.visible);
  ui.overlayEyebrow.textContent = overlay.eyebrow;
  ui.overlayTitle.textContent = overlay.title;
  ui.overlayText.textContent = overlay.text;
  ui.resumeButton.hidden = !overlay.canResume;
}

function openHomeScreen() {
  game.openHomeMenu();
  audio.stopCrowd();
  syncGameConfigurationToMenu();
  ui.homeScreen.classList.add("visible");
}

function closeHomeScreen() {
  ui.homeScreen.classList.remove("visible");
}

function unlockAudio() {
  audio.unlock();
}

// —— 中文播報:畫面字幕條+預烤 mp3 人聲同步唸(人聲鐵律:沒烤過的句子只出字幕) ——
function pushCommentary(text, tone = "info", spoken = text) {
  const bar = ui.commentaryBar;
  if (!bar || !text) return;
  bar.hidden = false;
  bar.dataset.tone = tone;
  bar.textContent = text;
  bar.style.animation = "none";
  void bar.offsetWidth;
  bar.style.animation = "";
  speakLine(spoken);
}

function handleGameEvent(event) {
  switch (event.type) {
    case "match-start": {
      audio.whistle();
      audio.startCrowd(); // 冬奧雪場滿場觀眾——環境音照鐵則開
      audio.vibrate(18);
      pushCommentary("歡迎來到冬季兩項!滑雪加射擊,節奏和冷靜都要有!");
      window.psPing?.("-start");
      break;
    }
    case "gate": {
      audio.buzzer();
      audio.vibrate(14);
      pushCommentary("出發!左右交替撐杖,節奏穩住!");
      break;
    }
    case "rhythm-good": {
      audio.scoreSting();
      pushCommentary("節奏漂亮,越滑越快!", "hot");
      break;
    }
    case "bend-enter": {
      if (event.first) pushCommentary("進彎道了,按住傾身鍵!", "cool");
      break;
    }
    case "bend-exit-good": {
      audio.swish();
      pushCommentary("彎道傾身,漂亮地滑過去!", "hot");
      break;
    }
    case "stumble": {
      audio.thud(0.6);
      audio.vibrate([40, 20, 40]);
      pushCommentary("踉蹌了一下——穩住節奏!", "cool", "哎呀,踉蹌了一下,穩住節奏再來!");
      break;
    }
    // —— 射擊段 ——
    case "range-enter": {
      audio.buzzer();
      audio.vibrate(20);
      pushCommentary(
        event.stage === 1 ? "進入射擊區(臥射)——穩住呼吸!" : "第二次射擊(立射)——晃動更大!",
        "cool",
        event.stage === 1 ? "進入射擊區,穩住呼吸!" : "第二次射擊是立射,晃動更大,更要沉住氣!",
      );
      break;
    }
    case "shot": {
      if (event.hit) {
        audio.scoreSting();
        audio.vibrate(24);
        pushCommentary(`命中!(${event.hits}/${event.shots})`, "hot", "命中!靶子應聲倒下!");
      } else {
        audio.thud(0.5);
        audio.vibrate([30, 20, 30]);
        pushCommentary("脫靶一發——要繞罰圈了!", "cool", "脫靶一發,要繞罰圈了!");
      }
      break;
    }
    case "bout-result": {
      if (event.misses === 0) {
        audio.crowdCheer(0.8);
        pushCommentary("五發全中,漂亮!", "hot", "五發全中,漂亮!神射手就是你!");
      }
      break;
    }
    case "range-exit": {
      audio.swish();
      pushCommentary("射擊結束——回到賽道!", "info", "射擊結束,回到賽道繼續滑!");
      break;
    }
    case "penalty-start": {
      audio.thud(0.7);
      pushCommentary(`脫靶 ${event.misses} 發——繞罰圈!`, "cool", "脫靶一發,要繞罰圈了!");
      break;
    }
    case "penalty-done": {
      audio.scoreSting();
      pushCommentary("罰圈完成——追回去!", "hot", "罰圈完成,加緊節奏追回去!");
      break;
    }
    case "ai-shoot-done": {
      pushCommentary(`AI 射擊:命中 ${event.hits}/5`, "info", "對手也完成射擊,回到賽道了!");
      break;
    }
    case "last-lap": {
      audio.buzzer();
      audio.crowdCheer(0.7);
      pushCommentary("最後一圈——衝線!", "hot", "最後一圈,衝線!");
      break;
    }
    case "overtake": {
      audio.swish();
      audio.crowdCheer(event.ahead ? 0.7 : 0.3);
      pushCommentary(
        event.ahead ? "超越!衝到前面去了!" : "被追過了——加緊節奏!",
        event.ahead ? "hot" : "cool",
        event.ahead ? "超越了!衝到前面去了!" : "被追過了,加緊節奏追回來!",
      );
      break;
    }
    case "race-end": {
      try { if (!['localhost','127.0.0.1'].includes(location.hostname)) {   // -done:玩完一局(t=本局秒數,/stats 使用次數與平均停留吃這個)
        var __dt = Math.round((Date.now() - (window.__matchT0 || Date.now())) / 1000);
        navigator.sendBeacon?.('https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=biathlon3d-done&t=' + __dt);
      } } catch (_) {}
      audio.horn();
      audio.crowdCheer(event.win ? 1 : 0.5);
      audio.vibrate([110, 50, 120]);
      pushCommentary(
        event.win ? "第一個衝線!" + event.elapsed.toFixed(1) + " 秒!" : "AI 先到了——再來一場!",
        event.win ? "hot" : "cool",
        event.win
          ? (game.mode.race ? "衝線!你是第一名,全場歡呼!" : "完賽!滑雪和射擊都練到了,太棒了!")
          : "衝過終點!對手先到,再來一場!",
      );
      ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";
      window.psPing?.("-done", event.elapsed);
      break;
    }
    default:
      break;
  }
}

game.onEvent = handleGameEvent;

game.onHudUpdate = (state) => {
  ui.rankLabel.textContent = state.rankText;
  ui.speedTopLabel.textContent = state.speedText;
  ui.modeCode.textContent = ({ 單人競賽: "競賽", 練習場: "練習" })[state.modeLabel] || state.modeLabel;
  ui.lapLabel.textContent = state.lapText;
  ui.timeLabel.textContent = state.timeText;
  ui.rhythmTopLabel.textContent =
    state.lastResult === null ? "—"
      : state.lastResult === "perfect" ? "完美!"
        : state.lastResult === "good" ? "好!"
          : state.lastResult === "fast" ? "太急"
            : "同側!";
  ui.phaseLabel.textContent = state.phaseLabel;
  ui.statusMessage.textContent = state.message;
  ui.modeLabel.textContent = state.modeLabel;
  ui.difficultyLabel.textContent = state.difficultyLabel;
  ui.gapLabel.textContent = state.gapText;
  ui.lapSideLabel.textContent = state.lapText;
  ui.speedLabel.textContent = state.speedText;
  ui.speedMeterText.textContent = state.speedText;
  setMeterFill(ui.speedMeterFill, state.speed01);
  setMeterFill(ui.rhythmFill, state.rhythm01);
  ui.rhythmValue.textContent = state.skating ? `${Math.round(state.rhythm01 * 100)}%(下一步:${state.nextSide})` : "—";
  // 彎道傾身指示
  setMeterFill(ui.bendFill, state.inBend ? 1 : 0);
  ui.bendValue.textContent = state.shooting ? `${state.stageLabel} 射擊中` : !state.skating ? "—" : state.inBend ? (state.leanOk ? "傾身中 ✓" : "進彎!按住傾身!") : "直道";
  { // 中下方大條:滑行=節奏/傾身;射擊=氣量條(按住 Shift 屏息);罰圈=剩餘距離
    const bp = document.getElementById("bigPower"), bf = document.getElementById("bigPowerFill"), bl = document.getElementById("bigPowerLabel");
    if (bp) {
      bp.hidden = !(state.skating || state.shooting);
      if (state.shooting) {
        bl.textContent = state.holding ? `屏息中(${state.stageLabel})——穩!J 開槍!` : `氣量(按住 Shift 屏息穩定)· ${state.stageLabel}`;
        bf.style.transform = `scaleX(${Math.max(0, Math.min(1, state.air01))})`;
        bf.classList.toggle("full", state.holding);
      } else if (state.penalty) {
        bl.textContent = `罰圈中!剩 ${state.penaltyLeftText}——繼續左右撐杖!`;
        bf.style.transform = "scaleX(1)";
        bf.classList.add("full");
      } else if (state.inBend) {
        bl.textContent = state.leanOk ? "彎道傾身中 ✓" : "進彎!按住 W 傾身!";
        bf.style.transform = "scaleX(1)";
        bf.classList.toggle("full", state.leanOk);
      } else {
        bl.textContent = `節奏(左右交替撐杖)下一步:${state.nextSide}`;
        bf.style.transform = `scaleX(${Math.min(1, state.rhythm01)})`;
        bf.classList.toggle("full", state.rhythm01 > 0.8);
      }
    }
  }
  // 射擊段 HUD:準星(螢幕中心十字)+ 5 靶指示點 + 臥射/立射標籤
  if (ui.shootLayer) {
    ui.shootLayer.hidden = !state.shooting;
    if (state.shooting) {
      ui.shootStageLabel.textContent = `${state.stageLabel}——5 發打 5 靶(剩 ${state.shotsLeft} 發)`;
      const dots = [];
      for (let i = 0; i < 5; i += 1) {
        const rlt = state.shotResults[i];
        dots.push(`<span class="shot-dot ${rlt === "hit" ? "hit" : rlt === "miss" ? "miss" : ""}"></span>`);
      }
      ui.shootDots.innerHTML = dots.join("");
    }
  }
  // 罰圈大字提示(判定=畫面:繞圈+HUD 同步)
  if (ui.penaltyBanner) {
    ui.penaltyBanner.hidden = !state.penalty;
    if (state.penalty) ui.penaltyBanner.textContent = `罰圈中 · 剩 ${state.penaltyLeftText}`;
  }
  // 競賽小地圖:橢圓路線+終點+射擊區+我(紅)+對手(綠)
  {
    const mm = document.getElementById("miniMap");
    const showMap = state.phaseLabel !== "主選單";
    mm.hidden = !showMap;
    if (showMap) {
      const ctx = mm.getContext("2d");
      const d = game.getMinimapData();
      ctx.clearRect(0, 0, mm.width, mm.height);
      const sx = (x) => ((x + 56) / 112) * mm.width;
      const sy = (z) => ((z + 31) / 62) * mm.height;
      ctx.strokeStyle = "rgba(255,255,255,.5)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      d.path.forEach(([x, z], i) => (i ? ctx.lineTo(sx(x), sy(z)) : ctx.moveTo(sx(x), sy(z))));
      ctx.closePath();
      ctx.stroke();
      ctx.fillStyle = "#ffe9ad";
      ctx.fillRect(sx(d.finish[0]) - 2, sy(d.finish[1]) - 4, 4, 8);
      // 射擊區標記
      ctx.fillStyle = "#8fd0ff";
      ctx.fillRect(sx(d.range[0]) - 3, sy(d.range[1]) - 3, 6, 6);
      if (d.opp) {
        ctx.fillStyle = "#57c26e";
        ctx.beginPath();
        ctx.arc(sx(d.opp[0]), sy(d.opp[1]), 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "#ff5544";
      ctx.beginPath();
      ctx.arc(sx(d.me[0]), sy(d.me[1]), 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = "#ffe9ad";
      ctx.font = "bold 12px system-ui";
      ctx.fillText(state.gapText, 8, 16);
    }
  }
  syncOverlay(state.overlay);
};

syncGameConfigurationToMenu();
setAudioState(audioEnabled);
ui.saveStatus.textContent = hasSavedGame() ? "已記錄" : "尚無";

ui.modeCardGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".mode-card");
  if (!button) return;
  unlockAudio();
  audio.uiTap();
  selectedModeId = button.dataset.mode;
  syncMenuCards();
  persistSettings();
});

ui.menuDifficultySelect.addEventListener("change", (event) => {
  selectedDifficulty = event.target.value;
  persistSettings();
});

ui.audioSelect.addEventListener("change", (event) => {
  unlockAudio();
  audio.uiTap();
  setAudioState(event.target.value === "on");
});

ui.startMatchButton.addEventListener("click", () => {
  window.__matchT0 = Date.now();   // -done beacon 用:本局開始時間
  unlockAudio();
  audio.uiTap();
  game.applyPresentation({
    difficulty: selectedDifficulty,
    modeId: selectedModeId,
  });
  game.startSelectedMatch();
  closeHomeScreen();
});

function loadIntoUi() {
  const loaded = game.loadGame();
  syncGameConfigurationToMenu();
  ui.saveStatus.textContent = loaded && hasSavedGame() ? "已記錄" : "尚無";
}

ui.continueSavedButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  loadIntoUi();
});

ui.loadButton.addEventListener("click", loadIntoUi);

ui.menuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.overlayMenuButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  openHomeScreen();
});

ui.cameraButton.addEventListener("click", () => {
  game.cycleCameraView();
});

ui.audioButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  setAudioState(!audioEnabled);
});

ui.pauseButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.togglePause();
});

ui.resumeButton.addEventListener("click", () => {
  unlockAudio();
  audio.uiTap();
  game.resume();
});

window.addEventListener("pointerdown", unlockAudio, { passive: true });
window.addEventListener("keydown", unlockAudio, { passive: true });

let deferredInstallPrompt = null;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  ui.installButton.hidden = false;
  ui.installHint.textContent = "已偵測到可安裝版本，點一下就能加入主畫面。";
});

ui.installButton.addEventListener("click", async () => {
  unlockAudio();
  audio.uiTap();
  if (!deferredInstallPrompt) {
    ui.installHint.textContent = "如果是 iPhone，請用分享選單的「加入主畫面」。";
    return;
  }
  deferredInstallPrompt.prompt();
  const outcome = await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  ui.installButton.hidden = true;
  ui.installHint.textContent =
    outcome.outcome === "accepted" ? "安裝要求已送出。" : "你可以之後再安裝。";
});

window.addEventListener("appinstalled", () => {
  ui.installButton.hidden = true;
  ui.installHint.textContent = "已安裝到裝置。";
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    game.saveGame(true);
  }
});

// dev(localhost)不註冊 SW——SW 快取會讓每次改動都吃到「上一版」(07-11 踩雷)
if ("serviceWorker" in navigator && !["localhost", "127.0.0.1"].includes(location.hostname)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {
      ui.installHint.textContent = "Service Worker 註冊失敗，但仍可直接遊玩。";
    });
  });
}

game.start();


// ── 真實停留 -dwell(07-25 廣佈:開頁到離開單發回報,手機安全;/stats 真實平均+最近一次)──
(function () {
  if (["localhost", "127.0.0.1"].includes(location.hostname)) return;
  var _dwT0 = Date.now(), _dwSent = false;
  function _dwLeave() {
    if (_dwSent) return; _dwSent = true;
    var s = Math.round((Date.now() - _dwT0) / 1000);
    if (s >= 3 && s <= 1800 && navigator.sendBeacon)
      navigator.sendBeacon("https://hfpc-play-stats.summer09201017.workers.dev/api/ping?g=biathlon3d-dwell&t=" + s);
  }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") _dwLeave(); });
  window.addEventListener("pagehide", _dwLeave);
})();
