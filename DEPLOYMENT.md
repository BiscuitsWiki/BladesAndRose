# 服务器部署文件树

> 更新于 2026-10-09。与《变种井字棋》共用一台腾讯云轻量服务器（Shanghai / Ubuntu 24.04 / 2C4G），
> 本项目以独立 compose 项目 `bar` 运行，与 `att` 项目互不影响（各自目录、容器、网络与数据卷）。

| 项 | 值 |
|---|---|
| 服务器 | `ubuntu@<服务器 IP>`（SSH 密钥：本机 `~/.ssh/<部署密钥>`） |
| 部署源 | `/opt/bar` |
| 镜像 / 容器 | `blades-and-rose:latest` / `bar-server`（healthy，`restart=unless-stopped`） |
| 端口 | 宿主 `8082` → 容器 `8000`（过渡期非标端口；备案后改为 `127.0.0.1:8001` 交由 Caddy 反代 HTTPS） |
| 数据卷 | `bar_data` → 容器 `/app/data`（账号表 `accounts.json`） |
| 备份 | `/opt/backup/bar/accounts-<时间戳>.json`，由 root cron 每天 03:30 执行 `backup-accounts.sh`，保留最近 14 份 |
| 部署方式 | `sudo docker compose -p bar up -d --build` |
| 限流 | 进程内按 IP 固定窗口（游客发号 20/分、注册 10/分、建房 20/分、座位认领 60/分、房间操作 60/分、房间信息 300/分），超限 429 |
| SSH 登录 | 允许密码登录（2026-10-10 已回滚"仅密钥"加固：`00-hardening.conf` 已删除，配置回到原状）；`/etc/ssh/` 下的 `*.bak-hardening-20261009` 为当时备份，可随时清理 |
| SSH 防爆破 | fail2ban（2026-10-10 安装，已设为开机自启）：sshd jail，10 分钟内失败 5 次封禁 6 小时，重复封禁时长翻倍（上限 1 周）；后端用 polling 读 `/var/log/auth.log`（Ubuntu 24.04 SSH 为 socket 激活，systemd 后端匹配不到日志）；配置在 `/etc/fail2ban/jail.d/bar-ssh.local`；查看 `sudo fail2ban-client status sshd`，解封 `sudo fail2ban-client set sshd unbanip <IP>` |

## 树形图

```
<服务器 IP>（腾讯云轻量 · Ubuntu 24.04 · 2C4G）
│
├─ /opt/bar/                                  ← 部署源（compose 项目 bar 的构建上下文）
│  ├─ docker-compose.yml                      ← 编排：8082→8000、卷 bar_data、healthcheck、restart=unless-stopped
│  ├─ Dockerfile                              ← node:22-alpine → npm ci（国内源）→ tsc + vite build
│  ├─ .dockerignore
│  ├─ backup-accounts.sh                      ← 账号表备份脚本（root cron 每天 03:30 调用）
│  ├─ index.html   package.json   package-lock.json   tsconfig.json   vite.config.ts
│  └─ src/
│     ├─ client/
│     │  ├─ App.tsx   Board.tsx   AccountBar.tsx   main.tsx
│     │  ├─ account.ts   room.ts   game.ts   avatar.ts   boardActions.ts   styles.css
│     │  └─ __tests__/  account.test.ts  adapter.test.ts  board-actions.test.ts  client-smoke.test.ts
│     ├─ engine/
│     │  ├─ game.ts  magic.ts  round.ts  setup.ts  view.ts
│     │  ├─ autoPlay.ts  config.ts  rng.ts  types.ts  index.ts
│     │  └─ __tests__/  auto-play.test.ts  engine.test.ts
│     └─ server/
│        ├─ dev-server.ts                     ← 生产入口（PORT 环境变量 + 托管 dist + 房间/账号/座位 API + 按 IP 限流）
│        ├─ accounts.ts   seats.ts   rateLimit.ts
│        └─ __tests__/  accounts.test.ts  seats.test.ts  rate-limit.test.ts
│
├─ Docker 资源（docker compose -p bar 管理，与 att 项目隔离）
│  ├─ 镜像  blades-and-rose:latest            483MB（node_modules + dist + src）
│  ├─ 容器  bar-server                        Up (healthy) · 0.0.0.0:8082 → 容器 8000
│  ├─ 网络  bar_default                       bridge（仅本项目使用）
│  └─ 卷    bar_data
│     └─ /var/lib/docker/volumes/bar_data/_data/
│        └─ accounts.json                     ← 账号表（UID、scrypt 盐+哈希），容器重建不丢
│
├─ /opt/backup/bar/                           ← 账号表备份目录（cron 每天备份，保留最近 14 份）
│  └─ accounts-<YYYY-MM-DD-HHMMSS>.json
│
└─ 容器内 /app（镜像内容 + 挂载）
   ├─ node_modules/
   ├─ dist/                                   ← vite 构建产物（index.html + assets/）
   ├─ src/  index.html  package.json  package-lock.json  tsconfig.json  vite.config.ts
   └─ data/  → 挂载卷 bar_data（accounts.json）
```