# near-afterlight 實作決定帳本

## Ticket 03 criterion 3.4 UI worker — 與程式碼同一個 3.4 commit（base c687978，2026-11-08）

來源：Ticket 03 criterion 3.4 的 Herdr worker session（Opus 5.5 Max）。開工時的 1a（共用斷電解剖文字）與 2a（把驗收步驟寫進 Verification Log）由 main 判讀決定，對話裡沒有使用者原話；worker 開工時列出的 1–10 號假設也沒有經過使用者確認。

### 八類掃描

| 類別 | 有／無 | 條目 |
|---|---|---|
| 資料形狀與格式 | 有 | #4、#5、#7、#17 |
| 存放位置與命名 | 有 | #1、#18 |
| API 契約與錯誤行為 | 有 | #6、#19 |
| 新增的相依套件 | 有 | #12（`package.json` 沒變；next/font 在 build 時下載 Google Fonts） |
| 並行與效能取捨 | 有 | #6（頁面載入預算三個劇本、fetch 沒有逾時）、#15（每回合 350 ms 播放）、#21 |
| 範圍解讀 | 有 | #2、#3、#9、#10、#11、#13、#14、#16、#20 |
| 測試設定改動 | 無 | 測試檔與測試設定都沒動。3.4 照票上約定的 test seam（API route 與 README）不新增測試，介面改用 build、react-doctor、LCU 截圖驗收 |
| 會被照抄的模式 | 有 | #4、#5、#7、#19 |

### #1 斷電解剖文字搬到 src/ 共用

- **何時**：3.4 commit（`src/scenarios/collapse-autopsy.ts:14`、`app/api/simulate/route.ts:1-9`）
- **決定**：觸發：手動遊玩時站點斷電，介面也要顯示死因說明。但 `buildCollapseAutopsy` 寫在 route 檔裡，而 Next.js 不允許 route 檔另外 export 函式，介面拿不到。現在：函式本體逐字搬到 `src/scenarios/collapse-autopsy.ts`，API 和介面都 import 同一份。沒選的做法：介面自己另寫一份死因文字，同一個死因會有兩份措辭，以後可能對不上。
- **規格缺口**：brief 只列了三個 app 檔，沒說斷電說明的文字從哪裡來。
- **影響範圍**：之後改死因文案只要改一處。route 的回應內容沒變，由原本 14 個測試保護。
- **判定**：sound — main 判讀選 1a（不是使用者原話）；搬移前後的函式本體 diff 只差 `export`。
- **把握度**：高

### #2 攻擊模擬在副本上試跑，不動到正在玩的局

- **何時**：3.4 commit（`app/deck-session.ts:339`）
- **決定**：觸發：每張設備卡都有「Simulate Exploit」按鈕，要當場展示洗磨損和越權盜轉被擋下的收據。現在：拿目前畫面上的狀態做副本，跑兩個探針：擁有者把 NFT 轉給自己的分身帳號 `wash-sybil.afterlight.testnet`，以及中繼者用自己的信封把 NFT 轉給自己。收據寫進卡片和 NEP-366 紀錄，正在玩的局面和指揮官的 nonce 都不變。沒選的做法：真的執行轉手；洗磨損那次會把 NFT 轉走，玩家的局面跟著被改掉。
- **規格缺口**：spec 和 brief 只說要展示攔截收據，沒說要不要改動遊戲狀態。
- **影響範圍**：探針收據只是示範，不進回合帳本；評審連按幾次也不會弄亂局面。
- **判定**：sound — 這個按鈕是用來展示守衛，不是讓玩家操作遊戲。
- **把握度**：高

### #3 只有 Commander A 持有的設備能按「Handover NFT to Operator B」

- **何時**：3.4 commit（`app/deck-session.ts:291`、`app/command-deck.tsx:578`）
- **決定**：觸發：開局時 `bat-beta-2` 和 `o2-scrubber-1` 本來就屬於 Operator B，「轉給 B」對它們沒有意義。現在：玩家扮演 Commander A，只能轉出自己持有的設備。B 持有的卡，按鈕停用並顯示「Held by Operator B」；設備轉出去之後收不回來，要按 Reset 才會重置。沒選的做法：做成雙座位，讓玩家也能代 B 簽名把設備轉回 A，這需要再多一套 B 的會話金鑰和介面。
- **規格缺口**：spec 只寫了按鈕名稱，沒寫哪些卡能按、轉完能不能轉回來。
- **影響範圍**：開局只有 `gen-solar-1`、`bat-alpha-1` 兩張卡能示範轉手。
- **判定**：sound — 符合「玩家只能動自己的資產」這個安全敘事；按鈕文字沿用票上的寫法。
- **把握度**：中

