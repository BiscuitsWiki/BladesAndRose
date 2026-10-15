# 开发进度与下一步

> 用途：**跨会话交接文档**。新会话开工前先读这一份，再读 [UI-OVERHAUL-PLAN.md](./UI-OVERHAUL-PLAN.md)。
> 最后更新：2026-10-15｜仓库：[BiscuitsWiki/BladesAndRose](https://github.com/BiscuitsWiki/BladesAndRose)（**公开仓库**）

---

## 1. 当前坐标

| 项 | 值 |
|---|---|
| 本地 HEAD | 最后一次功能提交 `f098435`（联机：坐满才能开局）；其后的提交只可能是本文档自身的修订，以 `git log` 为准 |
| 远端 `origin/main` | 与本地同步，无未推送提交（本表只记到本次收尾，最新以 `git log` 为准） |
| 未推送的提交 | 无（`c1deb82` 卡面接入、`034572b` 四项动效、`0b28742` 交接文档均已推送） |
| 公网线上版本 | **镜像内容 = `f098435`**（2026-10-15 第二次部署）→ 联机「坐满才能开局」（`/room-start` 未坐满 409 + 前端按钮禁用）；前一次部署 `0b28742` 首次上线卡面与四项动效。回滚点 `blades-and-rose:prev` = `0b28742` 那版 |
| 测试 | **250 用例全绿**（新增 `scene.ts` 20 个）；`tsc --noEmit` 无错误 |
| 工作区 | 有**未提交**改动：步骤 2（`scene.ts` + 单测 + `cards.tsx` 委托）与步骤 3（`App.tsx` 拆分 + `board/` 搬家） |

**一句话总结**：公网已是「坐满才能开局 + 卡面 + 四项动效」那版；本地把步骤 2（`scene.ts` 共享纯函数）与步骤 3（表现层拆分）都做完了但**尚未提交**。接下来就是**视觉收益最大的步骤 4**（牌桌场景化）。

## 2. 本阶段在做什么

**表现层精美化**——把「CSS + emoji 拼出来」的界面升级为 2D 插画风：完整 UI、角色、牌桌、动效。
方案与决策全部记录在 [UI-OVERHAUL-PLAN.md](./UI-OVERHAUL-PLAN.md)（§2 已拍板 10 项决策，§9 为 9 步落地顺序）。

已拍板的关键方向（细节见方案 §2）：

- **不换引擎**（放弃 Godot），继续 Web + DOM/CSS/SVG，未来可加小程序端
- 卡面＝**单主体简略图**（全身人物在小尺寸下认不出）+ **程序画的卡框**（不烘进图里，否则会被卡槽裁掉）+ 卡片统一 **2:3**
- 资源＝AI 生成 → 人工审阅 → **PIL 逐像素校验**（流程与四条硬约束见方案 §5.4）

## 3. 已完成

| 步骤 | 内容 | 证据 |
|---|---|---|
| 5 | **卡面接入真实牌桌**（`c1deb82`） | `CardFace` 取代旧的 `CardChip`/`CardMark`；手牌、版图四区、「上一轮公开」、结算翻牌动画全链路换成卡面；手牌槽 78×100 → 78×117（手机 68×102） |
| — | **7 张画心资源**（`c1deb82`） | `public/assets/cards/card-<kind>.webp`，400×560、质量 90，合计 **86KB**（原 JPG 1507KB）；原始 1680×2352 JPG 留档在 `assets-source/cards/`（不参与构建） |
| — | **部署链补资源**（`c1deb82`） | `Dockerfile` 加 `COPY public ./public`；`DEPLOYMENT.md` 打包清单加 `public/`——**不加这条线上就没有图** |
| 6（部分） | **四项动效**（`034572b`） | 传币 / 水晶发动 / 回合提醒 / 胜负；判定抽成纯函数 `anims.ts` 的 `planAnims`，11 个单测 |
| — | **联机「坐满才能开局」**（`f098435`） | 空座位在引擎里永不行动（`playOrder` 覆盖全部座位、阶段一只推进真人 / 托管，AI 托管又只认「曾入座后断线」的座位）→ 未坐满开局必卡死。`/room-start` 校验全部座位已占用（未坐满 409 + 空座清单）、前端按钮禁用 + 文案改写；新增纯函数 `emptySeatsOf`（3 单测）；本地与线上实测 1/5 入座 → 409、5/5 → `started` |
| 2 | **`scene.ts` 场景纯函数**（本地未提交） | `seatLayout`（视角旋转 + 归一化坐标 0–1）/ `seatVisualOf`（标签、水晶、硬币，口径与 Board 现有实现逐字对齐）/ `cardFaceOf`（画心、卡名、色调）；20 个单测（5–10 人局穷举、视角旋转、纯函数不改入参）；`cards.tsx` 的 `cardLabel`/`cardArtKind` 改为委托 `cardFaceOf`，消除两套映射 |
| 3 | **表现层拆分**（本地未提交） | `App.tsx` **1414 → 829 行**：抽出 `lobby/Lobby.tsx`、`lobby/DistributionEditor.tsx`、`room/RoomPanel.tsx`、`CopyButton.tsx`、`LoadoutChips.tsx`、`distribution.ts`；`Board.tsx` / `RevealStage.tsx` 移入 `board/`。行为等价证据：250 用例全绿、`tsc` 无错误、生产构建产物的 CSS/JS **与拆分前同 hash**；浏览器冒烟：大厅与热座牌桌渲染正常、控制台无报错 |

浏览器实测已确认的：手牌卡面渲染正常、`assets/cards/*.webp` 均返回 200（无 `.jpg` 请求、无 404）、卡面实测 78×117、四角饰花对称、无 JS 报错、无横向溢出；走完一轮后「上一轮公开」5 张 96×144 卡面正常。

## 4. 未完成

| 步骤 | 内容 | 备注 |
|---|---|---|
| 1（剩余） | 卡背 / 桌布 / 6 个头像 / 头像框 / 版图底板 / 花苞 / 水晶 / 硬币 / 眼睛 | 清单与规格见方案 §5.3 |
| 4 | 牌桌场景化：桌面 + 席位环绕 + 中央版图 | 视觉收益最大的一步；步骤 2 / 3 已就绪——**第一件事**是让 `Board.tsx` 改为消费 `seatVisualOf` / `seatLayout`（两者目前尚无消费者，口径由单测锁死），全量绿后再改视觉 |
| 6（剩余） | 发牌 / 出牌落桌 / 飞入区域 | 延后理由见方案 §7 |
| 7 | 大厅与房间面板精美化 | |
| 8 | 音效 | 已决定**推后**（先画面后声音） |
| 9 | 手机适配与无障碍复核 + 公网更新 | 375px 无溢出、键盘可达 |

## 5. ✅ 动效触发已确证（2026-10-15 验证）

按 §5 原定配方（**先装记录器 → 真实界面点击 → 读回记录**）走通，四项中三项在真实交互下确证触发：

| 动作 | `MutationObserver` 记录（t≈321ms） | 动效 |
|---|---|---|
| 顶栏切到持币者视角（座位 3）→ **真实点击「座位 1」那一行**传币 | `childList coin-flight [board]` | 传币硬币飞行 |
| 同上（同一次动作） | `attributes [track-hex filled launching]`、`attributes [round-note launching]` | 水晶发动 |
| 同上（同一次动作） | `attributes [player-row turn-pulse]` | 回合提醒 |
| 切到座位 1 → 点「跳过」 | `attributes [player-row turn-pulse]` | 回合提醒（独立复现） |

两次动作都真实生效：持币 玩家 3 → 玩家 1、阶段 阶段一 → 阶段二（公开日志同步出现「玩家 3 把硬币交给 玩家 1，翻开水晶 8 —— 【两邻出牌】」）；「跳过」使回合从 玩家 1 推进到 玩家 2。

**第四项「胜负」**：`.banner` 条件挂载 + `banner-in` 关键帧（2000ms，`034572b` 新增），与已验三项同款「纯 CSS + `prefers-reduced-motion` 闸门」模式 → **代码层已核**，实战确认顺延到自然终局（不值得为它驱动完整一局）。

**画面级（人眼）证据仍未取得，原因不在代码**：自动化标签页 `document.hidden = true`（截图工具直接报 renderer throttled 不可用）；且 `CoinFlight` 的 `flying` 类在 `requestAnimationFrame` 里（[Board.tsx](../src/client/Board.tsx#L53-L70) 第 68 行），隐藏页挂起 rAF → `flying`、CSS 过渡、`getAnimations()` 全都观察不到。**想眼见银币飞行**：把浏览器窗口调到前台，进热座切到持币者座位点一次玩家行即可。

**相关文件**：`src/client/anims.ts`（判定）、`src/client/__tests__/anims.test.ts`（单测）、`src/client/board/Board.tsx` 的 `CoinFlight` 与动效 effect、`src/client/styles.css` 里的 `@keyframes`。

## 6. 下一步行动（建议顺序）

1. ~~真机确认动效~~ → **已确证**（见 §5）
2. ~~推送 + 部署~~ → **已完成**（2026-10-15 两次：`f098435` 联机「坐满才能开局」已上线，线上卡面 7 张 webp 均 200、容器 healthy）
3. ~~步骤 2 + 3~~ → **已完成但未提交**（见 §3：250 用例全绿、构建产物与拆分前同 hash）
4. **提交并推送步骤 2 / 3**（若尚未落盘）——行为等价改动，线上无观感变化，不必部署
5. **步骤 4 牌桌场景化**（视觉收益最大）——先让 `Board.tsx` 消费 `seatVisualOf` / `seatLayout`，全量绿后再改视觉
6. 步骤 6 剩余三项 → 步骤 1 剩余资源 → 步骤 7 → 步骤 9

## 7. 关键命令

```bash
npm run dev          # Vite 前端（5173）
npm run dev:server   # 房间服务器（8000），watch 模式
npm run typecheck    # tsc --noEmit
npm test             # 227 用例
npm run build        # 产物含 dist/assets/（卡面在里面）
```

## 8. 新会话必须知道的约束与踩坑

**红线（公开仓库）**

- 仓库内任何文件（含 `docs/`、README、提交信息）**不得写入真实服务器地址、SSH 密钥名、口令、账号**，一律用占位符 `<服务器 IP>` / `<部署密钥>`；真实值只放本机（`~/.ssh`、项目记忆、本地笔记）。`.trae/`、`.env`、`data/` 已在 `.gitignore` 排除。

**本阶段踩过的坑**

- **房间服务器是 watch 模式**：改引擎 / 服务器源码会**自动重启并清空内存中的所有房间**（对局状态在进程内存里），测试者用原房间号重新进入即可；改前端不受影响（HMR）
- **临时预览页已删**：`public/` 下只有 `assets/cards/`，不再有验证件；要再验证资源请新建临时页并记得删
- **点击视口外的元素会被浏览器工具静默忽略**（2026-10-15 踩到）：按钮若在视口下方（实测「跳过」在 y=1204 > 视口 970），`elementFromPoint` 取不到它、点击后 DOM 零变化、控制台也不报错——极易误判成「引擎拒绝了动作」。先 `scrollIntoView` 把它滚进视口（`elementFromPoint === 该元素` 即为就绪）再点，同一 ref 立刻生效
- **隐藏标签页的自动化环境拿不到画面级证据**：`document.hidden = true` 时渲染被节流——截图工具报 renderer throttled 不可用、rAF 挂起（于是 `CoinFlight` 的 `flying` 类不出现）、`getAnimations()` 也读不到。此时**只能靠 `MutationObserver` 读 DOM 证据**（类名变化 / 元素挂载），别把「看不到画面」误判成动效没生效
- **`Dockerfile` 必须进部署包**（2026-10-15 部署时踩到）：只打包 `src/ public/` 而漏了 `Dockerfile`，服务器上的旧 Dockerfile 没有 `COPY public ./public` → **前端新代码上线了、卡面却全部 404**。判定与修复：`grep -n COPY /opt/bar/Dockerfile` + `sudo docker exec bar-server ls /app/dist/assets`，补传 `Dockerfile` 后 `up -d --build`；打包清单现已把 `Dockerfile .dockerignore` 写进 [DEPLOYMENT.md](./DEPLOYMENT.md)
- **`assets-source/` 不要删**：原始高分辨率画心（AI 生成不可复现），不参与构建、不进镜像，仅作将来更高分辨率场景的素材
- **版图区不用横向叠放**：卡名条在卡片底部居中，叠放会盖住卡名与插画，而献祭区 / 死亡花苞是玩家必须看清的公开信息 → 改为自动换行
- **AI 生图四条硬约束**（方案 §5.4）：①「武器 + 血」必被安全策略拦，涉及血一律程序画 ②结构性要求必须用**构造性空间描述**，方向词会被无视 ③出图后必须**逐像素校验**（本机 Python + PIL）④禁止项要显式列出
- **动画三原则**（方案 §7）：编排是纯函数（`planAnims`）、必须能被 `prefers-reduced-motion` 关闭、动画绝不反向影响 moves
- **热座切视角会重建 client**（boardgame.io 0.50.2 的 Local 传输器有回调累积缺陷），因此动效的 `prev` 快照在切换后会归零 → 首帧不播（这是有意设计）；结算动画同理「刷新 / 中途加入不重播」

**既有硬约束（与表现层无关，别踩）**

- Boardgame.io + socket.io，版本锁死；无数据库，房间在内存；账号表（UID + scrypt）持久化到 `data/accounts.json`
- `PlayerView` 必须过滤隐藏信息，每个角色只能拿到被授权的信息
- 引擎层**零框架依赖**（所以小程序端能复用同一份引擎）
- 暗刃 / 白蔷薇各必须有且仅有 1 名；自定义配比之和须等于人数，否则拒绝开局
- 联机：座位凭据存 localStorage、房间号 6 位随机码、观战只拿公开视图、断线 3 分钟后 AI 托管

## 9. 文档地图

| 文档 | 内容 |
|---|---|
| [PROGRESS.md](./PROGRESS.md) | 本文件：进度、下一步、踩坑 |
| [UI-OVERHAUL-PLAN.md](./UI-OVERHAUL-PLAN.md) | 表现层改造方案（决策 / 资源 / 卡面形制 / 动效 / 落地顺序） |
| [DESIGN.md](./DESIGN.md) | 总体设计（架构、数据结构、联机、测试） |
| [RULES.md](./RULES.md) | 游戏规则与技能版本 |
| [SKILL-LOADOUT-PLAN.md](./SKILL-LOADOUT-PLAN.md) | 技能组方案（插件化 + 扩充包） |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | 部署与回滚（占位符写法，不含真实值） |
