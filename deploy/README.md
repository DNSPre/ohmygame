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