### #4 每個玩家操作都包成 NEP-366 信封，先過守衛再進引擎

- **何時**：3.4 commit（`app/deck-session.ts:171`、`:206`、`:254`）
- **決定**：觸發：頂部膠囊寫著「NEP-366 Gasless Session (0 Popups)」，評審抽屜也要看得到簽章收據。現在：調電價、調準備金、移防電池、推進回合、轉手，每個操作都產生一個信封，再交給 `verifyAndExecuteNep366Delegate`。信封內容如下：
  - sender 是 Commander A，relayer 是 `relayer.afterlight.testnet`，存款 0。
  - nonce 每次加 1，被拒的操作也會用掉一個 nonce。
  - 模擬區塊高度從 182,400,000 起算，信封有效期是之後 120 個區塊。
  - 簽章用 repo 現有的確定性模擬字串；抽屜裡寫明不會送出 testnet 交易。

  沒選的做法：直接呼叫 `applyStationAction`，那膠囊上的宣稱就沒有任何程式支撐。
- **規格缺口**：spec 沒定義介面要不要真的走守衛、nonce 怎麼遞增、區塊高度從哪裡來。
- **影響範圍**：之後新增任何玩家操作，都要照這個模式包信封。區塊高度只是裝飾用的數字。
- **判定**：sound — 守衛和引擎都是既有的純函式，介面沒有手寫任何規則。
- **把握度**：中

### #5 每次中繼都跑一次 Oracle，P3 的判定取自 Oracle

- **何時**：3.4 commit（`app/deck-session.ts:206`）
- **決定**：觸發：轉手收據要寫「P3 preserved」，攻擊模擬要寫「P3 Non-Laundering Enforced」。現在：每個信封執行完都呼叫 `evaluateAfterlightOracleStep`，檢查 P1–P4 四個不變量。紀錄裡顯示「oracle P1–P4 ✓」或被違反的編號，P3 的字樣只在 Oracle 判定成立時出現。沒選的做法：介面自己比對磨損、準備金的前後值，等於在 app/ 裡重寫一份 P3 規則。
- **規格缺口**：spec 只說抽屜要顯示 P1–P4 的計數，沒說介面能不能每一步即時驗證。
- **影響範圍**：Oracle 的判定邏輯一改，介面上的字樣就跟著變。每一步會多跑一次 Oracle，只有四台設備，成本可以忽略。
- **判定**：sound — 介面上的安全宣稱由獨立驗證器背書。
- **把握度**：高

### #6 劇本走 POST /api/simulate，失敗時改用瀏覽器端引擎並標示來源

- **何時**：3.4 commit（`app/deck-session.ts:62`、`:469`）
- **決定**：觸發：brief 要求「搭配 POST /api/simulate」，但評審點劇本時不能卡住。現在的流程：
  1. 頁面載入時，先在瀏覽器把三個劇本各跑一次，用來顯示膠囊上的結局，例如「TURN 4 ECLIPSE BLACKOUT」。
  2. 點劇本時向 API 要資料，並比對 API 回傳的回執和瀏覽器算的是否一致，一致就顯示「receipts match client engine」。
  3. API 回錯誤碼、連不上或格式不對時，改用瀏覽器算好的結果，並標示「Local engine replay」。
  4. 請求被接受、但伺服器永遠不回應的情況沒有涵蓋，因為 fetch 沒有設逾時。

  沒選的做法：只靠 API，API 一壞劇本就沒反應；只用瀏覽器端計算，API 就完全沒在介面上用到。
- **規格缺口**：spec 沒說劇本資料從哪裡來，也沒說失敗時怎麼處理。
- **影響範圍**：頁面載入時多跑三次 14 回合模擬。之後改 API 的回應格式時，要同步改 `isSimulationPayload`。
- **判定**：sound — 資料來源有標示出來，失敗不會被藏住；沒設逾時已記為已知限制（M2）。
- **把握度**：中

### #7 白晝／日蝕時間表取自引擎實跑的存活劇本

- **何時**：3.4 commit（`app/deck-session.ts:65`）
- **決定**：觸發：14 格時間軸和「下一回合是日蝕」的提示，都要知道每一回合的相位，但引擎沒有提供相位函式。現在：讀存活劇本 03 的 14 張回執，取出每回合的相位當作時間表，不在介面裡寫「奇數回合是白晝」。沒選的做法：介面自己寫奇偶規則，等於重寫一次引擎的軌道排程。
- **規格缺口**：引擎沒有提供「第 N 回合是哪個相位」的查詢。
- **影響範圍**：如果劇本 03 以後改成撐不滿 14 回合，缺少的格子會被當成白晝顯示；到時應改由引擎直接提供相位函式。
- **判定**：sound — 在不改引擎的前提下，這是最不容易出錯的來源。
- **把握度**：中

