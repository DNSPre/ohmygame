# 雲端運行｜game.design.cab

這是供受信任操作人員使用的單一工作區。GitHub 保存原始碼，Linux 主機上的
Docker Compose 執行前端、長時間運行的後端及持久化資料。請勿把帳號開給不受信任的使用者；
這個 Agent 能在伺服器上執行指令，應在專用主機上運行。服務不使用宿主機的 Docker socket、
SSH 金鑰或本機專案資料。

1. 在備有 Docker Engine 和 Compose 的專用 Linux 主機拉取澳科大分支。
2. 複製 `.env.example` 到本目錄的 `.env` 並設成只有目前使用者可讀。
   用 `openssl rand -hex 32` 生成 `STUDIO_DAEMON_TOKEN`；用
   `docker run --rm -it caddy:2.10.2-alpine caddy hash-password` 互動生成 bcrypt 密碼雜湊。
   把雜湊以單引號存為 `STUDIO_PASSWORD_HASH`，不要提交 `.env`。
3. 在 `design.cab` 的 DNS 將 `game` 的 A 記錄指向主機 IPv4（啟用 IPv6 才加 AAAA）。
   開放 TCP 80 和 443 給 Caddy 申請和更新 HTTPS 憑證；不要對外開放 43210。
4. 在本目錄運行 `docker compose up -d --build`。打開 https://game.design.cab，
   用網頁登入帳密進入；再於工作台設定中配置各類模型。使用同一帳密會看到同一工作區。
5. 以 `docker compose ps` 和 `docker compose logs` 檢查；定期備份 `studio-data`。
   更新時拉取分支再執行第 4 步；要保留資料，勿使用 `docker compose down -v`。

目前網頁遊戲的即時預覽會使用主機端的 loopback URL，遠端瀏覽器不能直接使用。
因此這份配置不把生成中的遊戲伺服器或代碼暴露在公共網域；可以在工作台匯出專案，
再在本機試玩。若需雲端實時試玩，需另配置與工作台不同來源的預覽服務。

## Cloady 聯調環境

從 GitHub 匯入 `DNSPre/ohmygame` 的 `codex/must-game-design-studio` 分支。
在首次部署的環境變數中設定 `CLOADY_COMPOSEFILE_PATH=deploy/compose.cloady.yaml`，
並將上方步驟生成的 `STUDIO_DAEMON_TOKEN` 和 `STUDIO_PASSWORD_HASH` 設為密鑰。
填入原始雜湊值，並在部署前核對平台預覽的環境設定與費用。
預設登入帳號為 `studio`，可用 `STUDIO_USER` 覆寫。

部署配置只發布 gateway 的 80 埠，由 Cloady 提供 HTTPS；後端的 43210 埠供內部使用。
`studio-data` 掛載到 `/data`。直接使用 Cloady 提供的 HTTPS 網址聯調，公開演示繼續使用 GitHub Pages。
部署後先確認未登入的請求收到 401，再在登入後檢查專案持久化及 AI 生成的串流回應。

## 使用 Cloudflare 按路徑分流

在 Cloudflare 啟用 `design.cab` 並保留 `game` 的 GitHub Pages CNAME 目標
`dnspre.github.io`，將此記錄設為代理並使用 Full (strict) TLS。
從 `deploy/cloudflare` 執行 `npx wrangler deploy`。
首頁和演示資源由 GitHub Pages 提供；`/studio/` 與 `/api/` 由 Worker 轉發到
有登入驗證的 Cloady 工作台。GitHub Pages 的自訂網域保持為 `game.design.cab`。

## 公開個人工作區

公開首頁使用 VITE_MUST_PAGES=1 建置，訪客的作品儲存在自己的瀏覽器 IndexedDB，模型設定儲存在 localStorage，API Key 僅保留於頁面記憶體。瀏覽器直接連接訪客指定的 Ollama 或 OpenAI 相容 API，服務必須允許本站的 CORS 來源。不同裝置或瀏覽器的資料不會同步，作品可以匯出再匯入。

HTML 遊戲在不具同源權限、禁止網路請求的 sandbox iframe 中試玩。瀏覽器版支援獨立 HTML 遊戲和互動故事，不執行 Godot 或任意伺服器指令。圖片和影片需要相容的 images/generations 或 videos API。

Cloady 的一般頁面會轉到公開首頁。原有管理工作台可於 Cloady 網址的 /admin/ 存取，仍需要原有帳密。/api/ 保留驗證，公開個人工作區不使用它。既有 /studio/ 書籤也會經此轉址進入公開首頁。

### 租戶自己的智能體連接

雲端公開工作台提供 Codex、Claude Code 與 OpenCode 入口。每位訪客在自己的電腦下載並執行 `/must-agent-bridge.mjs`（Node.js 22+），再開啟終端機列印的配對連結。配對碼只進入該瀏覽器頁面記憶體，網址片段會立即清除。瀏覽器直接連接本機 `127.0.0.1:11435`，各訪客使用各自的本機 CLI 帳號與額度。

連接器復用原有 CLI 探測和模型發現程式，模型與推理強度從 CLI 讀取。它只監聽 loopback，來源限制為本站與本機開發頁面，每次啟動產生新的配對碼。連接器提供固定的模型清單與生成介面，生成在臨時目錄執行，結束後清理。停止連接器會中止連線，重新啟動需重新配對。

`node scripts/build-guest-bridge.mjs` 可重新建置連接器。公開網站的 `VITE_MUST_PAGES=1` 建置也會自動更新它。模型設定保留於各訪客的瀏覽器，網站不會共用管理工作台的 CLI 登入資料。
