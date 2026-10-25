# 歷史文物守護行動

以國小五、六年級學生為主要玩家的網頁社會科探究冒險遊戲。八關故事模式依序對應五上、五下各四個單元；教師課堂模式也可直接開啟各單元。

## 開始遊玩

線上版：<https://gameforgraduate0924.web.app>

也可以在自己的電腦上玩：下載 repository 後，以瀏覽器開啟 `index.html`，或直接開啟 `歷史文物守護行動完整版.html`。

遊戲不需要安裝套件或連線到伺服器。

請保留 `question-bank.js`、`curriculum-data.js` 與完整版 HTML 在同一資料夾；遊戲開啟時會先載入題庫與課程對照資料。

若要從 Excel 重新產生題庫，使用安裝了 `openpyxl` 的 Python 執行：

```powershell
python tools/export-question-bank.py "exports/歷史文物守護行動_完整題庫.xlsx"
```

轉換工具會檢查八個單元各 15 題、四個來源選項、逐選項回饋與迷思、證據、遷移情境及考卷來源，再更新 `question-bank.js`。遊戲不會直接讀取 Excel 檔。

## 部署到線上

線上版放在 Firebase Hosting，專案 ID 是 `gameforgraduate0924`（記錄在 `.firebaserc`）。

第一次在一台電腦上部署前，先安裝 Firebase CLI 並登入管理這個專案的 Google 帳號：

```powershell
npm install -g firebase-tools
firebase.cmd login
```

之後每次改完檔案，在專案資料夾執行下面這行就會更新線上版本：

```powershell
firebase.cmd deploy --only hosting
```

在 PowerShell 裡請用 `firebase.cmd`；直接打 `firebase` 可能會被系統的指令碼執行原則擋下。改用命令提示字元（cmd）則可以直接打 `firebase`。

上傳的範圍由 `firebase.json` 決定，只包含遊戲執行需要的檔案：兩個 HTML、`question-bank.js`、`curriculum-data.js`、`cloud-config.js`、`cloud-sync.js`、`assets` 裡的 webp 圖片與字型。企劃文件、PNG 原圖、`tools`、`docs`、`openspec`、`supabase`、檢查腳本與美術提示詞檔都不會上傳。新增遊戲會用到的其他類型檔案時，記得確認它沒有被 `firebase.json` 的 `ignore` 排除。

部署的是資料夾裡目前的檔案，不是 git 上的版本，所以部署前後記得 commit，讓線上版和 repository 保持一致。

## 雲端作答紀錄（Supabase）

學生加入班級後，每一關的作答情況會記錄到雲端資料庫，老師在教師模式輸入班級代碼與管理密碼就能查閱。沒有設定時，遊戲照常運作，不會送出任何資料。

### 第一次設定（只要做一次）

1. 到 <https://supabase.com> 建立免費專案。
2. 在專案的 **SQL Editor** 貼上 `supabase/schema.sql` 整份內容並執行。
3. 到 **Project Settings → API Keys** 複製 **Project URL** 和 **publishable key**（`sb_publishable_` 開頭）。
4. 填進 `cloud-config.js` 的 `url` 與 `publishableKey`，再部署一次。

publishable key 本來就是公開金鑰，可以放在網頁裡；資料表都開啟了 Row Level Security，瀏覽器只能透過 `schema.sql` 裡的函式寫入作答，讀取一定要有班級管理密碼。**不要**把 secret key 或 service_role key 填進 `cloud-config.js`，遊戲偵測到會拒絕使用。

### 課堂使用流程

1. 老師：教師課堂模式 →「雲端班級與學生作答」→ 建立班級，取得 6 碼班級代碼。管理密碼請自行保存，遺失無法查回。
2. 學生：首頁或任務地圖按「加入班級」，輸入班級代碼和座號。資料庫只存座號，不存名字。
3. 老師：同一個畫面輸入班級代碼與管理密碼，查看學生總覽、學習目標掌握度、常選錯的選項與區域學習單，可依關卡篩選、列印或匯出 CSV。

### 記錄的內容

| 類型 | 記錄 |
|---|---|
| 每一場 | 關卡、第幾次挑戰、是否從教師模式進入、選了哪些道具、開始與結束時間、過關或失敗、剩餘守護心、答了幾題 |
| 課前預測 | 同意／不確定／不同意 |
| 單元導讀 | 看了幾頁、回頭幾次、花多久 |
| 探索驗證 | 每個調查點錯幾次才答對、選錯哪些、花多久 |
| 證據對決 | 每題的題號、學習目標、題目來源、首答是否正確、選錯的選項與迷思標籤、第一次作答與答對所花的時間 |
| 道具 | 使用了哪個道具、在哪一題 |
| 隨機事件 | 知識題答對與否 |
| 區域學習單 | 內容、字數、確定程度、課前預測 |

作答先存在瀏覽器的佇列，再分批送出；離線或連線失敗時會保留，下次開遊戲再補送，重送不會重複。

## 內容

- 八個完整關卡與連續劇情，每關名稱對應五上或五下第 1～4 單元
- 每次進關隨機排列探索點、探索線索、題目及答案
- 八關統一為敵人 5 HP、攻擊 1、守護心上限 5；每場準備 10 題且不重複，完成 5 次正確判斷即可過關
- 故事模式延續守護心；教師課堂模式每場恢復為 5 顆，方便比較各單元表現
- 五種可選擇並隨關卡強化的道具
- 最終 Boss 可攜帶兩件道具
- 文物圖鑑、知識卡及最終試玩回饋
- 課前預測、探索驗證、選擇題戰鬥與區域學習單；答題後直接顯示解析，學習單以原始問題為標題、作答提示為副標題
- 五上、五下各四個單元各 15 題；題目與選項取自月考卷 A、月考卷 B、隨堂卷，同場不重複
- 每個答案選項提供對應題目與選項的差異化回饋
- 教師可直接選單元、設定課堂時間、暫停講解及匯出本機學習摘要

## 檔案

- `歷史文物守護行動完整版.html`：目前的完整遊戲
- `question-bank.js`：八單元共 120 題，以及逐選項回饋、迷思、證據與來源資料
- `curriculum-data.js`：上下學期八單元課程定位、學習目標與探究任務
- `tools/export-question-bank.py`：將 Excel 題庫重新轉成 JS 的工具
- `cloud-config.js`：雲端作答紀錄的 Supabase 網址與 publishable key
- `cloud-sync.js`：作答記錄、送出佇列、學生加入班級與教師查閱畫面
- `supabase/schema.sql`：資料表、權限與查詢函式，在 Supabase SQL Editor 執行一次
- `check-cloud.cjs`：雲端作答紀錄的自動檢查
- `歷史文物守護行動第一小關.html`：第一小關原型
- `國小生版畢業專題遊戲構想.docx`：調整後的遊戲企劃文件