### #8 軌道日數用「回合 ÷ 2 無條件進位」顯示

- **何時**：3.4 commit（`app/command-deck.tsx:99`）
- **決定**：觸發：標題列要顯示「ORBITAL DAY d/7」。現在：日數是回合數除以 2 後無條件進位，總日數是 14 ÷ 2。沒選的做法：從 #7 的時間表數白晝格，寫法比較繞，結果相同。
- **規格缺口**：spec 只寫「14 個半軌道回合等於 7 個軌道日」。
- **影響範圍**：介面另外寫了一次「一天兩回合」的前提；審查有點出這件事，但沒有列為 finding。
- **判定**：sound — 純顯示換算，數字直接來自 spec。
- **把握度**：中

### #9 磨損警示門檻設在臨界值 6000 bps 的 25% 和 40%

- **何時**：3.4 commit（`app/command-deck.tsx:78`）
- **決定**：觸發：brief 要求磨損高時顯示裂紋和火花。但實測發現，沒做維修的局會在 2400 bps 左右就因電池耗盡而斷電，永遠到不了 6000。現在：1500 bps 起顯示琥珀色和裂紋，2400 bps 起顯示紅色和火花。沒選的做法：用臨界值的 50% 和 75%（3000、4500），正常遊玩永遠看不到警示。
- **規格缺口**：spec 沒定義警示門檻。
- **影響範圍**：劇本 01 的斷電畫面會出現火花。之後引擎調整磨損速度時，要重新檢查這兩個門檻。
- **判定**：sound — 門檻依實測的磨損範圍設定。
- **把握度**：中

### #10 音效預設開啟

- **何時**：3.4 commit（`app/use-command-deck.ts:104`）
- **決定**：觸發：brief 要求點擊時要有遊戲回饋音，也要有靜音開關。現在：預設有聲，右上角有靜音鍵。瀏覽器規定第一次點擊之後才能建立音效。沒選的做法：預設靜音，評審得先找到開關才聽得到音效。
- **規格缺口**：spec 只說要有音效和靜音開關，沒說預設是開還是關。
- **影響範圍**：評審第一次點擊就會出聲。
- **判定**：needs-user — 這屬於產品品味。暫定做法：預設開啟。撤回方式：把 `app/use-command-deck.ts:104` 的 `useState(false)`（也就是 muted 的初始值）改成 `true`。
- **把握度**：中

### #11 用 `<main translate="no">` 關閉瀏覽器自動翻譯

- **何時**：3.4 commit（`app/page.tsx:10`）
- **決定**：觸發：實測使用者的 Chrome 會把介面自動翻成中文，「0% Skim」變成「脫脂」、SURGE 變成「湧」，和引擎代號對不起來。現在：整個介面標記為不翻譯。沒選的做法：允許翻譯，非英語使用者能讀懂一般文字，但遊戲代號會被翻壞。
- **規格缺口**：spec 沒提多語系或翻譯。
- **影響範圍**：非英語的評審沒辦法用瀏覽器自動翻譯閱讀介面。
- **判定**：sound — 介面上到處是引擎代號，機器翻譯的壞處大於好處。
- **把握度**：中

### #12 用 next/font 載入 Oxanium 和 JetBrains Mono

- **何時**：3.4 commit（`app/page.tsx:4-5`、`app/globals.css:37-40`）
- **決定**：觸發：要做出科幻指揮艙的質感。現在：build 時從 Google Fonts 下載兩套字型並自行託管，網頁執行時不會連到 Google。字型變數宣告在 `.deck-root`；審查發現原本放在 `:root` 會讓字型完全沒套上，已經修正並在瀏覽器實測確認。沒選的做法：只用系統字型，不需要網路，但質感較差。
- **規格缺口**：spec 沒有指定字型。
- **影響範圍**：`next build` 需要能連上 Google Fonts。之後新增的樣式應沿用 `var(--display)` 和 `var(--mono)`。
- **判定**：sound — 沒有新增 npm 套件，網頁執行時也沒有外部請求。
- **把握度**：高

### #13 存活結局畫成日出

