# CLAUDE.md — biathlon3d(冬季兩項 3D,冬奧皮)

> 2026-07-27 建站:B3 拼裝——fork 自 speedskating3d(A2 速滑,滑行段引擎原封)+
> 收割 shooting3d(A1 射擊)的「屏息穩定窗」做射擊段。
> 賽制:共 3 圈;第 1、2 圈結束自動進射擊區(第 1 次臥射、第 2 次立射晃更大),
> 5 發打 5 靶,每脫靶一發=繞小罰圈一段距離(AI 也吃罰圈);第 3 圈衝線。
> 射擊操作:準星持續晃動(sin 疊加)→ 按住 Shift=屏息(晃動大減、氣量條有限)→ J 開槍。
> 尚未部署;上架時走 CF Pages(/ship-cf,2026-07-19 鐵則:新站一律 Cloudflare)。

## 冬季兩項專屬(改機制先看這)

- 射擊段狀態機:skating →(圈界觸發)shootIn(自動滑進射擊墊)→ shooting(屏息窗)
  → shootOut(滑回賽道)→ skating(脫靶則先 inPenalty 繞罰圈)。全在 game.js:
  `startShootIn/updateRange/fireShot/finishBout`。
- 判定=畫面:命中=|(offX,offY)| ≤ preset.targetR,而 targetR 同時就是 3D 黑靶的
  幾何半徑、鏡頭注視點=靶心+(offX,offY)(準星 DOM 固定螢幕中心)——同一組數。
- 罰圈:`r.inPenalty` 時里程 dist 凍結,速度先消化 penaltyLeft;placeRacer 把人擺在
  PENALTY_C 圓上(判定=畫面:真的繞圈)+HUD penaltyBanner 大字。
- AI 射擊:到站停 aiShootTime 秒,擲 aiHit×5 發,脫靶同樣吃罰圈(規則對稱)。
- 難度 4 檔(kids/child/normal/hard):幼幼=晃動小+靶大+罰圈短+節奏寬;青少年反之。

## 引擎核心(換皮時別動的)

- 賽道=解析式 stadium:`ovalPoint(dist, laneOffset)`(兩直道 55m+兩個 180° 彎 R22,
  周長 ≈248m),一切以「里程 dist」為域;`inBendAt(dist)` 驅動彎道機制。分道=法線偏移
  (內道 −1.9 / 外道 +1.9)。
- 節奏蹬步:`tapPush(racer, side)`——連按同側=踉蹌(×0.8+短暫無力);gap<0.14s=太急;
  否則 `q = 1 - |gap - ideal|/tol`(athletics 同款),`applyPush` 收斂到 maxSpeed。
- 彎道:沒傾身 drag 0.5(溫柔減速)、傾身/直道 drag 0.1(滑行慣性=「蹬一下滑出去」)。
- racer 結構 P1/P2/AI 統一(duel-2p-kit §7C):AI=節拍器輸入,`_isHuman()` 單閘門;
  solo 時 P2 鍵(方向鍵)別名回 P1,不變死鍵。
- `makePerson`:上半身收進 `torso` 樞紐(腰)→ 前傾蹲姿只轉 torso.rotation.x;
  緊身衣上下同色+同色連帽;冰刀=靴下薄長盒;臉部鐵則(眼耳嘴眉)不動。
- 傾身 roll:此參數化下「內側=局部 +x」→ 內傾=**負** rotation.z(placeRacer)。
- `this.running` 只給 RAF(athletics 撞名事故鐵則——絕不再宣告同名狀態)。
- P1 紅衣、P2 藍衣、AI 綠衣(任務拍板;duel-2p-kit 的 P1 藍在本作讓位給任務規格)。

## 本機地雷

- vite preview 接 `| head` 會被 SIGPIPE 收掉——背景跑不要接管線。
- 貼地面片要 `rotation.order="YXZ"` 先 yaw 再倒平(XYZ 會鋸齒)。
- `.bat` 純 ASCII+CRLF(PowerShell 寫);run.bat 用 port 5219 避撞。
- msedge-tts 這台偶爾一句就死:gen-voice.mjs 逐句落盤,重跑到「新產 0」即完成。
- 溝通一律繁體中文。

## 驗證

`npm run build`(檢查 dist/ 有真產物)→ `npx vite preview` →
`node scripts/verify-biathlon.mjs http://localhost:4183 scripts/shots`
(單人 kids/normal、雙人、練習、彎道傾身,全程 0 pageerror 才綠)。

## 部署

尚未部署。beacon 雙平台版已鋪(index.html `window.psPing`,只擋 localhost;
id=biathlon3d,-start/-done 帶 t 秒)。sw.js CACHE_NAME=biathlon-nf1,改版要 bump。
