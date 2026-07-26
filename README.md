# 冬季兩項 3D(biathlon3d)

> HFPC 3D 系列 B3(2026-07-27)——「冬季兩項」=A1 射擊+A2 速滑的拼裝:
> fork 自 speedskating3d(橢圓雪道+節奏交替撐杖+彎道傾身),收割 shooting3d 的
> 「屏息穩定窗」做射擊段。冬奧皮。

## 玩法

- **單人競賽**:跟 AI 選手比 3 圈;第 1、2 圈結束各進一次射擊段(臥射/立射),
  5 發打 5 靶,每脫靶一發=繞小罰圈;第 3 圈衝線,先到的贏(AI 也吃罰圈)。
- **練習場**:無對手,同賽制自由練手感。

滑行:左右交替按鍵(A/D)=撐杖,節奏穩=越滑越快;連按同側/太急=踉蹌(溫柔,不摔倒);
彎道按住 W 傾身不減速。射擊:準星持續晃動,**按住 Shift=屏息**(晃動大減,氣量條有限,
放開回復),**J=開槍**;打中靶倒下變白,脫靶只繞罰圈、不失敗。

- 難度 4 檔:幼幼(節奏寬+晃動小+靶大+罰圈短)→ 青少年(反之)。
- P1 紅衣、AI 綠衣;雪板/背槍/撐杖/緊身連帽照 3d-figure-kit 鐵則。

## 開發

- `npm run dev`(或 run.bat);`npm run build`;`npx vite preview --port 4183`。
- 烤聲:`node scripts/gen-voice.mjs`(雲哲;跑到 failed 0)。
- 驗證:`node scripts/verify-biathlon.mjs http://localhost:4183 scripts/shots`。