- **何時**：3.4 commit（`app/deck-session.ts:406`、`app/station-stage.tsx:165`、`:497`）
- **決定**：觸發：第 14 回合是日蝕，照實畫的話，勝利畫面會是一片黑。現在：狀態變成 SURVIVED 時，天空換成日出、太陽能板被晨光照亮、文字寫 SUNRISE；回執數據仍然顯示第 14 回合的日蝕數字。沒選的做法：照第 14 回合畫成日蝕，勝利畫面會和斷電畫面一樣暗。
- **規格缺口**：spec 沒定義存活時的畫面。
- **影響範圍**：截圖 01 就是這個畫面。這只是呈現方式，不影響數據。
- **判定**：sound — 呼應專案名 Afterlight（長夜之後的光），數據沒有被改動。
- **把握度**：中

### #14 第 0 回合就先把太陽能板點亮

- **何時**：3.4 commit（`app/station-stage.tsx:369`）
- **決定**：觸發：開局還沒有任何回執，太陽能板全暗，第一眼看起來像沒在運作。現在：第 0 回合如果天空是白晝，板子先亮起並出現光粒子，文字寫「SUN LOCKED」，不顯示任何發電數字。沒選的做法：維持全暗，評審在 30 秒內的第一印象會比較差。
- **規格缺口**：spec 沒定義開局畫面。
- **影響範圍**：純呈現，不影響數據。
- **判定**：sound — 沒有編造發電數字。
- **把握度**：中

### #15 回放時鎖住控制台，只有 Reset 能回到即時指揮

- **何時**：3.4 commit（`app/deck-session.ts:414`、`app/use-command-deck.ts:135`）
- **決定**：觸發：回放顯示的是劇本的快照；如果玩家在中途調電價，接下來要從哪裡接續並不明確。現在：
  - 回放時，控制台顯示劇本在該回合的設定，但全部鎖住。
  - 點劇本後會自動播放，每回合 350 ms；可以點時間軸跳到任一回合。
  - 只有按 Reset Station 能回到即時模式，而且是從頭開始。

  沒選的做法：允許「從這一回合接手指揮」，那需要另外設計分支狀態。
- **規格缺口**：spec 只寫了一鍵快轉和點回合定格，沒寫回放和即時模式之間怎麼切換。
- **影響範圍**：如果之後要做「從某回合接手指揮」，需要另開一張票。
- **判定**：sound — 這是最簡單、也不會出現模糊狀態的做法。
- **把握度**：中

### #16 斷電解剖改成接在舞台下方的報告條

- **何時**：3.4 commit（`app/command-deck.tsx:182`、`app/globals.css:936`）
- **決定**：觸發：疊在舞台上的橫幅會蓋住熄燈的穹頂，而那正是斷電時最重要的畫面。現在：報告接在舞台框的底部，列出三個死因標籤並亮起真正的死因，再附上引擎回執的數據。沒選的做法：疊在舞台上方，穹頂會被遮住。
- **規格缺口**：spec 只說要有單一死因的橫幅，沒說放在哪裡。
- **影響範圍**：斷電時，時間軸會往下移一段距離。
- **判定**：sound — 依實際截圖的效果調整。
- **把握度**：高

### #17 介面只顯示合約路徑 `contracts/` 之後的部分

- **何時**：3.4 commit（`app/command-deck.tsx:782`）
- **決定**：觸發：`/api/verify` 回傳的是伺服器上的絕對路徑，本機執行時會露出使用者的家目錄。現在：畫面只顯示從 `contracts/` 開始的部分；API 的回應本身沒改，已記為 Minor。沒選的做法：照原樣顯示絕對路徑。
- **規格缺口**：spec 沒規定路徑要怎麼顯示。
- **影響範圍**：API 仍然回傳絕對路徑。
- **判定**：sound — 只改顯示方式，沒有越界去改 3.3 的 API。
- **把握度**：高

### #18 把介面拆成 app/ 底下五個模組

- **何時**：3.4 commit（`app/command-deck.tsx`、`app/deck-session.ts`、`app/use-command-deck.ts`、`app/station-stage.tsx`、`app/tactical-audio.ts`）
- **決定**：觸發：全部寫在一個約 1,500 行的檔案裡時，react-doctor 報了「元件過大」和「複雜度過高」。現在：畫面、純邏輯（信封、Oracle、回放）、狀態 hook、SVG 舞台、音效各自獨立成一個檔。沒選的做法：全部塞進 brief 列出的 `command-deck.tsx`。
- **規格缺口**：票上只列了三個檔名。
- **影響範圍**：之後改邏輯看 `deck-session.ts`，改畫面看 `command-deck.tsx`。
- **判定**：sound — react-doctor 回到 0 個 issue，行為沒有改變。
- **把握度**：中

### #19 引擎沒執行的探針顯示「未執行」，不打勾

