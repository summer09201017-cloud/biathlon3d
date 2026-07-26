import * as THREE from "three";
import { InputManager } from "./input.js";
import { loadSettings, saveSettings, loadSavedGame, saveGameState } from "./storage.js";
import { animateIdleHead, animateCrowdCheer, EAR_SAFE_PHI } from "./idle-life.js"; // idle 生動共用資產(3d-figure-kit)

// —— 冬季兩項 3D(biathlon3d)——B3 拼裝:fork 自 speedskating3d(A2 速滑)+收割 shooting3d(A1 射擊)。
// 賽道:雪原橢圓(兩直道+兩個 180° 彎道)——保留 ovalPoint 解析式幾何,冰面換雪道壓痕色;
//   場邊(前直道內側)射擊區:5 個黑色圓靶一排,打中倒下變白;旁邊小罰圈。
// 玩法核心:
//   ①滑雪段=速滑引擎原封:左右交替撐杖(P1=A/D)踩節奏加速;彎道按住 W 傾身不減速。
//   ②射擊段(收割 shooting3d 屏息穩定窗):第 1、2 圈結束自動滑進射擊區停住、切準星視角——
//     準星持續晃動(sin 疊加),按住 Shift=屏息(晃動大減、氣量條有限,放開回復),按 J 開槍;
//     5 發打 5 靶,每脫靶一發=繞小罰圈一段距離(幼幼檔罰少)。第一次臥射、第二次立射(晃更大)。
//   ③共 3 圈,第 3 圈衝線。AI 對手 1 名:滑行 aiSkill+射擊命中率照難度,也吃罰圈。
// ★判定=畫面:準星偏移量=命中判定、靶半徑=畫面靶半徑;屏息晃動變小看得出;罰圈有 HUD 提示。
// ★溫柔規則:永不摔倒、脫靶只罰圈不失敗、永遠滑得完。
// ★this.running 只給主迴圈 RAF 用(athletics 撞名事故鐵則)。

// ---------- 可調量值 ----------
// 滑行:push=撐杖增益、ideal=理想節奏(秒)、tol=容錯窗、maxSpeed=上限、assist=幼兒輔助、aiSkill/aiLean=AI。
// 射擊:sway=準星晃動幅度(m@靶面)、standMul=立射放大、breathCalm=屏息時晃動倍率、airMax=氣量秒數、
//       targetR=靶半徑(m,判定=畫面同值)、penaltyLen=每脫靶罰圈距離(m)、aiHit=AI 單發命中率、aiShootTime=AI 打完 5 發秒數。
export const DIFFICULTY_PRESETS = {
  kids: {
    push: 0.2, ideal: 0.46, tol: 0.62, maxSpeed: 8.6, laps: 3, assist: 0.55, aiSkill: 0.3, aiLean: 0.35,
    sway: 0.32, standMul: 1.25, breathCalm: 0.15, airMax: 4.5, targetR: 0.5, penaltyLen: 10, aiHit: 0.35, aiShootTime: 16,
  },
  child: {
    push: 0.19, ideal: 0.42, tol: 0.55, maxSpeed: 10.0, laps: 3, assist: 0.32, aiSkill: 0.46, aiLean: 0.55,
    sway: 0.46, standMul: 1.4, breathCalm: 0.2, airMax: 4.0, targetR: 0.42, penaltyLen: 16, aiHit: 0.55, aiShootTime: 13,
  },
  normal: {
    push: 0.17, ideal: 0.37, tol: 0.42, maxSpeed: 12.8, laps: 3, assist: 0, aiSkill: 0.7, aiLean: 0.88,
    sway: 0.64, standMul: 1.5, breathCalm: 0.25, airMax: 3.2, targetR: 0.34, penaltyLen: 22, aiHit: 0.72, aiShootTime: 11,
  },
  hard: {
    push: 0.165, ideal: 0.33, tol: 0.34, maxSpeed: 14.4, laps: 3, assist: 0, aiSkill: 0.84, aiLean: 1,
    sway: 0.84, standMul: 1.6, breathCalm: 0.3, airMax: 2.6, targetR: 0.27, penaltyLen: 28, aiHit: 0.85, aiShootTime: 9,
  },
};

export const DIFFICULTY_LABELS = {
  kids: "幼幼(超簡單)",
  child: "兒童(簡單)",
  normal: "標準",
  hard: "青少年(挑戰)",
};

export const GAME_MODES = {
  race: {
    label: "單人競賽",
    race: true,
    description: "跟 AI 選手比一場冬季兩項:滑 3 圈雪道,第 1、2 圈結束進射擊區打 5 靶——脫靶要繞罰圈,先衝線的贏!",
    goal: "3 圈+2 次射擊,先衝線者勝",
  },
  practice: {
    label: "練習場",
    race: false,
    description: "沒有對手——同樣 3 圈+兩次射擊,自由練撐杖節奏、彎道傾身與屏息射擊的手感。",
    goal: "純練手感,不計勝負",
  },
};

export function getModeConfig(modeId) {
  return GAME_MODES[modeId] || GAME_MODES.race;
}

// 選手戰衣(P1 紅;AI 綠)
export const SUITS = {
  p1: { label: "紅衣選手", suit: 0xc63c34, trim: 0xf2e9d8 },
  ai: { label: "綠衣選手", suit: 0x3f9b5a, trim: 0xf6d743 },
};

// ---------- 賽道常數(解析式 stadium:兩直道+兩個 180° 彎) ----------
const STRAIGHT_LEN = 55; // 直道長(m)
const BEND_R = 22; // 彎道中線半徑(m)
const TRACK_PERIM = 2 * STRAIGHT_LEN + 2 * Math.PI * BEND_R; // ≈248.3m
const ICE_HALF_W = 5.2; // 雪道半寬
const LANE_LINE_OFF = 3.8; // 內外壓痕線偏移
const LANE_IN = -1.9; // 內道(P1)
const LANE_OUT = 1.9; // 外道(AI)
const TAP_TOO_FAST = 0.14; // 比這更快的連打=腳步打結
const STUMBLE_DUR = 0.9; // 踉蹌恢復秒數
const BEND_DRAG_NOLEAN = 0.5; // 彎道沒傾身的自然減速(溫柔)
const BASE_DRAG = 0.1; // 直道滑行衰減(有「撐一下滑出去」的慣性感)

// ---------- 射擊區常數(前直道內側) ----------
const RANGE_MAT = { x: -20, z: 15.8 }; // P1 射擊墊
const AI_MAT = { x: -14.2, z: 15.8 }; // AI 射擊墊
const TARGET_Z = 1.8; // 靶排 z(距墊 14m)
const TARGET_Y = 1.2; // 靶心高
const TARGET_GAP = 2.0; // 靶距
const SHOTS_PER_BOUT = 5;
const PENALTY_C = { x: -6, z: 8.5 }; // 罰圈圓心(射擊區旁)
const PENALTY_R = 5; // 罰圈半徑

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// stadium 幾何:d=里程(m),off=沿「外側」法線的偏移(+外 −內)
function ovalPoint(d, off = 0) {
  const P = TRACK_PERIM;
  const L = STRAIGHT_LEN;
  const R = BEND_R;
  const m = ((d % P) + P) % P;
  let px;
  let pz;
  let tx;
  let tz;
  if (m < L) {
    px = -L / 2 + m;
    pz = R;
    tx = 1;
    tz = 0;
  } else if (m < L + Math.PI * R) {
    const a = (m - L) / R;
    px = L / 2 + R * Math.sin(a);
    pz = R * Math.cos(a);
    tx = Math.cos(a);
    tz = -Math.sin(a);
  } else if (m < 2 * L + Math.PI * R) {
    px = L / 2 - (m - L - Math.PI * R);
    pz = -R;
    tx = -1;
    tz = 0;
  } else {
    const a = (m - 2 * L - Math.PI * R) / R;
    px = -L / 2 - R * Math.sin(a);
    pz = -R * Math.cos(a);
    tx = -Math.cos(a);
    tz = Math.sin(a);
  }
  // 外側法線=切線的左法線(−tz, tx)(此參數化下指向遠離場心)
  return { x: px + -tz * off, z: pz + tx * off, tx, tz };
}

function inBendAt(d) {
  const P = TRACK_PERIM;
  const L = STRAIGHT_LEN;
  const m = ((d % P) + P) % P;
  return (m >= L && m < L + Math.PI * BEND_R) || m >= 2 * L + Math.PI * BEND_R;
}

// ---------- 人物(照 3d-figure-kit 鐵則:矩形身體/長腿/臉部眼耳嘴眉齊) ----------
function createLimb({ upperMaterial, lowerMaterial, endMaterial, upperLen, lowerLen, upperRadius, lowerRadius, end = "hand", thumbSide = 1 }) {
  const pivot = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(upperRadius, upperLen, 4, 8), upperMaterial);
  upper.position.y = -upperLen / 2;
  pivot.add(upper);
  const joint = new THREE.Group();
  joint.position.y = -upperLen;
  pivot.add(joint);
  const lower = new THREE.Mesh(new THREE.CapsuleGeometry(lowerRadius, lowerLen, 4, 8), lowerMaterial);
  lower.position.y = -lowerLen / 2;
  joint.add(lower);
  let endMesh;
  if (end === "foot") {
    endMesh = new THREE.Mesh(new THREE.BoxGeometry(lowerRadius * 2.1, lowerRadius, lowerRadius * 3.4), endMaterial);
    endMesh.position.set(0, -lowerLen - lowerRadius * 0.4, lowerRadius * 0.9);
  } else {
    const r = lowerRadius;
    endMesh = new THREE.Group();
    endMesh.position.y = -lowerLen - r * 0.2;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(r * 2.2, r * 1.7, r * 1.0), endMaterial);
    palm.position.y = -r * 0.85;
    endMesh.add(palm);
    for (let i = 0; i < 4; i += 1) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(r * 0.44, r * 1.25, r * 0.55), endMaterial);
      finger.position.set((i - 1.5) * r * 0.54, -r * 2.1, 0);
      finger.rotation.x = 0.14;
      endMesh.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(r * 0.5, r * 1.0, r * 0.55), endMaterial);
    thumb.position.set(thumbSide * r * 1.3, -r * 0.95, r * 0.1);
    thumb.rotation.z = thumbSide * -0.55;
    endMesh.add(thumb);
  }
  joint.add(endMesh);
  return { pivot, upper, joint, lower, end: endMesh };
}

