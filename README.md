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

**遊戲更新後**：`schema.sql` 可以重複執行。遊戲新增資料庫功能時（例如班級開放關卡），在 SQL Editor 貼上最新的整份 `schema.sql` 再執行一次即可，既有班級與作答紀錄不會被刪除。

publishable key 本來就是公開金鑰，可以放在網頁裡；資料表都開啟了 Row Level Security，瀏覽器只能透過 `schema.sql` 裡的函式寫入作答，讀取一定要有班級管理密碼。**不要**把 secret key 或 service_role key 填進 `cloud-config.js`，遊戲偵測到會拒絕使用。

### 課堂使用流程

1. 老師：教師課堂模式 →「學生作答分析」→「還沒有班級？建立班級」，填班級名稱、管理密碼，勾選**開放給學生的關卡**，並設定每關隨機作答 **1～15 題**，取得 6 碼班級代碼。管理密碼請自行保存，遺失無法查回。
2. 學生：首頁或任務地圖按「加入班級」，輸入班級代碼和座號。資料庫只存座號，不存名字。加入班級後只能進入老師指定的關卡；包含原本預設開放的第一關在內，其他關卡都會鎖定。沒有加入班級時才使用一般故事模式的依序解鎖規則。
3. 老師：在教師課堂模式的「全班作答分析」輸入班級代碼與管理密碼，查看分析重點（全班首答正確率、需要關心的學生、最需要補強的單元、最多人選錯的選項）、學生總覽、學習目標掌握度、常選錯的選項與區域學習單，可依關卡篩選、列印或匯出 CSV。
4. 老師：上課進度改變時，在全班分析頁最上方的「班級設定」重新勾選開放的關卡並儲存，學生下次打開遊戲就會更新。

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

## 字型

| 用途 | 字型 | 授權 |
|---|---|---|
| 內文、按鈕、表單 | jf open 粉圓（`Game Huninn TC`） | SIL OFL 1.1 |
| 標題 | 思源宋體 Noto Serif TC（`Game Noto Serif TC`） | SIL OFL 1.1 |
| 劇情、線索筆記 | 霞鶩文楷 TC（`Game WenKai TC`） | SIL OFL 1.1 |

為了讓直接開啟 HTML 檔也能顯示字型，三套字型以 base64 內嵌在完整版 HTML 裡，而且只收錄遊戲用到的字。**新增題目或任何畫面文字後**，請重新製作字型，否則新的字會改用系統字型顯示，看起來字體跑掉：

1. 下載三個原始字型檔放在同一個資料夾（不要放進專案）：
   - `jf-openhuninn-2.1.ttf`：<https://github.com/justfont/open-huninn-font/releases>
   - `NotoSerifTC[wght].ttf`：<https://github.com/google/fonts/tree/main/ofl/notoseriftc>
   - `LXGWWenKaiTC-Regular.ttf`：<https://github.com/lxgw/LxgwWenkaiTC/releases>
2. 安裝工具並執行（需要 `pip install fonttools brotli`）：

```powershell
python tools/build-game-fonts.py "放原始字型的資料夾"
```

工具會更新 HTML 裡的內嵌字型、`assets/fonts` 的精簡字型檔，以及 `assets/fonts/game-fonts.json`（每套字型收錄的字）。`check-fonts.cjs` 會比對遊戲畫面上的文字，有缺字時列出來。

## 內容

- 八個完整關卡與連續劇情，每關名稱對應五上或五下第 1～4 單元
- 每次進關隨機排列探索點、探索線索、題目及答案
- 一般故事模式維持敵人 5 HP、攻擊 1、守護心上限 5；加入教師班級後依老師設定的題數進行評量
- 教師班級評量會依建立班級時的設定，從各單元 15 題題庫中不重複抽取 1～15 題；敵人血量與學生守護心等於題數
- 班級評量的道具強度依題數調整：1～5 題為第 1 階、6～10 題為第 2 階、11～15 題為第 3 階
- 教師班級完整評量中，守護心歸零會記錄一次學習支援並回復最多 5 顆，繼續完成剩餘題目
- 學生完成完整評量後會看到加分制學習分數，依完成度、首答正確、穩定作答與剩餘守護心累積；答錯及學習支援只顯示次數，不倒扣分數
- 故事模式延續守護心；教師班級評量每場依老師選擇的題數設定守護心與敵人血量
- 四種戰鬥道具，其中三種可在出發前選擇
- 最終 Boss 可攜帶兩件道具
- 文物圖鑑、知識卡及最終試玩回饋
- 課前預測、探索驗證、選擇題戰鬥與區域學習單；答題後直接顯示解析，學習單以原始問題為標題、作答提示為副標題
- 五上、五下各四個單元各 15 題；題目與選項取自月考卷 A、月考卷 B、隨堂卷，同場不重複
- 每個答案選項提供對應題目與選項的差異化回饋
- 教師課堂模式以分析學生作答表現為主：全班作答分析（雲端、依座號）與本機作答分析；需要講解時可暫停畫面
- 老師可替每個班級設定開放的關卡，學生不必照順序破關就能玩到上課進度的單元

## 檔案

- `歷史文物守護行動完整版.html`：目前的完整遊戲
- `question-bank.js`：八單元共 120 題，以及逐選項回饋、迷思、證據與來源資料
- `curriculum-data.js`：上下學期八單元課程定位、學習目標與探究任務
- `tools/export-question-bank.py`：將 Excel 題庫重新轉成 JS 的工具
- `tools/build-game-fonts.py`：重新製作內嵌字型，收齊遊戲用到的每一個字
- `check-fonts.cjs`：檢查內嵌字型有沒有缺字
- `cloud-config.js`：雲端作答紀錄的 Supabase 網址與 publishable key
- `cloud-sync.js`：作答記錄、送出佇列、學生加入班級與教師查閱畫面
- `supabase/schema.sql`：資料表、權限與查詢函式，在 Supabase SQL Editor 執行一次
- `check-cloud.cjs`：雲端作答紀錄的自動檢查
- `歷史文物守護行動第一小關.html`：第一小關原型
- `國小生版畢業專題遊戲構想.docx`：調整後的遊戲企劃文件