- **何時**：3.4 commit（`app/command-deck.tsx:616`、`:623`）
- **決定**：觸發：審查發現，站點斷電後按攻擊模擬，引擎會拒絕所有探針，畫面卻打勾宣稱 P3 擋下了洗磨損。現在：引擎因為其他原因拒絕時，顯示「not executed … P3 not exercised」，並用中性的「–」標記；只有真的執行並通過時才打勾。沒選的做法：斷電時直接停用按鈕。
- **規格缺口**：spec 沒定義站點斷電（終止狀態）時的攻擊模擬該怎麼呈現。
- **影響範圍**：之後新增探針時，要沿用「沒有實際執行就不能打勾」這條規則。
- **判定**：sound — 安全宣稱必須有實際執行來支撐。
- **把握度**：高

### #20 準備金三檔在介面裡直接寫死成 0、2000、4000 bps

- **何時**：3.4 commit（`app/command-deck.tsx:45`）
- **決定**：觸發：Ticket 01 做 YAGNI 精簡時刪掉了 constants 裡的準備金檔位常數，但介面需要三個按鈕。現在：直接寫成 0%、20%、40%，對應 0、2000、4000 bps，數值依照 spec 的 SKIM_0、STANDARD_20、FORTIFY_40。沒選的做法：在 constants 裡加回常數，這要改到 Ticket 01 的檔案。
- **規格缺口**：spec 有檔位名稱，但程式裡沒有可以 import 的來源。
- **影響範圍**：如果引擎改了檔位數值，介面要同步修改。
- **判定**：sound — 這三個檔位是政策選項，不是物理公式。
- **把握度**：中

### #21 NEP-366 紀錄只保留最近 12 筆

- **何時**：3.4 commit（`app/deck-session.ts:33`）
- **決定**：觸發：每個操作都會產生一筆信封紀錄，玩久了會無限增加。現在：抽屜只保留最近 12 筆，攻擊探針的紀錄也算在內。沒選的做法：全部保留，抽屜會越拉越長，記憶體也持續增加。
- **規格缺口**：spec 沒定紀錄上限。
- **影響範圍**：比較早的信封在畫面上看不到。
- **判定**：sound — 抽屜是即時檢視用的，不是稽核帳本。
- **把握度**：高

**合併計數**：另有 8 條內部命名和外觀選擇，不逐條列出：
- 配色與動畫時長。
- 按鈕文案沿用 brief 的「Run Judge Verification」和「Simulate Exploit: Wash Wear / Unauthorized Siphon」。
- 分身帳號名稱。
- 抽屜開關放在右下角。
- 主音量 0.22。
- 斷電警報延後 0.25 秒響。
- 星空採用低差異序列排列。
- 舞台 viewBox 是 1200×640。

**規格霧區建議**：「範圍解讀」類有 9 條集中在介面狀態，包括開局畫面、回放模式、斷電之後能做哪些操作、存活畫面。建議回 spec 補一段「介面狀態」定義，之後不要再逐條由實作者自行判定。

## Ticket 03 YAGNI 裁剪與抽屜位置 — commit 89bbf46（2026-11-08）

來源：同一個 worker session，處理 `ticket-yagni-runner` 的裁決（keep 58、demote 29、kill 3），以及 main 判讀要求的抽屜位置修正（不是使用者原話）。本段沒有另外跑 auto-choice 的 self-verify 稽查。

已被推翻的上一段決定，不重判，只標記現況：
- #6：本機備援和「receipts match client engine」比對都已刪除，API 失敗時改成畫面不變（見 #23）。
- #15：播放鍵改成只能重播，沒有暫停。
- #21：紀錄欄位刪掉沒用到的 `relayerSignerId`、`maxBlockHeight`，12 筆上限不變。
- 音效從 9 種減為 brief 列出的 6 種。

### #22 YAGNI 裁決中 22 項有明文依據的保留不砍

- **何時**：89bbf46（處置逐條記在 `.scratch/afterlight/issues/03-api-routes-and-opus-station-deck.md` 的 Verification Log）
- **決定**：觸發：YAGNI runner 只拿票的原文判斷，沒讀到 brief，所以把 brief 和 spec 明文要求的東西歸成「模型自行推導」。現在：只砍掉純屬 worker 自己加的 10 項；有明文依據的 22 項保留，並在 Verification Log 逐條引用原文。保留的依據包括：
  - 點回合定格、三種指定音效：brief 有寫。
  - NEP-366 信封與越權盜轉探針：spec Story 4、Solution 3 和 brief 都有寫。
  - 型別檢查：TypeScript 規則要求網路回應要先檢查型別。
  - postcss 骨架：main 的 3.1 commit 建立的。

  沒選的做法：照裁決全部刪除，會拿掉 brief 點名的功能。