const HAIR_COLORS = [0x2b2119, 0x4a3120, 0x151515, 0x5e4630, 0x7a5636, 0x3a3a45];

// makePerson 冬季兩項版:上半身收進 torso 樞紐(腰),前傾蹲姿=torso.rotation.x;
// 越野滑雪裝=上下同色連帽;gear=true(選手)加:雪橇板(細長雪板)+背槍(細長步槍斜背)+雙撐杖。
function makePerson({ suit = 0x2f6f4e, trim = 0xf2e9d8, skin = 0xf3cca6, hair = 0x2b2119, hood = true, gender = "m", scale = 1, gear = false } = {}) {
  const group = new THREE.Group();
  const rig = new THREE.Group();
  group.add(rig);
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.62 });
  const pantsMat = suitMat; // 緊身衣:上下一體
  const skinMat = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.78, emissive: 0x8a7355, emissiveIntensity: 0.5 });

  // 腰樞紐:胸/頭/手臂全掛這裡 → 前傾蹲姿只轉一個角
  const torso = new THREE.Group();
  torso.position.y = 1.16;
  rig.add(torso);
  const T = (y) => y - 1.16; // 原立姿座標 → torso 局部

  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.76, 0.32), suitMat);
  chest.position.y = T(1.42);
  torso.add(chest);
  const upperChest = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.18, 0.3), suitMat);
  upperChest.position.y = T(1.7);
  torso.add(upperChest);
  for (const sx of [-1, 1]) {
    const deltoid = new THREE.Mesh(new THREE.SphereGeometry(0.088, 10, 8), suitMat);
    deltoid.position.set(sx * 0.37, T(1.73), 0);
    torso.add(deltoid);
  }
  // 胸前飾條(隊色滾邊,讓紅/綠衣一眼可辨)
  const trimMat = new THREE.MeshStandardMaterial({ color: trim, roughness: 0.6 });
  const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.72, 0.02), trimMat);
  chestStripe.position.set(0, T(1.44), 0.17);
  torso.add(chestStripe);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.1, 0.2, 12), skinMat);
  neck.position.y = T(1.88);
  torso.add(neck);

  // 背槍(冬季兩項標配):細長步槍斜背在背上——槍管細圓柱+木紋槍托,選手才有
  if (gear) {
    const rifle = new THREE.Group();
    const gunMetal = new THREE.MeshStandardMaterial({ color: 0x23201c, roughness: 0.5, metalness: 0.4 });
    const stockMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a, roughness: 0.8 });
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.74, 8), gunMetal);
    barrel.position.y = 0.32;
    rifle.add(barrel);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.1, 0.03), gunMetal);
    sight.position.set(0, 0.6, 0.03);
    rifle.add(sight);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.44, 0.1), stockMat);
    stock.position.y = -0.14;
    rifle.add(stock);
    rifle.position.set(0.06, T(1.42), -0.25);
    rifle.rotation.z = 0.42; // 斜背:上過右肩、下到左腰
    torso.add(rifle);
  }

  const waist = new THREE.Group();
  waist.position.y = 1.16;
  const belly = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.3, 0.27), suitMat);
  belly.position.y = -0.05;
  waist.add(belly);
  const hip = new THREE.Mesh(
    gender === "f" ? new THREE.BoxGeometry(0.48, 0.22, 0.3) : new THREE.BoxGeometry(0.42, 0.2, 0.27),
    pantsMat,
  );
  hip.position.y = -0.26;
  waist.add(hip);
  rig.add(waist);

  // 頭+臉群組:整顆頭(頭球/耳/帽或髮/眼/瞳/眉/嘴)全收進 headGroup,樞紐=頭中心 T(2.12)。
  const headGroup = new THREE.Group();
  headGroup.position.set(0, T(2.12), 0);
  torso.add(headGroup);
  const H = (y) => y - 2.12;

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.25, 18, 18), skinMat);
  head.position.y = H(2.12);
  headGroup.add(head);
  const earL = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 10), skinMat);
  earL.scale.set(0.45, 1, 0.8);
  earL.position.set(-0.245, H(2.11), 0);
  headGroup.add(earL);
  const earR = earL.clone();
  earR.position.x = 0.245;
  headGroup.add(earR);

  // 連帽(緊身衣同色)或髮——★耳前無髮鐵律:帽/髮只坐額頭上緣→頭頂/後腦,兩鬢與耳前留空。
  const capMat = hood ? suitMat : new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 });
  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.265, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.32), capMat);
  hairCap.position.y = H(2.14);
  headGroup.add(hairCap);
  const hairBack = new THREE.Mesh(
    new THREE.SphereGeometry(0.258, 16, 12, EAR_SAFE_PHI.start, EAR_SAFE_PHI.end - EAR_SAFE_PHI.start, Math.PI * 0.12, Math.PI * 0.62),
    capMat,
  );
  hairBack.position.y = H(2.13);
  headGroup.add(hairBack);
  if (!hood) {
    void hair;
  }

  const faceDark = new THREE.MeshBasicMaterial({ color: 0x25201a });
  const faceWhite = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 10), faceWhite);
  eyeL.position.set(-0.09, H(2.18), 0.21);
  headGroup.add(eyeL);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.09;
  headGroup.add(eyeR);
  const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 8), faceDark);
  pupilL.position.set(-0.09, H(2.18), 0.25);
  headGroup.add(pupilL);
  const pupilR = pupilL.clone();
  pupilR.position.x = 0.09;
  headGroup.add(pupilR);
  const browL = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.02, 0.02), faceDark);
  browL.position.set(-0.09, H(2.26), 0.22);
  browL.rotation.z = 0.16;
  headGroup.add(browL);
  const browR = browL.clone();
  browR.position.x = 0.09;
  browR.rotation.z = -0.16;
  headGroup.add(browR);
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.014, 8, 14, Math.PI), faceDark);
  smile.position.set(0, H(2.04), 0.21);
  smile.rotation.z = Math.PI;
  headGroup.add(smile);

  const bootMat = new THREE.MeshStandardMaterial({ color: 0x241c14, roughness: 0.55 });
  const skiMat = new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.45 });
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8a939e, roughness: 0.4, metalness: 0.5 });
  const mkArm = (x) => {
    const arm = createLimb({
      upperMaterial: suitMat, lowerMaterial: suitMat, endMaterial: skinMat,
      upperLen: 0.27, lowerLen: 0.26, upperRadius: 0.07, lowerRadius: 0.058,
      end: "hand", thumbSide: x < 0 ? 1 : -1,
    });
    arm.pivot.position.set(x, T(1.72), 0);
    arm.joint.rotation.x = -0.18;
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), suitMat);
    elbow.position.set(0, -0.27, 0);
    arm.pivot.add(elbow);
    // 撐杖(gear):細長杖握在手裡,末端小雪輪——跟著手臂擺=左右撐杖的畫面
    if (gear) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 1.05, 6), poleMat);
      pole.position.set(0, -0.5, 0.02);
      arm.end.add(pole);
      const basket = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 10), poleMat);
      basket.rotation.x = Math.PI / 2;
      basket.position.set(0, -0.96, 0.02);
      arm.end.add(basket);
    }
    torso.add(arm.pivot);
    return arm;
  };
  const leftArm = mkArm(-0.4);
  const rightArm = mkArm(0.4);
  const mkLeg = (x) => {
    const leg = createLimb({
      upperMaterial: pantsMat, lowerMaterial: pantsMat, endMaterial: bootMat,
      upperLen: 0.40, lowerLen: 0.38, upperRadius: 0.09, lowerRadius: 0.072, // 長腿 v2:腿明顯長於身
      end: "foot",
    });
    leg.pivot.position.set(x, 1.0, 0);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 8), pantsMat);
    knee.position.set(0, -0.4, 0);
    leg.pivot.add(knee);
    // 雪橇板(gear):靴下細長雪板(取代冰刀),板頭微翹
    if (gear) {
      const r = 0.072;
      const ski = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.03, 1.5), skiMat);
      ski.position.set(0, -0.38 - r * 0.95 - 0.02, r * 0.9 + 0.18);
      leg.joint.add(ski);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.03, 0.16), skiMat);
      tip.position.set(0, -0.38 - r * 0.95 + 0.03, r * 0.9 + 0.18 + 0.78);
      tip.rotation.x = -0.5;
      leg.joint.add(tip);
    }
    rig.add(leg.pivot);
    return leg;
  };
  const leftLeg = mkLeg(-0.15);
  const rightLeg = mkLeg(0.15);

  group.scale.setScalar(scale);
  return { group, rig, torso, head, headGroup, waist, leftArm, rightArm, leftLeg, rightLeg, smile };
}

// 滑雪蹲姿基準:前傾+屈膝;動畫在 poseSkater 疊加
function poseSkaterIdle(f) {
  f.torso.rotation.x = 0.5;
  f.rig.position.y = -0.13; // 屈膝把髖壓低,腳貼雪不懸空
  for (const leg of [f.leftLeg, f.rightLeg]) {
    leg.pivot.rotation.x = -0.62;
    leg.pivot.rotation.z = 0;
    leg.joint.rotation.x = 0.86;
  }
  for (const arm of [f.leftArm, f.rightArm]) {
    arm.pivot.rotation.x = -0.35;
    arm.joint.rotation.x = -0.4;
  }
}

