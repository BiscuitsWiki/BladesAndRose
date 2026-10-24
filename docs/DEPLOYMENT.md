# 服务器部署文件树

> 更新于 2026-10-23。与《变种井字棋》共用一台腾讯云轻量服务器（Shanghai / Ubuntu 24.04 / 2C4G），
> 本项目以独立 compose 项目 `bar` 运行，与 `att` 项目互不影响（各自目录、容器、网络与数据卷）。

| 项 | 值 |
|---|---|
| 服务器 | `ubuntu@<服务器 IP>`（SSH 密钥：本机 `~/.ssh/<部署密钥>`；真实值只保存在本机，见文末「敏感信息」） |
| 部署源 | `/opt/bar`（**普通文件目录，不是 git 仓库**：用 GitHub 仓库留档，部署靠上传源码） |
| 镜像 / 容器 | `blades-and-rose:latest` / `bar-server`（healthy，`restart=unless-stopped`）；上一版保留为 `blades-and-rose:prev` |
| 端口 | 宿主 `8082` → 容器 `8000`（过渡期非标端口；备案后改为 `127.0.0.1:8001` 交由 Caddy 反代 HTTPS） |
| 数据卷 | `bar_data` → 容器 `/app/data`（账号表 `accounts.json`） |
| 备份 | `/opt/backup/bar/accounts-<时间戳>.json`，由 root cron 每天 03:30 执行 `backup-accounts.sh`，保留最近 14 份 |
| 部署方式 | 上传源码 → `sudo docker compose -p bar up -d --build` |
| 更新步骤 | ① `tar -czf` 打包 `src/ public/ Dockerfile .dockerignore package.json package-lock.json tsconfig.json vite.config.ts index.html`（`docs/` 与 `*.md` 被 `.dockerignore` 排除，不进镜像）→ ② `scp` 上传 → ③ 服务器 `sudo tar -xzf` 解包到 `/opt/bar` → ④ 先 `sudo docker tag blades-and-rose:latest blades-and-rose:prev` 留回滚点 → ⑤ `sudo docker compose -p bar up -d --build`。**`Dockerfile` 必须在打包清单里**：`public/` 进镜像靠它的 `COPY public ./public`，漏传就会「前端新代码已上线、但卡面全部 404」（2026-10-15 实际踩到过：只打包 `public/` 而没带 `Dockerfile`，服务器上的旧 Dockerfile 里没有这行） |
| 回滚 | `sudo docker tag blades-and-rose:prev blades-and-rose:latest && sudo docker compose -p bar up -d`（源码可另从 GitHub `main` 取） |
| 当前版本 | GitHub `main` 提交 `a1d0611`（2026-10-24 **第十次**部署：9–10 人局环绕布局改「两翼各 3 行、顶行 2/3 张」，手机可用环绕席位；桌高按两翼行数分档（5–8 人 2 行档不变、9–10 人 3 行档），宽度门控保留作保险）。回滚点 `blades-and-rose:prev` = 第九次部署的 `eacb865` |
| 限流 | 进程内按 IP 固定窗口（游客发号 20/分、注册 10/分、开发者注册 5/分、建房 20/分、座位认领 60/分、房间操作 60/分、房间信息 300/分、dev 授权复核 60/分），超限 429 |
| 开发者邀请码 | 环境变量 `BLADES_DEV_INVITE = <开发者邀请码>`（在 compose env / `.env` 配置，**真实值绝不入仓库**）；未配置时 `/account/dev-register` 返回 503，开发者注册不开放。改邀请码即作废旧码（已发 token 仍在有效期内，重启服务器可立即全量吊销）。**已配置**：服务器上就地生成、存 `/opt/bar/.env`（root 600 权限），查看用 `sudo cat /opt/bar/.env` |
| 开发者授权 token | 内存 Map 签发（7 天过期），仅用于解锁前端本地热座调试；**服务器重启即全量失效**（重新登录即可）。吊销三路：登出 / 删除账号记录 / 重启 |
| SSH 登录 | 允许密码登录（2026-10-10 已回滚"仅密钥"加固：`00-hardening.conf` 已删除，配置回到原状）；`/etc/ssh/` 下的 `*.bak-hardening-20261009` 为当时备份，可随时清理。**2026-10-17 起本机 `id_ed25519` 公钥已加入 ubuntu 的 authorized_keys（免密部署），私钥只存本机** |
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
│  ├─ public/                                 ← 卡面等静态资源（`COPY public` 后在 vite build 时并入 dist/assets）
│  └─ src/
│     ├─ client/
│     │  ├─ App.tsx   Board.tsx   AccountBar.tsx   main.tsx   cards.tsx   RevealStage.tsx
│     │  ├─ account.ts   room.ts   game.ts   avatar.ts   boardActions.ts   revealAnim.ts   styles.css
│     │  └─ __tests__/  account.test.ts  adapter.test.ts  board-actions.test.ts  client-smoke.test.ts  reveal-anim.test.ts  hotseat-skill-flow.test.ts
│     ├─ engine/
│     │  ├─ game.ts  magic.ts  round.ts  setup.ts  view.ts
│     │  ├─ autoPlay.ts  config.ts  rng.ts  types.ts  index.ts
│     │  └─ __tests__/  auto-play.test.ts  engine.test.ts  loadout.test.ts  expanded-skills.test.ts
│     └── server/
│        ├─ dev-server.ts                     ← 生产入口（PORT 环境变量 + 托管 dist + 房间/账号/座位 API + 按 IP 限流）
│        ├─ accounts.ts   devAuth.ts   seats.ts   rateLimit.ts
│        └─ __tests__/  accounts.test.ts  devAuth.test.ts  seats.test.ts  rate-limit.test.ts
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

## 敏感信息（不入库）

本文档属于**公开仓库**，服务器地址、SSH 密钥名、口令等一律用占位符 `<服务器 IP>` / `<部署密钥>`，真实值不写进仓库。

- 真实值只保存在本机：`~/.ssh/<部署密钥>`（私钥文件本身）与本机笔记 / Trae 记忆（`.trae/`、项目记忆目录，均已被 `.gitignore` 排除）；
- 部署命令里的 `ubuntu@<服务器 IP>` 用本机记录的真实值替换后再执行；
- 若需要与他人协作部署，改用环境变量或本地 `.env`（`.env` 同样被 `.gitignore` 排除）传递，不要回填进本文档；
- 提醒：SSH 目前**允许密码登录**，公网 IP 一旦泄露会成为扫描/爆破靶子——这也是本节坚持占位符的原因；加固（仅密钥登录）与 HTTPS 切换仍待办。