- **規格缺口**：票的 3.4 只有一行摘要，brief 的詳細要求沒有寫進票裡。
- **影響範圍**：main 做 review-implement 時，可能會把這些項目再列為要刪。
- **判定**：needs-user — 要不要照 brief 保留，是 main／使用者的範圍決定。暫定做法：保留。撤回方式：依 `verdict.json` 刪掉對應的函式和音效，再跑一次 `npm test` 和 `next build`。
- **把握度**：中

### #23 劇本載入失敗時畫面不變

- **何時**：89bbf46（`app/deck-session.ts` 的 `fetchReplayRun`、`app/use-command-deck.ts` 的 `loadPreset`）
- **決定**：觸發：YAGNI 砍掉本機備援之後，`/api/simulate` 一失敗就沒有資料可以回放。現在：膠囊的「SIMULATING…」消失，畫面停在原本的狀態，不顯示錯誤訊息。沒選的做法：另外加一個錯誤提示，那等於新增 YAGNI 剛砍掉的那類失敗處理。
- **規格缺口**：spec 沒說劇本載入失敗時要怎麼呈現。
- **影響範圍**：API 掛掉時，評審點劇本會像沒反應一樣。
- **判定**：sound — 同一份 build 的同源 API 很少失敗，失敗時按 Reset 或再點一次就好。
- **把握度**：中

### #24 評審抽屜改成頁面底部的一般區塊

- **何時**：89bbf46（`app/globals.css` 的 `.inspector`）
- **決定**：觸發：main 判讀指出，固定在畫面底部的抽屜開關會蓋住右欄的「Advance 1 Orbital Turn」按鈕。現在：抽屜放在頁面最下方，展開時往下延伸，任何視窗高度都不會遮住內容。沒選的做法：保留固定位置、改放到別的角落，換個角落一樣會蓋到其他內容。
- **規格缺口**：spec 只寫「collapsible drawer」，沒說是固定在畫面上還是跟著頁面捲動。
- **影響範圍**：評審要捲到頁面最下方才看得到抽屜。
- **判定**：sound — 這是 main 指定的修正方向，而且不再遮住任何操作。
- **把握度**：高

## Main Session Tickets 01..03 & Closeout Review Fixes（commits 0cf16c1..HEAD，2026-11-08）

### 八類掃描

| 類別 | 有／無 | 條目 |
|---|---|---|
| 資料形狀與格式 | 有 | #25（儲能電池基礎容量定為 48 kWh）、#26（未維護容量衰減斷電歸因條件） |
| 存放位置與命名 | 有 | #29（`GET /api/verify` 回傳相對路徑 `contracts/afterlight/src/lib.rs`） |
| API 契約與錯誤行為 | 有 | #27（`POST /api/simulate` 排程長度上限 14 回合與轉手欄位成對檢查）、#28（`NEP-366` 守衛綁定 `methodName` 與 `action.kind`） |
| 新增的相依套件 | 有 | #30（`package.json` 釘定 `next@16.3.6`、`react@19.1.0`、`fast-check@4.6.0`；Rust `Cargo.toml` 釘定 `near-sdk = "=5.29.0"`） |
| 並行與效能取捨 | 無 | 後端 API 與 CLI 皆為同步純記憶體整數運算（`verify:judge` 耗時約 158 ms），無額外快取或重試佇列 |
| 範圍解讀 | 有 | #25、#26 |
| 測試設定改動 | 無 | 使用 Node 24 原生 `node --experimental-strip-types --test tests/*.test.ts` 與 `RUSTFLAGS="--cfg clippy" cargo test`，未放寬 timeout、skip 或斷言 |
| 會被照抄的模式 | 有 | #27、#28 |

### #25 儲能電池基礎容量設為 48 kWh，使單顆電池在滿載或輕度磨損下加上走廊 45 kWh 可支應日蝕 50 kWh 負載