export class BiathlonGame {
  constructor({ canvas, touchRoot }) {
    this.canvas = canvas;
    this.touchRoot = touchRoot;

    const settings = loadSettings();
    this.difficulty = DIFFICULTY_PRESETS[settings.difficulty] ? settings.difficulty : "normal";
    this.modeId = GAME_MODES[settings.modeId] ? settings.modeId : "race";
    this.mode = getModeConfig(this.modeId);

    this.input = new InputManager();
    this.input.bindTouchButtons(this.touchRoot);

    this.onHudUpdate = null;
    this.onEvent = null;

    this.running = false; // ★只給主迴圈 RAF 用(athletics this.running 撞名事故鐵則——絕不再宣告同名狀態)
    this.time = 0;
    this.phase = "menu"; // menu | gate | skating | shootIn | shooting | shootOut | ended
    this.message = "在首頁選擇模式與難度後開始。";
    this.cameraView = 0; // 0 跟隨 1 側面轉播(右) 2 高空 3 貼雪 4 側面轉播(左) —— 共 5 視角
    this.autoSaveTimer = 0;
    this.elapsed = 0;
    this.overlay = { visible: false, eyebrow: "", title: "", text: "", canResume: false };
    this.laps = 3;
    this.finishDist = 3 * TRACK_PERIM;

    // ---- 射擊段狀態(★NaN 鏡頭雷:建構子全數字初值,render 迴圈從第 0 幀就在跑) ----
    this.sh = {
      stage: 0, // 0 無 | 1 臥射 | 2 立射
      shots: 0,
      hits: 0,
      misses: 0,
      air: 1, // 氣量 0..1
      holding: false, // 屏息中
      offX: 0, // 準星晃動偏移(m@靶面)——判定=畫面同一組數
      offY: 0,
      t: 0, // 晃動時間軸
      endT: 0, // 5 發打完後的收尾停留
      results: [], // 'hit' | 'miss'
    };
    this.rangeT = 0; // shootIn/shootOut 過場計時

    // ---- three ----
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.04;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xc4dcf0); // 淡藍冬日晴空
    this.scene.fog = new THREE.Fog(0xc4dcf0, 150, 560);

    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 1200);
    this.camPos = new THREE.Vector3(0, 8, -20);
    this.camLook = new THREE.Vector3(0, 1.2, 0);
    this.camera.position.copy(this.camPos);

    this.clock = new THREE.Clock();

    this.setupScene();
    this.buildTargets(DIFFICULTY_PRESETS[this.difficulty].targetR);
    this.resetRacers();
    this.setupInput();

    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.pushHud();
  }

  emitEvent(type, payload = {}) {
    if (this.onEvent) this.onEvent({ type, ...payload });
  }

  // ---------- 場景:雪原橢圓賽道+射擊區(冬季兩項) ----------
  setupScene() {
    const sun = new THREE.HemisphereLight(0xffffff, 0x8ea6bc, 1.25);
    this.scene.add(sun);
    const key = new THREE.DirectionalLight(0xfff4dd, 1.7);
    key.position.set(35, 55, -25);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x9ccbff, 0.7);
    rim.position.set(-25, 30, 25);
    this.scene.add(rim);

    // 雪原地面(場外)
    const snow = new THREE.Mesh(
      new THREE.PlaneGeometry(560, 560),
      new THREE.MeshStandardMaterial({ color: 0xeef4fa, roughness: 1 }),
    );
    snow.rotation.x = -Math.PI / 2;
    snow.position.y = -0.03;
    this.scene.add(snow);

    // 雪道帶狀網格:壓實的雪(比場外雪略灰藍=壓痕感),霧面不反光
    const SEG = 220;
    const pos = [];
    const col = [];
    const idx = [];
    for (let i = 0; i <= SEG; i += 1) {
      const d = (i / SEG) * TRACK_PERIM;
      const a = ovalPoint(d, ICE_HALF_W);
      const b = ovalPoint(d, -ICE_HALF_W);
      pos.push(a.x, 0.02, a.z, b.x, 0.02, b.z);
      const tint = 0.9 + Math.sin(i * 1.7) * 0.015; // 微微壓痕紋
      col.push(tint * 0.93, tint * 0.96, tint * 1.0, tint * 0.93, tint * 0.96, tint * 1.0);
      if (i < SEG) {
        const q = i * 2;
        idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
      }
    }
    const trackGeo = new THREE.BufferGeometry();
    trackGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    trackGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    trackGeo.setIndex(idx);
    trackGeo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(trackGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })));

    // 場心雪白內場(oval 內圈補地)
    const infield = new THREE.Mesh(
      new THREE.PlaneGeometry(STRAIGHT_LEN + BEND_R * 2 - ICE_HALF_W, (BEND_R - ICE_HALF_W) * 2),
      new THREE.MeshStandardMaterial({ color: 0xf5f9fc, roughness: 1 }),
    );
    infield.rotation.x = -Math.PI / 2;
    infield.position.y = 0.005;
    this.scene.add(infield);

    // 雪道壓痕線:內外兩道深壓痕+中央分道壓痕(雪橇軌跡色)
    const mkLaneRing = (off, colorHex, w = 0.14) => {
      const lp = [];
      const li = [];
      for (let i = 0; i <= SEG; i += 1) {
        const d = (i / SEG) * TRACK_PERIM;
        const a = ovalPoint(d, off + w / 2);
        const b = ovalPoint(d, off - w / 2);
        lp.push(a.x, 0.045, a.z, b.x, 0.045, b.z);
        if (i < SEG) {
          const q = i * 2;
          li.push(q, q + 2, q + 1, q + 1, q + 2, q + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
      g.setIndex(li);
      this.scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: colorHex })));
    };
    mkLaneRing(-LANE_LINE_OFF, 0x9db4c8); // 雪道壓痕(灰藍)
    mkLaneRing(0, 0xb3c4d4);
    mkLaneRing(LANE_LINE_OFF, 0x9db4c8);

    // 起終點線(黑白格紋帶,橫跨雪道)+ 終點門
    const finishGroup = new THREE.Group();
    const cells = 10;
    for (let c = 0; c < cells; c += 1) {
      const off = -ICE_HALF_W + (c / cells) * ICE_HALF_W * 2;
      const cellW = (ICE_HALF_W * 2) / cells;
      const p1 = ovalPoint(0, off + cellW * 0.5);
      const t = ovalPoint(0, 0);
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.8, cellW * 0.96),
        new THREE.MeshBasicMaterial({ color: c % 2 === 0 ? 0x1c1e24 : 0xf5f5f5 }),
      );
      plate.rotation.order = "YXZ"; // 先 yaw 對齊路徑方向,再倒平(XYZ 會鋸齒——equestrian 貼片鐵則)
      plate.rotation.y = Math.atan2(t.tx, t.tz);
      plate.rotation.x = -Math.PI / 2;
      plate.position.set(p1.x, 0.05, p1.z);
      finishGroup.add(plate);
    }
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 4.2, 10),
        new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.6 }),
      );
      const pp = ovalPoint(0, s * (ICE_HALF_W + 0.9));
      post.position.set(pp.x, 2.1, pp.z);
      finishGroup.add(post);
    }
    const bannerP = ovalPoint(0, 0);
    const bannerT = Math.atan2(bannerP.tx, bannerP.tz);
    const banner = new THREE.Mesh(
      new THREE.BoxGeometry(ICE_HALF_W * 2 + 1.8, 0.7, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.7 }),
    );
    banner.rotation.y = bannerT;
    banner.position.set(bannerP.x, 4.0, bannerP.z);
    finishGroup.add(banner);
    this.scene.add(finishGroup);

    // 外圍賽道標記(彎道紅白相間)+ 直道低圍欄 + 雪堤
    const padMatA = new THREE.MeshStandardMaterial({ color: 0xd8433c, roughness: 0.85 });
    const padMatB = new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.85 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });
    const bermMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
    let padIdx = 0;
    for (let d = 0; d < TRACK_PERIM; d += 3) {
      const p = ovalPoint(d, ICE_HALF_W + 0.55);
      const yaw = Math.atan2(p.tx, p.tz);
      if (inBendAt(d)) {
        const pad = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1.05, 2.9), padIdx % 2 === 0 ? padMatA : padMatB);
        pad.rotation.y = yaw;
        pad.position.set(p.x, 0.55, p.z);
        this.scene.add(pad);
      } else {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.75, 2.9), railMat);
        rail.rotation.y = yaw;
        rail.position.set(p.x, 0.4, p.z);
        this.scene.add(rail);
      }
      padIdx += 1;
      // 雪堤(更外圈,連綿低丘)
      if (padIdx % 2 === 0) {
        const b = ovalPoint(d, ICE_HALF_W + 2.6);
        const berm = new THREE.Mesh(new THREE.SphereGeometry(1.6, 10, 8), bermMat);
        berm.scale.set(1.6, 0.44, 1.3);
        berm.position.set(b.x, 0.12, b.z);
        this.scene.add(berm);
      }
    }

    // 兩側觀眾看台(直道外)+ 有臉觀眾(冬季厚外套色)
    const standMat = new THREE.MeshStandardMaterial({ color: 0x5f6d80, roughness: 0.85 });
    for (const side of [-1, 1]) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(58, 3.4, 5), standMat);
      stand.position.set(0, 1.7, side * (BEND_R + 10.5));
      this.scene.add(stand);
    }
    this.buildCrowd();

    // 深綠杉樹(雪原冬景,場外一圈)
    const pineMat = new THREE.MeshStandardMaterial({ color: 0x24462f, roughness: 1 });
    const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf2f6fa, roughness: 0.9 });
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3424, roughness: 0.9 });
    for (const [x, z] of [[-62, 18], [-58, -20], [62, 22], [66, -12], [-34, 42], [30, 44], [0, -44], [44, -40], [-46, -40], [76, 4], [-76, -2], [-70, 30], [70, -30], [52, 38]]) {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6), trunkMat);
      trunk.position.set(x, 0.8, z);
      this.scene.add(trunk);
      const pine = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.8, 7), pineMat);
      pine.position.set(x, 3.3, z);
      this.scene.add(pine);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(1.1, 1.7, 7), snowCapMat);
      cap.position.set(x, 4.7, z);
      this.scene.add(cap);
    }

    this.buildRange();

    // 選手(P1 紅=內道;AI 綠=外道)——gear=雪板+背槍+撐杖
    this.p1Figure = makePerson({ suit: SUITS.p1.suit, trim: SUITS.p1.trim, gear: true });
    this.scene.add(this.p1Figure.group);
    this.aiFigure = makePerson({ suit: SUITS.ai.suit, trim: SUITS.ai.trim, skin: 0xe8b98a, gear: true });
    this.scene.add(this.aiFigure.group);
    poseSkaterIdle(this.p1Figure);
    poseSkaterIdle(this.aiFigure);
  }

  // 射擊區(前直道內側):射擊墊×2+白色靶牆(靶排另建,靶大小隨難度)+小罰圈+旗
  buildRange() {
    const rangeGroup = new THREE.Group();
    const matMat = new THREE.MeshStandardMaterial({ color: 0x2b3a52, roughness: 0.9 });
    for (const m of [RANGE_MAT, AI_MAT]) {
      const mat = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.06, 2.4), matMat);
      mat.position.set(m.x, 0.03, m.z);
      rangeGroup.add(mat);
    }
    // 靶牆(白色長板,黑靶掛前面)
    const wallW = TARGET_GAP * (SHOTS_PER_BOUT - 1) + 2.6;
    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(wallW, 1.9, 0.16),
      new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.8 }),
    );
    wall.position.set(RANGE_MAT.x, TARGET_Y, TARGET_Z - 0.14);
    rangeGroup.add(wall);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(wallW + 0.6, 0.12, 1.0),
      new THREE.MeshStandardMaterial({ color: 0x2f4f3f, roughness: 0.8 }),
    );
    roof.position.set(RANGE_MAT.x, 2.15, TARGET_Z - 0.05);
    rangeGroup.add(roof);
    // 罰圈:雪地上的橙色圓環(脫靶就繞它)+告示旗
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(PENALTY_R - 0.55, PENALTY_R + 0.55, 40),
      new THREE.MeshBasicMaterial({ color: 0xe08a3d, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(PENALTY_C.x, 0.04, PENALTY_C.z);
    rangeGroup.add(ring);
    const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.6, 8), new THREE.MeshStandardMaterial({ color: 0xd9dde2 }));
    flagPole.position.set(PENALTY_C.x, 1.3, PENALTY_C.z - PENALTY_R - 1);
    rangeGroup.add(flagPole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.55), new THREE.MeshBasicMaterial({ color: 0xe08a3d, side: THREE.DoubleSide }));
    flag.position.set(PENALTY_C.x + 0.48, 2.3, PENALTY_C.z - PENALTY_R - 1);
    rangeGroup.add(flag);
    this.scene.add(rangeGroup);
  }

  // 靶排:5 個黑色圓靶一排(半徑=難度 targetR=判定半徑,判定=畫面)。打中=倒下+變白。
  buildTargets(radius) {
    if (this.targetGroup) this.scene.remove(this.targetGroup);
    this.targetGroup = new THREE.Group();
    this.targets = [];
    for (let i = 0; i < SHOTS_PER_BOUT; i += 1) {
      const x = RANGE_MAT.x + (i - (SHOTS_PER_BOUT - 1) / 2) * TARGET_GAP;
      const obj = new THREE.Group();
      obj.position.set(x, TARGET_Y - radius, TARGET_Z); // 樞紐放靶底=倒下時繞底邊翻
      const back = new THREE.Mesh(
        new THREE.CircleGeometry(radius * 1.3, 26),
        new THREE.MeshBasicMaterial({ color: 0xffffff }),
      );
      back.position.set(0, radius, -0.02);
      obj.add(back);
      const plate = new THREE.Mesh(
        new THREE.CircleGeometry(radius, 26),
        new THREE.MeshBasicMaterial({ color: 0x14161a }),
      );
      plate.position.set(0, radius, 0.01);
      obj.add(plate);
      this.targetGroup.add(obj);
      this.targets.push({ obj, plate, fallT: -1 });
    }
    this.scene.add(this.targetGroup);
  }

  resetTargets() {
    for (const t of this.targets) {
      t.fallT = -1;
      t.obj.rotation.x = 0;
      t.plate.material.color.setHex(0x14161a);
    }
  }

  buildCrowd() {
    this.crowd = new THREE.Group();
    this.crowdFigures = []; // 收好每個觀眾人偶 + 決定性相位,供 animateCrowd 每幀驅動(舉手歡呼+左右看)
    const coats = [0xd98a3d, 0x3d78d9, 0xc94f8f, 0x4fae6a, 0xb0552f, 0x8a5ac0];
    for (const side of [-1, 1]) {
      for (let i = 0; i < 7; i += 1) {
        const p = makePerson({
          suit: coats[(i + (side > 0 ? 3 : 0)) % coats.length],
          trim: 0xf2e9d8,
          hood: false,
          hair: HAIR_COLORS[(i * 2 + (side > 0 ? 1 : 0)) % HAIR_COLORS.length],
          gender: (i + (side > 0 ? 1 : 0)) % 2 === 0 ? "m" : "f",
          scale: 0.92,
        });
        p.torso.rotation.x = 0.05; // 觀眾站直(不擺蹲姿)
        p.rig.position.y = 0;
        for (const leg of [p.leftLeg, p.rightLeg]) {
          leg.pivot.rotation.x = -0.05;
          leg.joint.rotation.x = 0.1;
        }
        p.group.position.set(-27 + i * 9, 3.4, side * (BEND_R + 8.6));
        p.group.rotation.y = side > 0 ? Math.PI : 0;
        this.crowd.add(p.group);
        this.crowdFigures.push({ fig: p, phase: i * 0.9 + (side > 0 ? 1.7 : 0), rigY: p.rig.position.y });
      }
    }
    this.scene.add(this.crowd);
  }

  animateCrowd() {
    animateCrowdCheer(this.crowdFigures, this.time);
  }

  animateHead(r) {
    const f = r && r.figure;
    if (!f) return;
    // 射擊/過場時不轉頭(要看著靶)
    if (r === this.p1 && ["shootIn", "shooting", "shootOut"].includes(this.phase)) return;
    if (r.aiShooting) return;
    animateIdleHead(f.headGroup, f.smile, this.time, {
      phase: r.glancePhase || 0,
      period: r.glancePeriod || 5.4,
    });
  }

  // ---------- racer 結構(P1/AI 同一套,只差輸入來源;罰圈/射擊狀態也統一) ----------
  mkRacer(figure, lane, label) {
    const isP1 = label === "P1";
    return {
      figure,
      lane,
      label,
      glancePhase: isP1 ? 0 : 2.9,
      glancePeriod: isP1 ? 5.4 : 6.3,
      dist: 0,
      speed: 0,
      strideT: 0,
      lastSide: null,
      lastTapAt: -9,
      rhythm01: 0,
      stumbleT: 0,
      kickT: 9,
      leanHeld: false,
      leanVis: 0,
      lap: 1,
      finished: false,
      finishTime: 0,
      aiTapTimer: 0,
      lastResult: null, // 'perfect' | 'good' | 'fast' | 'same' | null
      // —— 冬季兩項:射擊/罰圈 ——
      boutsDone: 0, // 已完成的射擊段數(0/1/2)
      inPenalty: false,
      penaltyLeft: 0, // 剩餘罰圈距離(m)
      penaltyArc: 0, // 罰圈上已滑弧長(擺位用)
      aiShooting: false,
      aiShootT: 0,
      aiHits: 0,
    };
  }

  resetRacers() {
    this.p1 = this.mkRacer(this.p1Figure, LANE_IN, "P1");
    this.opp = this.mkRacer(this.aiFigure, LANE_OUT, "AI");
    this.aiFigure.group.visible = !!this.mode.race;
    this.p1.dist = 0;
    this.opp.dist = 0;
    this.lastGapSign = 0;
    this.bendWasIn = false;
    this.rhythmCheered = false;
    this.lastLapAnnounced = false;
    this.placeRacer(this.p1, 1);
    this.placeRacer(this.opp, 1);
  }

  // ---------- 輸入 ----------
  setupInput() {
    this.canvas.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      // 觸控/點畫面:出發;滑行中=自動左右交替撐杖;射擊中=開槍(平板孩子單指也能玩)
      if (this.phase === "gate") {
        this.beginRace();
      } else if (this.phase === "skating") {
        const next = this.p1.lastSide === "L" ? "R" : "L";
        this.tapPush(this.p1, next);
      } else if (this.phase === "shooting" && !this.overlay.visible) {
        this.fireShot();
      }
    });
    this.canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  }

  // ---------- 局面控制 ----------
  applyPresentation({ difficulty, modeId }) {
    if (difficulty && DIFFICULTY_PRESETS[difficulty]) this.difficulty = difficulty;
    if (modeId && GAME_MODES[modeId]) {
      this.modeId = modeId;
      this.mode = getModeConfig(modeId);
    }
    saveSettings({ difficulty: this.difficulty, modeId: this.modeId });
    this.message = `${this.mode.label} · ${DIFFICULTY_LABELS[this.difficulty]} 已設定。`;
    this.pushHud();
  }

  openHomeMenu() {
    this.phase = "menu";
    if (this.confetti) {
      for (const c of this.confetti) this.scene.remove(c.mesh);
      this.confetti = [];
    }
    this.message = "在首頁選擇模式與難度後開始。";
    this.overlay.visible = false;
    this.pushHud();
  }

  startSelectedMatch() {
    this.elapsed = 0;
    this.resetRacers();
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.laps = preset.laps;
    this.finishDist = preset.laps * TRACK_PERIM;
    this.buildTargets(preset.targetR); // 靶大小隨難度(判定=畫面)
    this.resetTargets();
    this.sh.stage = 0;
    this.sh.shots = 0;
    this.sh.hits = 0;
    this.sh.misses = 0;
    this.sh.air = 1;
    this.sh.holding = false;
    this.sh.offX = 0;
    this.sh.offY = 0;
    this.sh.t = 0;
    this.sh.endT = 0;
    this.sh.results = [];
    this.rangeT = 0;
    this.cameraView = 0; // 每場回到跟隨視角
    // 起跑鏡頭直接切到選手後方(joash 教訓:lerp 穿場=整幀糊掉)
    const p0 = ovalPoint(0, 0);
    this.camPos.set(p0.x - p0.tx * 9, 4.6, p0.z - p0.tz * 9);
    this.camLook.set(p0.x, 1.2, p0.z);
    this.phase = "gate";
    this.message = "按空白鍵(或點畫面)出發!A/D 左右交替撐杖;第 1、2 圈結束進射擊區(Shift 屏息、J 開槍)!";
    this.emitEvent("match-start", { mode: this.mode.label });
    this.pushHud();
  }

  beginRace() {
    if (this.phase !== "gate") return;
    this.phase = "skating";
    this.p1.speed = 2.2;
    this.opp.speed = 2.2;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.opp.aiTapTimer = preset.ideal * 0.6;
    this.message = "出發!左右交替撐杖——節奏穩才快!";
    this.emitEvent("gate", {});
    this.pushHud();
  }

  // ---------- 節奏撐杖(athletics 節奏判定;滑行段核心,speed-race-kit) ----------
  tapPush(racer, side) {
    if (this.overlay.visible) return;
    if (this.phase === "gate") {
      this.beginRace();
      // 出發那一下也算第一步
    }
    if (this.phase !== "skating" || racer.finished) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const now = this.time;
    const gap = now - racer.lastTapAt;
    racer.lastTapAt = now;

    // 連按同側=踉蹌(溫柔:掉速+短暫無力,不摔倒)
    if (racer.lastSide === side) {
      racer.lastSide = side;
      racer.speed *= 0.8;
      racer.stumbleT = STUMBLE_DUR;
      racer.rhythm01 *= 0.35;
      racer.lastResult = "same";
      if (racer === this.p1) {
        this.message = "連撐同一邊——踉蹌了一下!左右交替才順!";
        this.emitEvent("stumble", { who: racer.label });
      }
      this.pushHud();
      return;
    }
    racer.lastSide = side;

    // 亂節奏:連打太快=腳步打結,小踉蹌
    if (gap < TAP_TOO_FAST) {
      racer.speed *= 0.9;
      racer.stumbleT = STUMBLE_DUR * 0.55;
      racer.rhythm01 *= 0.5;
      racer.lastResult = "fast";
      if (racer === this.p1) {
        this.message = "太急了——撐一下、滑一下,跟著節奏!";
        this.emitEvent("stumble", { who: racer.label, soft: true });
      }
      this.pushHud();
      return;
    }

    let q = clamp(1 - Math.abs(gap - preset.ideal) / preset.tol, 0, 1);
    q = clamp(q + preset.assist * (1 - q), 0, 1); // 幼兒輔助:往好節奏拉
    this.applyPush(racer, q, side);
    racer.rhythm01 = racer.rhythm01 * 0.55 + q * 0.45;
    racer.lastResult = q >= 0.85 ? "perfect" : "good";
    if (racer === this.p1 && racer.rhythm01 > 0.8 && !this.rhythmCheered) {
      this.rhythmCheered = true;
      this.emitEvent("rhythm-good", {});
    }
  }

  applyPush(racer, q, side) {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const weak = racer.stumbleT > 0 ? 0.45 : 1;
    const gain = (preset.maxSpeed * 1.18 - racer.speed) * preset.push * (0.35 + 0.65 * q) * weak;
    racer.speed = Math.min(preset.maxSpeed * 1.05, racer.speed + Math.max(0, gain));
    racer.kickT = 0;
    racer.kickSide = side;
    racer.strideT = side === "L" ? 0.55 : 0.05;
  }

  racerName(racer) {
    return racer === this.p1 ? "你" : "AI";
  }

  // ---------- 射擊段(收割 shooting3d 屏息穩定窗;第 1 次臥射、第 2 次立射) ----------
  startShootIn(stage) {
    this.phase = "shootIn";
    this.rangeT = 0;
    this.sh.stage = stage;
    this.sh.shots = 0;
    this.sh.hits = 0;
    this.sh.misses = 0;
    this.sh.air = 1;
    this.sh.holding = false;
    this.sh.t = 0;
    this.sh.endT = 0;
    this.sh.results = [];
    this.resetTargets();
    this.p1.leanHeld = false;
    this.p1.boutsDone = stage; // 進站即記,避免重複觸發
    this.message = stage === 1
      ? "進入射擊區(臥射)!按住 Shift 屏息、按 J 開槍——5 發 5 靶!"
      : "第二次射擊(立射)——晃動更大,穩住呼吸!";
    this.emitEvent("range-enter", { stage });
    this.pushHud();
  }

  // 屏息穩定窗+開槍判定:準星偏移(offX,offY)=晃動 sin 疊加×(屏息=大減);
  // 命中=偏移量 ≤ 靶半徑(靶半徑=畫面上那顆黑靶的半徑——判定=畫面)。
  fireShot() {
    if (this.phase !== "shooting" || this.sh.endT > 0 || this.sh.shots >= SHOTS_PER_BOUT) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const idx = this.sh.shots;
    const off = Math.hypot(this.sh.offX, this.sh.offY);
    const hit = off <= preset.targetR;
    this.sh.shots += 1;
    if (hit) {
      this.sh.hits += 1;
      this.sh.results.push("hit");
      this.targets[idx].fallT = 0; // 開始倒下
      this.targets[idx].plate.material.color.setHex(0xf5f6f8); // 倒下變白
      this.message = `命中!(${this.sh.hits}/${this.sh.shots})`;
    } else {
      this.sh.misses += 1;
      this.sh.results.push("miss");
      this.message = "脫靶了……穩住呼吸再打!";
    }
    this.emitEvent("shot", { hit, shots: this.sh.shots, hits: this.sh.hits });
    if (this.sh.shots >= SHOTS_PER_BOUT) {
      this.sh.endT = 1.1; // 停留一拍看結果,再滑出去
      this.emitEvent("bout-result", { hits: this.sh.hits, misses: this.sh.misses, stage: this.sh.stage });
    }
    this.pushHud();
  }

  finishBout() {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    this.phase = "shootOut";
    this.rangeT = 0;
    this.sh.holding = false;
    if (this.sh.misses > 0) {
      this.message = `脫靶 ${this.sh.misses} 發——要繞罰圈 ${this.sh.misses * preset.penaltyLen} 公尺!`;
    } else {
      this.message = "五發全中,漂亮!直接回賽道!";
    }
    this.pushHud();
  }

  // 射擊/過場每幀(P1)。氣量:按住 Shift 消耗、放開回復;氣盡=強制換氣(晃動回大)。
  updateRange(delta) {
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    if (this.phase === "shootIn") {
      this.rangeT += delta;
      if (this.rangeT > 1.7) {
        this.phase = "shooting";
        this.message = "瞄準!準星會晃——按住 Shift 屏息穩定,按 J 開槍!";
        this.pushHud();
      }
      return;
    }
    if (this.phase === "shooting") {
      this.sh.t += delta;
      const wantHold = this.input.isDown("breath");
      if (wantHold && this.sh.air > 0) {
        this.sh.holding = true;
        this.sh.air = Math.max(0, this.sh.air - delta / preset.airMax);
        if (this.sh.air === 0) {
          this.sh.holding = false; // 氣盡:強制換氣(溫柔,不懲罰,晃動回大而已)
          this.message = "氣用完了——放開 Shift 換口氣,再屏息!";
        }
      } else {
        this.sh.holding = false;
        this.sh.air = Math.min(1, this.sh.air + delta / (preset.airMax * 0.7));
      }
      // 準星晃動:sin 疊加;立射(stage2)放大;屏息=大減(判定=畫面:鏡頭注視點就用這組偏移)
      const amp = preset.sway
        * (this.sh.stage === 2 ? preset.standMul : 1)
        * (this.sh.holding ? preset.breathCalm : 1);
      this.sh.offX = (Math.sin(this.sh.t * 1.7) + 0.6 * Math.sin(this.sh.t * 2.9 + 1.3)) * amp;
      this.sh.offY = (Math.sin(this.sh.t * 2.3 + 0.7) + 0.6 * Math.sin(this.sh.t * 3.7)) * amp * 0.8;
      if (this.sh.endT > 0) {
        this.sh.endT -= delta;
        if (this.sh.endT <= 0) this.finishBout();
      } else if (this.input.consumePress("fire")) {
        this.fireShot();
      }
      return;
    }
    if (this.phase === "shootOut") {
      this.rangeT += delta;
      if (this.rangeT > 1.5) {
        this.phase = "skating";
        this.p1.speed = 2.0;
        this.p1.lastTapAt = this.time;
        if (this.sh.misses > 0) {
          this.p1.inPenalty = true;
          this.p1.penaltyLeft = this.sh.misses * preset.penaltyLen;
          this.p1.penaltyArc = 0;
          this.message = `罰圈中——繞完 ${Math.round(this.p1.penaltyLeft)} 公尺再回賽道!`;
          this.emitEvent("penalty-start", { who: "P1", misses: this.sh.misses });
        } else if (this.p1.lap >= this.laps && !this.lastLapAnnounced) {
          this.lastLapAnnounced = true;
          this.message = "最後一圈——衝線!";
          this.emitEvent("last-lap", {});
        } else {
          this.message = "回到賽道,繼續踩節奏!";
          this.emitEvent("range-exit", {});
        }
        this.pushHud();
      }
    }
  }

  // AI 射擊:到站停 aiShootTime 秒,按 aiHit 擲 5 發;脫靶照樣吃罰圈(規則對稱)。
  resolveAiShooting(preset) {
    let hits = 0;
    for (let i = 0; i < SHOTS_PER_BOUT; i += 1) if (Math.random() < preset.aiHit) hits += 1;
    const misses = SHOTS_PER_BOUT - hits;
    this.opp.aiHits = hits;
    this.opp.aiShooting = false;
    this.opp.speed = 1.5;
    if (misses > 0) {
      this.opp.inPenalty = true;
      this.opp.penaltyLeft = misses * preset.penaltyLen;
      this.opp.penaltyArc = 0;
    }
    this.emitEvent("ai-shoot-done", { hits, misses });
  }

  // ---------- 完賽 ----------
  finishRace(firstRacer) {
    this.phase = "ended";
    const win = firstRacer === this.p1;
    const timeText = `${this.elapsed.toFixed(1)} 秒`;
    if (!this.mode.race) {
      this.spawnConfetti();
      this.overlay = {
        visible: true,
        eyebrow: "完賽!",
        title: "滑雪+射擊都練到了!",
        text: `${timeText} 完成 3 圈與兩次射擊——冬季兩項就是節奏加冷靜!`,
        canResume: false,
      };
      this.emitEvent("race-end", { win: true, elapsed: this.elapsed });
      this.message = "完賽!再挑戰更高難度!";
    } else {
      if (win) this.spawnConfetti();
      this.overlay = {
        visible: true,
        eyebrow: win ? "勝利!" : "惜敗",
        title: win ? "第一個衝線!" : "AI 先到了……",
        text: win
          ? `${timeText} 衝過終點,把${SUITS.ai.label}甩在後面!滑得穩、打得準!`
          : `差一點!節奏穩一點、射擊多屏息,再來一場追回來!(用時 ${timeText})`,
        canResume: false,
      };
      this.emitEvent("race-end", { win, elapsed: this.elapsed });
      this.message = win ? `勝利!${timeText} 先馳得點!` : "AI 先衝線——再來一場!";
    }
    this.saveGame(true);
    this.pushHud();
  }

  spawnConfetti() {
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (!this.confetti) this.confetti = [];
    const colors = [0xffd24a, 0xff6b81, 0x7de08c, 0x6ec6ff, 0xc890ff, 0xffa050, 0xf5f0e0];
    const p = ovalPoint(this.p1.dist, 0);
    for (let i = 0; i < 150; i += 1) {
      const kind = i % 3;
      const geo = kind === 0
        ? new THREE.PlaneGeometry(0.16, 0.16)
        : kind === 1
          ? new THREE.CircleGeometry(0.1, 6)
          : new THREE.PlaneGeometry(0.06, 0.5);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      }));
      mesh.position.set(p.x + (Math.random() * 2 - 1) * 12, 7 + Math.random() * 6, p.z + (Math.random() * 2 - 1) * 12);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      this.confetti.push({
        mesh,
        vy: 1.2 + Math.random() * 1.6,
        swayA: Math.random() * Math.PI * 2,
        swayF: 1.5 + Math.random() * 2,
        spin: (Math.random() * 2 - 1) * 3,
        t: 0,
      });
    }
  }

  togglePause() {
    if (this.phase === "menu" || this.phase === "ended") return;
    if (this.overlay.visible) {
      this.resume();
    } else {
      this.overlay = { visible: true, eyebrow: "暫停中", title: "喘口氣", text: "雪板也歇一歇,準備好再繼續。", canResume: true };
      this.pushHud();
    }
  }

  resume() {
    if (!this.overlay.canResume) return;
    this.overlay.visible = false;
    this.pushHud();
  }

  cycleCameraView() {
    this.cameraView = (this.cameraView + 1) % 5;
    const names = ["跟隨視角", "側面轉播(右)", "高空俯瞰", "貼雪視角", "側面轉播(左)"];
    this.message = `視角:${names[this.cameraView]}。`;
    this.pushHud();
  }

  // ---------- 主迴圈 ----------
  start() {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      const delta = Math.min(this.clock.getDelta(), 0.05);
      this.update(delta);
      this.render();
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  resize() {
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height || 1.6;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  update(delta) {
    this.time += delta;
    const paused = this.overlay.visible;
    const activePhase = ["skating", "shootIn", "shooting", "shootOut"].includes(this.phase);

    this.handleKeys();

    if (!paused && activePhase) {
      this.elapsed += delta;
      const preset = DIFFICULTY_PRESETS[this.difficulty];

      // —— 玩家輸入:左右交替撐杖 + 傾身(滑行時);方向鍵=solo 別名 ——
      if (this.phase === "skating") {
        if (this.input.consumePress("p1left")) this.tapPush(this.p1, "L");
        if (this.input.consumePress("p1right")) this.tapPush(this.p1, "R");
        if (this.input.consumePress("p2left")) this.tapPush(this.p1, "L");
        if (this.input.consumePress("p2right")) this.tapPush(this.p1, "R");
        this.p1.leanHeld = this.input.isDown("p1lean") || this.input.isDown("p2lean");
      } else {
        this.updateRange(delta); // 射擊段(屏息穩定窗+開槍)
      }

      // —— AI:同一套 racer,輸入來源=節拍器;射擊站/罰圈另管 ——
      if (this.mode.race && !this.opp.finished) {
        if (this.opp.aiShooting) {
          this.opp.aiShootT -= delta;
          if (this.opp.aiShootT <= 0) this.resolveAiShooting(preset);
        } else {
          this.opp.aiTapTimer -= delta;
          if (this.opp.aiTapTimer <= 0) {
            this.opp.aiTapTimer = preset.ideal * (0.92 + Math.random() * 0.18);
            const q = clamp(preset.aiSkill + (Math.random() * 2 - 1) * 0.16, 0, 1);
            const side = this.opp.lastSide === "L" ? "R" : "L";
            this.opp.lastSide = side;
            this.applyPush(this.opp, q, side);
            this.opp.rhythm01 = this.opp.rhythm01 * 0.55 + q * 0.45;
          }
          // AI 傾身:依難度機率記得傾身(幼幼檔 AI 常忘記=彎道是追過牠的機會)
          if (!this.opp.inPenalty && inBendAt(this.opp.dist)) {
            if (this.opp._leanRoll === undefined) this.opp._leanRoll = Math.random();
            this.opp.leanHeld = this.opp._leanRoll < preset.aiLean;
          } else {
            this.opp._leanRoll = undefined;
            this.opp.leanHeld = false;
          }
        }
      }

      // —— 物理:滑行衰減+推進(dist 或罰圈);圈數與射擊站觸發 ——
      for (const r of [this.p1, this.opp]) {
        if (!r.figure.group.visible && r !== this.p1) continue;
        const p1InRange = r === this.p1 && this.phase !== "skating";
        if (r.finished) {
          r.speed = Math.max(0, r.speed - delta * 3); // 衝線後滑行收速
        } else if (p1InRange || r.aiShooting) {
          r.speed = Math.max(0, r.speed - delta * 6); // 進射擊區自動停住
        } else {
          const bend = !r.inPenalty && inBendAt(r.dist);
          const drag = bend && !r.leanHeld ? BEND_DRAG_NOLEAN : BASE_DRAG;
          r.speed *= Math.max(0, 1 - drag * delta);
        }
        r.stumbleT = Math.max(0, r.stumbleT - delta);
        const adv = r.speed * delta;
        if (r.inPenalty) {
          // 罰圈:里程凍結,先把罰圈距離滑完(判定=畫面:人真的繞小圈)
          r.penaltyArc += adv;
          r.penaltyLeft -= adv;
          if (r.penaltyLeft <= 0) {
            r.inPenalty = false;
            r.penaltyLeft = 0;
            if (r === this.p1) {
              this.message = this.p1.lap >= this.laps ? "罰圈完成——最後一圈,衝線!" : "罰圈完成,追回去!";
              this.emitEvent("penalty-done", {});
              if (this.p1.lap >= this.laps && !this.lastLapAnnounced) {
                this.lastLapAnnounced = true;
                this.emitEvent("last-lap", {});
              }
            }
          }
        } else if (!p1InRange && !r.aiShooting) {
          r.dist += adv;
        }
        r.strideT += delta * (0.35 + r.speed * 0.075);
        r.kickT = (r.kickT ?? 9) + delta;
        // 圈數+射擊站觸發(完成第 1、2 圈 → 進站;第 3 圈=衝線圈)
        const lap = Math.min(this.laps, Math.floor(r.dist / TRACK_PERIM) + 1);
        if (lap !== r.lap) {
          r.lap = lap;
          const bout = lap - 1; // 剛完成第 bout 圈
          if (bout >= 1 && bout <= 2 && r.boutsDone < bout) {
            if (r === this.p1) {
              this.startShootIn(bout);
            } else {
              r.boutsDone = bout;
              r.aiShooting = true;
              r.aiShootT = preset.aiShootTime * (0.9 + Math.random() * 0.2);
              this.emitEvent("ai-range", {});
            }
          } else if (r === this.p1 && lap === this.laps && !this.lastLapAnnounced) {
            this.lastLapAnnounced = true;
            this.emitEvent("last-lap", {});
            this.message = "最後一圈——衝啊!";
          }
        }
        // 衝線
        if (!r.finished && r.dist >= this.finishDist) {
          r.finished = true;
          r.finishTime = this.elapsed;
          if (this.phase !== "ended") this.finishRace(r);
        }
      }

      // —— 彎道進出提示(P1,滑行時) ——
      if (this.phase === "skating" && !this.p1.inPenalty) {
        const nowBend = inBendAt(this.p1.dist);
        if (nowBend && !this.bendWasIn) {
          this.emitEvent("bend-enter", { first: !this._bendEverEntered });
          this._bendEverEntered = true;
          if (!this.p1.leanHeld) this.message = "進彎道了——按住 W 傾身,不減速!";
        } else if (!nowBend && this.bendWasIn) {
          if (this._bendLeanGood) this.emitEvent("bend-exit-good", {});
          this._bendLeanGood = false;
        }
        if (nowBend && this.p1.leanHeld) this._bendLeanGood = true;
        this.bendWasIn = nowBend;
      }

      // —— 超越偵測(競賽) ——
      if (this.mode.race && this.phase === "skating") {
        const gapSign = Math.sign(this.p1.dist - this.opp.dist);
        if (gapSign !== 0 && this.lastGapSign !== 0 && gapSign !== this.lastGapSign && Math.abs(this.p1.dist - this.opp.dist) > 0.2) {
          this.emitEvent("overtake", { ahead: gapSign > 0 });
          this.message = gapSign > 0 ? "超越!衝到前面去了!" : "被追過了——加緊節奏追回來!";
        }
        if (gapSign !== 0) this.lastGapSign = gapSign;
      }
    } else if (!paused && this.phase === "gate") {
      if (this.input.consumePress("p1left") || this.input.consumePress("p1right")
        || this.input.consumePress("p2left") || this.input.consumePress("p2right")) {
        this.beginRace();
      }
    }

    // 靶倒下動畫(打中=繞底邊往後翻倒)
    if (this.targets) {
      for (const t of this.targets) {
        if (t.fallT >= 0 && t.fallT < 0.6) {
          t.fallT += delta;
          const k = clamp(t.fallT / 0.42, 0, 1);
          t.obj.rotation.x = -(Math.PI / 2 - 0.14) * (k * k);
        }
      }
    }

    // 彩花
    if (this.confetti && this.confetti.length) {
      for (const c of this.confetti) {
        c.t += delta;
        c.mesh.position.y -= c.vy * delta;
        c.mesh.position.x += Math.sin(c.swayA + c.t * c.swayF) * delta * 1.2;
        c.mesh.rotation.x += c.spin * delta;
        c.mesh.rotation.z += c.spin * 0.7 * delta;
        if (c.t > 5.5) c.mesh.material.opacity = Math.max(0, 0.95 * (1 - (c.t - 5.5) / 1.5));
      }
      this.confetti = this.confetti.filter((c) => {
        if (c.t >= 7 || c.mesh.position.y < -0.5) {
          this.scene.remove(c.mesh);
          return false;
        }
        return true;
      });
    }

    this.poseSkater(this.p1);
    this.poseSkater(this.opp);
    this.animateHead(this.p1);
    this.animateHead(this.opp);
    this.animateCrowd();
    this.placeRacer(this.p1, delta);
    this.placeRacer(this.opp, delta);
    this.updateCamera(delta);

    this.autoSaveTimer += delta;
    if (this.autoSaveTimer > 5) {
      this.autoSaveTimer = 0;
      this.saveGame(true);
    }

    this.input.endFrame();
    this.pushHud();
  }

  handleKeys() {
    if (this.input.consumePress("camera")) this.cycleCameraView();
    if (this.input.consumePress("pause")) this.togglePause();
    if (this.overlay.visible) return;
    if (this.input.consumePress("shoot") && this.phase === "gate") this.beginRace();
  }

  // ---------- 擺位與動畫 ----------
  // 位置用強力平滑 lerp(幀率無關):賽道↔射擊墊↔罰圈之間的轉場都是「滑過去」不是瞬移。
  placeRacer(r, delta = 1) {
    let px;
    let pz;
    let yaw;
    let onTrack = false;
    if (r === this.p1 && ["shootIn", "shooting", "shootOut"].includes(this.phase)) {
      px = RANGE_MAT.x;
      pz = RANGE_MAT.z;
      yaw = Math.PI; // 面向 -z(靶排方向)
    } else if (r.aiShooting) {
      px = AI_MAT.x;
      pz = AI_MAT.z;
      yaw = Math.PI;
    } else if (r.inPenalty) {
      const a = r.penaltyArc / PENALTY_R;
      px = PENALTY_C.x + Math.sin(a) * PENALTY_R;
      pz = PENALTY_C.z + Math.cos(a) * PENALTY_R;
      yaw = Math.atan2(Math.cos(a), -Math.sin(a)); // 切線方向
    } else {
      const p = ovalPoint(r.dist, r.lane);
      px = p.x;
      pz = p.z;
      yaw = Math.atan2(p.tx, p.tz);
      onTrack = true;
    }
    const k = 1 - Math.exp(-delta * 6);
    r.figure.group.position.lerp(new THREE.Vector3(px, 0, pz), k);
    r.figure.group.rotation.order = "YXZ";
    r.figure.group.rotation.y = yaw;
    // 傾身:彎道內傾(inward=局部 +x → 負 roll);踉蹌時左右小晃
    const bend = onTrack && inBendAt(r.dist);
    const leanTarget = bend ? (r.leanHeld ? -0.36 : -0.1) : 0;
    r.leanVis += (leanTarget - r.leanVis) * 0.12;
    let roll = r.leanVis;
    if (r.stumbleT > 0) roll += Math.sin(this.time * 22) * 0.09 * (r.stumbleT / STUMBLE_DUR);
    r.figure.group.rotation.z = roll;
  }

  poseSkater(r) {
    const f = r.figure;
    if (!f.group.visible) return;
    // 射擊姿勢:臥射=趴低、立射=站姿舉槍;AI 到站=立射姿
    const p1Shooting = r === this.p1 && ["shootIn", "shooting", "shootOut"].includes(this.phase);
    if (p1Shooting || r.aiShooting) {
      const prone = p1Shooting && this.sh.stage === 1;
      f.torso.rotation.x = prone ? 1.25 : 0.12;
      f.rig.position.y = prone ? -0.62 : -0.08;
      for (const leg of [f.leftLeg, f.rightLeg]) {
        leg.pivot.rotation.x = prone ? -1.3 : -0.12;
        leg.pivot.rotation.z = 0;
        leg.joint.rotation.x = prone ? 1.5 : 0.18;
      }
      // 雙手前舉(持槍瞄準)
      for (const arm of [f.leftArm, f.rightArm]) {
        arm.pivot.rotation.x = prone ? -0.9 : -1.35;
        arm.pivot.rotation.z = 0;
        arm.joint.rotation.x = -0.5;
      }
      return;
    }
    if (this.phase === "menu" || this.phase === "gate" || (this.phase === "ended" && r.speed < 0.5)) {
      poseSkaterIdle(f);
      // 出發線:半蹲備跑,單臂垂前
      f.leftArm.pivot.rotation.x = -0.2;
      f.rightArm.pivot.rotation.x = -0.55;
      return;
    }
    const sp = r.speed;
    const glide = clamp(sp / 9, 0, 1);
    const cyc = r.strideT * Math.PI * 2;
    const kick = Math.max(0, 1 - (r.kickT ?? 9) / 0.34); // 撐杖瞬間的爆發相
    // 前傾蹲姿:越快壓越低
    f.torso.rotation.x = 0.5 + glide * 0.28 + kick * 0.06;
    f.rig.position.y = -0.13 - glide * 0.045;
    // 左右腿:交替蹬雪(往後外蹬)+回收滑行
    const legs = [[f.leftLeg, 0, -1], [f.rightLeg, Math.PI, 1]];
    for (const [leg, ph, sideSign] of legs) {
      const s = Math.sin(cyc + ph);
      const pushK = Math.max(0, -s); // s<0=這隻腳在蹬
      const isKickLeg = (r.kickSide === "L" && sideSign < 0) || (r.kickSide === "R" && sideSign > 0);
      const kb = isKickLeg ? kick : 0;
      leg.pivot.rotation.x = -0.62 + s * (0.22 + glide * 0.14) + kb * 0.28;
      leg.pivot.rotation.z = sideSign * (pushK * (0.3 + glide * 0.24) + kb * 0.3);
      leg.joint.rotation.x = 0.86 + Math.max(0, s) * (0.24 + glide * 0.2) - kb * 0.3;
    }
    // 手臂:左右交替撐杖(前後大擺=撐杖推進感,杖跟著手臂走)
    const armSwing = 0.6 + glide * 0.4;
    f.leftArm.pivot.rotation.x = -0.5 + Math.sin(cyc + Math.PI) * armSwing;
    f.leftArm.pivot.rotation.z = -0.1;
    f.leftArm.joint.rotation.x = -0.5;
    f.rightArm.pivot.rotation.x = -0.5 + Math.sin(cyc) * armSwing;
    f.rightArm.pivot.rotation.z = 0.1;
    f.rightArm.joint.rotation.x = -0.5;
    // 踉蹌:手臂亂揮平衡
    if (r.stumbleT > 0) {
      const w = r.stumbleT / STUMBLE_DUR;
      f.leftArm.pivot.rotation.z = -0.6 * w + Math.sin(this.time * 18) * 0.35 * w;
      f.rightArm.pivot.rotation.z = 0.6 * w - Math.sin(this.time * 18) * 0.35 * w;
      f.torso.rotation.x = 0.35 + Math.sin(this.time * 15) * 0.08 * w;
    }
  }

  updateCamera(delta) {
    if (this.freeCam) return; // 驗證用:凍結自動運鏡,讓外部自由擺鏡頭(拍正面臉)
    const r = this.p1;
    let desiredPos;
    let desiredLook;
    if (this.phase === "shooting") {
      // 準星視角:鏡頭=槍手眼睛,直視當前靶;晃動直接加在注視點(判定=畫面:準星=螢幕中心)
      const eyeY = this.sh.stage === 1 ? 0.85 : 1.52;
      const idx = Math.min(this.sh.shots, SHOTS_PER_BOUT - 1);
      const tx = RANGE_MAT.x + (idx - (SHOTS_PER_BOUT - 1) / 2) * TARGET_GAP;
      desiredPos = new THREE.Vector3(RANGE_MAT.x, eyeY, RANGE_MAT.z - 1.6); // 鏡頭在選手身前=自己的身體不擋準星視野
      const k2 = 1 - Math.exp(-delta * 8);
      this.camPos.lerp(desiredPos, k2);
      this.camLook.set(tx + this.sh.offX, TARGET_Y + this.sh.offY, TARGET_Z); // 晃動不濾波:準星晃=畫面晃
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camLook);
      return;
    }
    if (this.phase === "shootIn" || this.phase === "shootOut") {
      // 進出射擊區:後上方看選手滑到墊上/滑回賽道
      desiredPos = new THREE.Vector3(RANGE_MAT.x + 2.5, 3.4, RANGE_MAT.z + 7.5);
      desiredLook = new THREE.Vector3(RANGE_MAT.x, 1.0, RANGE_MAT.z - 4);
    } else if (this.phase === "menu") {
      const a = this.time * 0.07;
      desiredPos = new THREE.Vector3(Math.cos(a) * 52, 15, Math.sin(a) * 40);
      desiredLook = new THREE.Vector3(0, 1, 0);
    } else if (r.inPenalty) {
      // 罰圈:外側定點看整個小圈(HUD 同步大字提示)
      desiredPos = new THREE.Vector3(PENALTY_C.x + 1, 7.5, PENALTY_C.z + PENALTY_R + 9);
      const g = r.figure.group.position;
      desiredLook = new THREE.Vector3(g.x, 1.0, g.z);
    } else if (this.cameraView === 0) {
      const p = ovalPoint(r.dist, r.lane);
      let back = 8.8;
      let up = 4.3;
      if (this.mode.race && this.opp.figure.group.visible) {
        const q = ovalPoint(this.opp.dist, this.opp.lane);
        const gap = Math.min(26, Math.hypot(p.x - q.x, p.z - q.z));
        back = 8.8 + gap * 0.42;
        up = 4.3 + gap * 0.2;
      }
      desiredPos = new THREE.Vector3(p.x - p.tx * back, up, p.z - p.tz * back);
      desiredLook = new THREE.Vector3(p.x + p.tx * 7, 1.2, p.z + p.tz * 7);
    } else if (this.cameraView === 1) {
      const p = ovalPoint(r.dist, r.lane);
      const out = ovalPoint(r.dist, r.lane + 13);
      desiredPos = new THREE.Vector3(out.x, 4.2, out.z);
      desiredLook = new THREE.Vector3(p.x, 1.1, p.z);
    } else if (this.cameraView === 2) {
      const p = ovalPoint(r.dist, r.lane);
      desiredPos = new THREE.Vector3(p.x + 3, 30, p.z + 3);
      desiredLook = new THREE.Vector3(p.x + p.tx * 6, 0.5, p.z + p.tz * 6);
    } else if (this.cameraView === 3) {
      const p = ovalPoint(r.dist, r.lane);
      desiredPos = new THREE.Vector3(p.x - p.tx * 1.2, 1.5, p.z - p.tz * 1.2);
      desiredLook = new THREE.Vector3(p.x + p.tx * 12, 1.0, p.z + p.tz * 12);
    } else {
      const p = ovalPoint(r.dist, r.lane);
      const other = ovalPoint(r.dist, r.lane - 13);
      desiredPos = new THREE.Vector3(other.x, 4.2, other.z);
      desiredLook = new THREE.Vector3(p.x, 1.1, p.z);
    }
    const k = 1 - Math.exp(-delta * 3.4);
    this.camPos.lerp(desiredPos, k);
    this.camLook.lerp(desiredLook, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  // 小地圖資料(路線+雙選手+射擊區)
  getMinimapData() {
    if (!this._miniPath) {
      this._miniPath = [];
      for (let i = 0; i <= 100; i += 1) {
        const p = ovalPoint((TRACK_PERIM * i) / 100, 0);
        this._miniPath.push([p.x, p.z]);
      }
    }
    const meG = this.p1.figure.group.position;
    const oppVisible = this.opp.figure.group.visible;
    const oppG = this.opp.figure.group.position;
    const fin = ovalPoint(0, 0);
    return {
      path: this._miniPath,
      me: [meG.x, meG.z],
      opp: oppVisible ? [oppG.x, oppG.z] : null,
      finish: [fin.x, fin.z],
      range: [RANGE_MAT.x, RANGE_MAT.z],
    };
  }

  // ---------- HUD ----------
  pushHud() {
    if (!this.onHudUpdate) return;
    const preset = DIFFICULTY_PRESETS[this.difficulty];
    const phaseLabels = { menu: "主選單", gate: "出發線", skating: "滑行", shootIn: "進射擊區", shooting: "射擊中", shootOut: "回賽道", ended: "完賽" };
    const mins = Math.floor(this.elapsed / 60);
    const secs = (this.elapsed % 60).toFixed(1).padStart(4, "0");
    const bend = this.phase === "skating" && !this.p1.inPenalty && inBendAt(this.p1.dist);
    const racing = this.mode.race && this.phase !== "menu" && this.phase !== "gate";
    let rankText = "—";
    if (racing) {
      rankText = this.p1.dist >= this.opp.dist ? "第 1 位" : "第 2 位";
    }
    const shootingPhase = ["shootIn", "shooting", "shootOut"].includes(this.phase);
    const nextSide = this.p1.lastSide === "L" ? "右 D▶" : this.p1.lastSide === "R" ? "左 ◀A" : "任一側";
    this.onHudUpdate({
      rankText,
      lapText: `${Math.min(this.p1.lap, this.laps)}/${this.laps}`,
      timeText: `${mins}:${secs}`,
      modeLabel: this.mode.label,
      difficultyLabel: DIFFICULTY_LABELS[this.difficulty],
      phaseLabel: phaseLabels[this.phase] || "",
      message: this.message,
      speed01: clamp(this.p1.speed / preset.maxSpeed, 0, 1),
      speedText: `${(this.p1.speed * 3.6).toFixed(0)} km/h`,
      rhythm01: this.p1.rhythm01,
      nextSide,
      lastResult: this.p1.lastResult,
      inBend: bend,
      leanOk: bend && this.p1.leanHeld,
      stumble: this.p1.stumbleT > 0,
      skating: this.phase === "skating",
      race: !!this.mode.race,
      // —— 射擊段 HUD(準星/氣量/靶況;offX/offY 就是命中判定用的同一組數) ——
      shooting: this.phase === "shooting",
      shootingPhase,
      shootStage: this.sh.stage,
      stageLabel: this.sh.stage === 1 ? "臥射" : this.sh.stage === 2 ? "立射" : "",
      air01: this.sh.air,
      holding: this.sh.holding,
      shotResults: this.sh.results.slice(),
      shotsLeft: SHOTS_PER_BOUT - this.sh.shots,
      // —— 罰圈 HUD ——
      penalty: this.p1.inPenalty,
      penaltyLeftText: this.p1.inPenalty ? `${Math.max(0, this.p1.penaltyLeft).toFixed(0)} m` : "",
      gapText: racing
        ? (this.p1.dist >= this.opp.dist
          ? `領先 ${(this.p1.dist - this.opp.dist).toFixed(0)} m`
          : `落後 ${(this.opp.dist - this.p1.dist).toFixed(0)} m`)
        : "—",
      overlay: { ...this.overlay },
    });
  }

  // ---------- 存讀檔(記最佳成績,不存賽中進度) ----------
  saveGame(silent = false) {
    const prev = loadSavedGame() || {};
    const snapshot = { difficulty: this.difficulty, modeId: this.modeId, bestTime: prev.bestTime, bestWin: prev.bestWin };
    if (this.phase === "ended" && this.p1.finished) {
      const better = prev.bestTime === undefined || this.p1.finishTime < prev.bestTime;
      if (better) {
        snapshot.bestTime = this.p1.finishTime;
        snapshot.bestWin = true;
      }
    }
    saveGameState(snapshot);
    if (!silent) {
      this.message = "已存檔。";
      this.pushHud();
    }
  }

  loadGame() {
    const snap = loadSavedGame();
    if (!snap) return false;
    if (DIFFICULTY_PRESETS[snap.difficulty]) this.difficulty = snap.difficulty;
    if (GAME_MODES[snap.modeId]) {
      this.modeId = snap.modeId;
      this.mode = getModeConfig(snap.modeId);
    }
    this.openHomeMenu();
    this.message = snap.bestTime !== undefined
      ? `最佳成績:${snap.bestTime.toFixed(1)} 秒衝線——挑戰它!`
      : "尚無最佳成績,先比一場吧!";
    this.pushHud();
    return true;
  }
}