- **何時**：Ticket 01 commit `0cf16c1`（`src/engine/constants.ts:19`、`contracts/afterlight/src/lib.rs:10`）
- **決定**：觸發：日蝕負載為 `50 kWh`，輸電走廊上限為 `45 kWh`，每回合每台設備會產生 `600 bps` 磨損（自動維修可回復 `500 bps`，淨磨損 `100 bps/回合`）。如果電池基礎容量只設 `40 kWh`，一旦累積磨損或分攤充電，到了第 12–14 回合日蝕時很容易因單顆電池差 1 kWh 而非預期斷電。現在：將兩顆 `CryoCell` 儲能電池的基礎容量定為 `48 kWh`（`BATTERY_BASE_CAPACITY_KWH = 48`），既保證兩顆都留在 `SOLAR_ARRAY` 時仍會因走廊 `45 kWh < 50 kWh` 在第 2 回合斷電（`CORRIDOR_BOTTLENECK_BLACKOUT`），又讓平衡維護策略（`03-balanced-survival-walkthrough`）能穩定撐過全部 14 回合。沒選的做法：設成 `40 kWh`，會導致後段回合對微小磨損過度敏感；設成 `60 kWh` 以上則單顆電池就能獨立扛完 50 kWh 日蝕，削弱雙電池協同調度的策略張力。
- **規格缺口**：spec 正文曾以 `40 kWh` 作為舉例數字，但未規定精確平衡常數。
- **影響範圍**：`golden-turn-vectors.json`、Rust 合約與 TypeScript 引擎統一引用 `48 kWh`。
- **判定**：sound — 兼顧「第 2 回合走廊瓶頸必死」與「14 回合平衡調度必活」的數學邊界。
- **把握度**：高

### #26 未維護（0% Skim）導致容量衰減而供電不足且走廊未飽和時，歸因為 `UNMAINTAINED_CAPACITY_DECAY`

- **何時**：Closeout review fix（`src/engine/afterlight-engine.ts:575-581`、`contracts/afterlight/src/lib.rs:349-355`）
- **決定**：觸發：當玩家將維修準備金設為 `0 bps`（`0% Skim`）且電池已正確移防（Alpha 在居住穹頂、Beta 在發電翼）時，第 4 回合日蝕會因磨損達 `1800..2400 bps` 使有效容量降為 `39 kWh`、總供電 `49 kWh < 50 kWh`（`unmetLoadKwh = 1`），此時輸電走廊流量僅 `39 kWh < 45 kWh`（`corridorClampedKwh = 0`，走廊並未限流）。若只看 `maxWear >= 6000 bps` 才算磨損崩潰，這個案例會掉進 `unmetLoadKwh > 0` 而被誤判為「走廊飽和瓶頸（`CORRIDOR_BOTTLENECK_BLACKOUT`）」。現在：當 `maxWear >= CRITICAL_WEAR_THRESHOLD_BPS` **或** `unmetLoadKwh > 0 && corridorClampedKwh === 0 && maxWear > 0` 時，一律判定為 `UNMAINTAINED_CAPACITY_DECAY`；只有 `unmetLoadKwh > 0 && corridorClampedKwh > 0`（走廊確實發生限流夾斷）才判為 `CORRIDOR_BOTTLENECK_BLACKOUT`。沒選的做法：把每回合磨損調高到 `2000 bps`，那會讓正常局太快損壞。
- **規格缺口**：spec 列了三種單一死因代碼，但沒寫當「磨損導致容量不足」早於 `6000 bps` 發生時的歸因優先序。
- **影響範圍**：Rust 合約 `step_pure_turn` 與 TypeScript `applyStationAction` 同步更新，且既有 3 組 `golden-turn-vectors.json`（其中走廊斷電案例的 `corridorClampedKwh = 5 > 0`）完全不受影響。
- **判定**：sound — 消除畫面收據顯示「走廊流量 39/45 卻宣稱走廊在 45 kWh 飽和」的矛盾。
- **把握度**：高

### #27 `POST /api/simulate` 限制自訂排程最多 14 回合，並強制驗證 `transferTokenId` 與 `transferToOwnerId` 成對與合法性

- **何時**：Closeout review fix（`app/api/simulate/route.ts:64-138`）
- **決定**：觸發：Ticket 03 Criterion `3.1` 要求對無效的 action payload 回傳 HTTP 400（`InvalidSimulationRequest`）。原本 `route.ts` 只驗證電價與電池區域，沒檢查 `schedule` 內的 `transferTokenId` 與 `transferToOwnerId`，也沒限制 `schedule` 陣列長度。現在：限制 `1 <= schedule.length <= 14`，且若提供轉手欄位，兩欄必須同時為合法字串、`transferTokenId` 必須屬於 4 台設備之一、`transferToOwnerId` 必須符合帳號字元規範且不得為 `Object.prototype` 原型鍵，否則一律回傳 HTTP 400 `InvalidSimulationRequest`。沒選的做法：讓無效轉手靜默被引擎忽略並回傳 HTTP 200，這會違反 `3.1` 的錯誤契約。
- **規格缺口**：spec 沒細列自訂排程裡轉手欄位的 HTTP 400 檢查條件。
- **影響範圍**：所有打 `POST /api/simulate` 的呼叫端在傳入未知設備 ID 或不完整轉手參數時會收到明確的 HTTP 400。
- **判定**：sound — 對齊 Ticket 03.1 驗收條件並補上回歸測試。
- **把握度**：高

### #28 `verifyAndExecuteNep366Delegate` 強制綁定信封的 `methodName` 與實際執行的 `action.kind`

- **何時**：Closeout review fix（`src/engine/nep366-session-guard.ts:64-125`）
- **決定**：觸發：收尾安全審查發現，中繼者若拿玩家已簽署的 `route_battery` 合法信封，在呼叫 `verifyAndExecuteNep366Delegate(envelope, action, state)` 時把第二個參數 `action` 換成 `TransferEquipmentNft`，原本守衛只驗 `envelope.methodName` 在白名單內就放行，導致中繼者可調包動作轉走玩家的 NFT。現在：建立 `DELEGATE_METHOD_TO_ACTION_KIND` 一對一映射表（例如 `route_battery` 只准執行 `RouteBattery`、`nft_transfer` 只准執行 `TransferEquipmentNft`），不匹配即以 `DisallowedDelegateActionKind` 拒絕；同時對 `nonce`、`lastNonce`、`currentBlockHeight`、`maxBlockHeight`、`attachedDepositYocto` 檢查 `Number.isSafeInteger`。沒選的做法：只靠呼叫端自己傳對成對參數，這會讓守衛函式本身留下調包漏洞。
- **規格缺口**：spec 只列出 `ALLOWED_DELEGATE_METHODS` 白名單，未明寫信封方法名稱與動作物件 `kind` 的映射檢查。
- **影響範圍**：任何呼叫 `verifyAndExecuteNep366Delegate` 的地方都必須傳入與 `envelope.methodName` 對應的 `action.kind`。
- **判定**：sound — 補齊 `NEP-366` 雙層授權守衛的核心安全不變量。
- **把握度**：高

### #29 `runJudgeAudit` 的 `rustContractCheck.contractPath` 改回傳相對於專案根目錄的路徑

- **何時**：Closeout review fix（`src/verifier/judge-audit-runner.ts:648-650`）
- **決定**：觸發：`GET /api/verify` 直接回傳 `runJudgeAudit()` 的結果，原本 `contractPath` 存的是 `path.resolve` 後的本機絕對路徑（含 `/Users/...` 家目錄名稱）。現在：檔案讀取仍用絕對路徑，但寫入報表的 `contractPath` 改用 `path.relative(baseDir, contractPath) || "contracts/afterlight/src/lib.rs"`。沒選的做法：維持絕對路徑，只在前端介面截斷，這樣直接打 API 的外部呼叫端仍會看到伺服器目錄結構。
- **規格缺口**：spec 只寫報表含 `rustContractCheck`，沒規定路徑欄位用絕對或相對路徑。
- **影響範圍**：`npm run verify:judge` 與 `GET /api/verify` 的 `contractPath` 統一輸出 `"contracts/afterlight/src/lib.rs"`。
- **判定**：sound — 消除本機路徑暴露且與前端顯示一致。
- **把握度**：高

### #30 選用與 `near-ghost-shift` 對齊的零外部資料庫技術棧（Next.js 16.3.6 + React 19.1.0 + fast-check 4.6.0 + near-sdk =5.29.0）

- **何時**：Ticket 01 commit `0cf16c1`（`package.json`、`contracts/afterlight/Cargo.toml`）
- **決定**：觸發：為了讓評審在 60 秒內無須設定任何外部環境變數或資料庫即可跑完 `npm run verify:judge` 與 Next.js 指揮艙，同時避開 `near-sdk 5.30.0` MSRV 1.86 斷裂。現在：前端與驗證器採用 `next@16.3.6`、`react@19.1.0`、`fast-check@4.6.0` 與 Node 24 原生 `--experimental-strip-types` 測試執行器；Rust 合約精確釘定 `near-sdk = "=5.29.0"` 並提交 `Cargo.lock`。沒選的做法：引入額外測試框架（Vitest/Jest）或 `near-contract-standards`（未升級支援 `near-sdk 5.x`）。
- **規格缺口**：spec 指定了 `near-sdk = "=5.29.0"` 與 `fast-check`，其餘套件版本由實作者對齊本機基準。
- **影響範圍**：全專案零外部服務依賴，`npm test` 約 0.55 秒完成。
- **判定**：sound — 已於 `/review-brainstorm` Seat 2 與 Seat 4 驗證相容性。
- **把握度**：高

