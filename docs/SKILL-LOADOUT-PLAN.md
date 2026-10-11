# 《血与刃的白蔷薇》2025 扩充包 · 技能组方案

> 状态：**已实施**（按 §11 六步落地，见 [DESIGN.md](./DESIGN.md) §4/§5/§6 与 [RULES.md](./RULES.md) 第 11 节）｜最后更新：2026-10-11｜关联文档：[DESIGN.md](./DESIGN.md) · [RULES.md](./RULES.md)

本文说明「引入 2025 扩充包技能表 + 房间持有技能组」的实现方案与技术架构。

---

## 1. 背景与目标

- 当前 12 枚水晶对应初版 11 个技能（1 号与 12 号同为「强制出牌」）。
- 新增 2025 扩充包技能表：**10 个不同技能、12 个水晶槽**（11 号与 2 号同技能、12 号与 1 号同技能——刻意复用设计）。
- **本次目标**：房间内可选用「初版 / 2025 扩充包」两套技能组，房主可修改，加入者自动采用房内技能组。
- **长期目标**：支持**任意技能组合**（12 个槽位任意装配，同一技能可占多个槽位）。本次不做组合编辑器，但架构必须原生支持，且不做硬编码的"两版分支"。

## 2. 已拍板的规则与产品决策

| # | 决策 |
|---|---|
| 1 | 扩充版 = 10 个技能、12 槽（11≡2、12≡1 为刻意复用） |
| 2 | 3 号（左邻随机抽取，名称中的「左邻」仅作叙述，不受邻位限制）：写「本轮随机出牌」旗标——玩家仍可自愿出牌或跳过，**选择出牌时牌由系统用种子 RNG 随机抽**（不是强制代打，与初版 3/4 号不同） |
| 3 | 5 号：目标池 = **有其他手牌**的玩家；可选数 = min(2, 池大小)（≥2 必选 2；=1 选 1；=0 无可选）；出牌集合 = 自己（**若有手牌**）+ 选中目标，集合内**必须各出 1 张**；自己无手牌则自己不出；集合为空则按「无人出牌轮」处理 |
| 4 | 6 号：洗牌前指定 1 名「未出牌」玩家**随机补出 1 张**，匿名混入本轮牌堆 |
| 5 | 8 号（司教有牌要出牌）：司教身份**必须保持隐藏**——公开信息不点名、不标记 |
| 6 | 技能组**由房间持有**、房主可修改；**不在主页体现**，不做大厅选择、不加 URL 参数、不做匹配功能 |
| 7 | 修改技能组 = 清空当前等待中的对局数据（二次确认；与「重开」同款体验，玩家刷新重进即按新技能组重建）；对局中不可改，需先「重开」 |
| 8 | 热座模式：本地设置面板选择技能组（默认初版） |
| 9 | 初版行为**零变化**：现有 132 个单测作为回归基线 |

## 3. 现状与约束（相关部分）

- 引擎为纯函数状态机（`applyMove` / `applyMoveInPlace`），零框架依赖；12 水晶 × 每轮发动 1 枚 → **单轮内只会有一个技能生效，天然不存在效果叠加**。
- 联机对局以 boardgame.io 0.50.2 承载（版本锁定）：game 变体机制已用于配比签名（481 个变体）；房间/座位/凭据在服务器内存（`roomExtras`）。
- boardgame.io 0.50.2 原生能力（已核实其源码与类型定义）：
  - `Game.setup(context, setupData)` —— setup 接收逐局配置（第二个参数即 setupData）；
  - `Game.validateSetupData(setupData, numPlayers): string | undefined` —— **建局时服务器侧校验**，返回字符串（错误信息）则建房失败；
  - `MatchData.setupData` —— 配置随对局存储，可经 `db.fetch({ metadata: true })` 读回；**对局同步（sync/master）下发的 matchData 不含 setupData**，客户端不能从同步包直接读取；
  - 库对外暴露 `boardgame.io/internal`（`createMatch` / `InitializeGame` / `ProcessGameConfig`，含类型声明）：`createMatch({ game, numPlayers, setupData, unlisted })` 内含 `validateSetupData` 与初始状态生成，返回 `{ initialState, metadata }`——**服务器可以用它为指定 matchID 建局**（master 的"按需自动建房"用的就是它，只是 `setupData: undefined`）；
  - InMemory 存储的 `createMatch` 会把 `initialState` **同时写入 `state`**，因此预建的对局不会被随后客户端同步时的"按需自动建房"覆盖。
- 本项目**未使用** boardgame.io 的 LobbyClient，也不走 REST 建房：
  - 建房现状：客户端用一次不带凭据的 SocketIO 空连接触发服务器「按需自动建房」（`setupData: undefined`）——**该路径无法携带技能组**，必须改为服务器侧建局（§8）；
  - `POST /games/:name/create` 虽接受 setupData，但 **matchID 由库生成 uuid，无法使用本项目的 6 位房间码**，本方案不使用它；
  - 加入走自研 `POST /seat-claim`（按 UID 认领）与库的 `/join`（无 uid 降级路径），都不需要 setupData。
- 每轮只发动一颗水晶 → 「自由组合」= loadout 的槽位装配，**不需要效果合并/冲突仲裁**；仅需为未来"多水晶同轮"预留合并钩子。
- 随机性：引擎使用自研 mulberry32 种子 RNG（`G.rngSeed`），洗牌/随机抽牌全走它，可复现、可序列化；`Math.random` 仅用于默认种子与 autoPlay 兜底。

## 4. 总体架构

### 4.1 为什么技能组不进入 game 变体

曾评估「版本签名编入 game 名（变成第二个变体维度）」，**否决**，原因：

1. 组合空间无法枚举（任意组合 → 指数增长；boardgame.io 的 game 列表在 Server 构造时固定，不支持运行时注册）；
2. 技能选择本质是**对局配置**，不是"游戏种类"；boardgame.io 为此提供了 setupData 通道；
3. 版本分支会侵入流程代码（改流程的技能被迫写成 `if 版本 === x`）。

### 4.2 分层

```
房间层（server 内存）          建局（boardgame.io 服务器侧）            引擎层（纯函数）
roomExtras.loadout   ──►   setupData.loadout（服务器自己生成） ──►   G.skills（唯一权威）
（房主可改，服务器校验）      （createMatch + validateSetupData）        └─► flow-first：流程决策点读「本轮效果」
                                                                        └─► 技能 = 插件（SkillId → SkillDef）

热座：本地 createGame(names, { loadout }) 直接注入引擎，不经过传输层
```

- **房间持有**：`roomExtras.loadout` 随房间生命周期存在；默认初版。
- **建局**：首个座位认领时由服务器把房内 loadout 作为 `setupData` 建局（`boardgame.io/internal` 的 `createMatch`，内含 `validateSetupData`）——**loadout 不经客户端传输**；重开/换技能组后的重建走同一条路（服务器始终取当前 `roomExtras.loadout`）。
- **热座**：见上图注——本地构造 game 时注入引擎。
- **引擎**：`setup(ctx, setupData)` 把 loadout 解析为 `G.skills`（可序列化）；视图渲染全部从 `G.skills` 派生——客户端不自行推断技能组。

## 5. 数据模型

| 名称 | 定义 | 说明 |
|---|---|---|
| `SkillId` | 技能标识 | 在现有 11 个基础上新增 8 个（扩充版独有） |
| `SkillLoadout` | `Record<水晶槽 1-12, SkillId>` | 同一技能可占多槽；初版 1≡12、扩充版 11≡2/12≡1 均为该模型的自然表达 |
| `SkillDef` | 展示数据 + 效果函数 + 可选流程钩子 | `name/text/targets`（targets 支持按局面动态，见下）+ `effect(state, chooser, targets)`（纯函数，写入本轮效果）+ 可选钩子 |
| `RoundEffect` | 本轮生效效果的**可序列化结构**（在现有 `RoundModifiers` 上扩展） | 字段见 §7.3；轮末清空 |
| `GameState.skills` | 本局 12 槽映射 | 随对局序列化、唯一权威；`skillOfCrystal` 改为按它查询 |
| `SetupOptions.loadout` | 引擎建局入参（`createGame(names, opts)` 新增字段） | 联机由服务器从 setupData 转入；热座由本地调用传入；缺失回退 `LOADOUT_BASE` |
| 预设 | `LOADOUT_BASE`（初版）、`LOADOUT_2025`（扩充包） | 预设仅是"具名 loadout"；自定义组合为后续演进（模型已就绪） |

**动态目标规格**（新增）：现有目标体系只有 `oneAny` / `oneOther`，扩充技能需要按局面动态计算目标池与可选数。统一扩展为：

```
TargetSpec =
  | { kind: 'oneAny' | 'oneOther' }
  | { kind: 'pool';      // 从局面计算目标池
      pool: (state, chooser) => PlayerId[];   // 目标池
      min:  number;        // 最少选几人（如 5 号 = 0）
      max:  number;        // 最多选几人（如 5 号 = 2、扩 2 号动态 1/2）
    }
```

- 5 号：`pool` = 其他有手牌者，`min=0`、`max=2`；客户端渲染"可选 X 人"时用 `min(max, pool.length)`，并按可选数限制选择。
- 扩充 2 号：`max = playerCount >= 8 ? 2 : 1`，`min = max`（必选满）；`pool` = 其他玩家。
- 6 号：`pool` = 未出牌且有手牌者，`min=max=1`；池空时技能无事发生（不进入选择阶段）。
- 引擎、客户端目标选择 UI、autoPlay 三处共用同一套 `TargetSpec`，由 `targetSpecOf(skillId, state, chooser)` 计算。

**流程如何"从流程本身入手"**：把轮内流程拆成显式**决策点**（§6）；每个决策点读取 `RoundEffect` 的对应字段；技能只负责写字段/挂钩子。流程代码永不过问"这是哪版技能"。

## 6. 流程决策点（引擎）

| # | 决策点 | 读取的效果 | 涉及技能 |
|---|---|---|---|
| 1 | 出牌阶段开始：计算参与者集合 | trio 收窄 / 默认全体；mustPass 剔除 | 5 号扩充；2/11 |
| 2 | 单人行动：输入方式与必须性 | 随机出牌（**自愿出牌、牌由引擎随机抽；拒绝显式选牌**）/ mustPlay / mustPlayRandom / 集合内必出 | 3 号扩充；1/12、8 号 |
| 3 | 出牌合法性 | 禁幽魂 / 司教持牌不得跳过 / mustPass 拦截 | 9、8 号；2/11 |
| 4 | 单张落牌后检查 | 达阈值立即收束 | 10 号扩充 |
| 5 | 阶段收束条件 | 默认全员行动完 / 圈数=2 | 4 号扩充 |
| 6 | 公开前插入决策 | 未出牌者补抽 1 张 | 6 号扩充 |
| 7 | 公开方式 | 顺序公开 / 混洗 | 2 号初版（revealInOrder） |
| 8 | 结算与轮末 | （不变） | — |

> 决策点 2 强约束：3 号扩充的「随机出牌」＝玩家仍可自愿出牌或跳过，**但出牌时不能指定牌**——由引擎用种子 RNG（复用 `pickRandom(state, player.hand)`）从其手牌随机抽 1 张打出；客户端只提供「随机出牌」按钮（新动作 `playRandom`，不带 `cardId`）；若客户端提交显式 `cardId` 则拒绝该 move。

## 7. 技能逐条设计

### 7.1 初版 12 槽（等价重构，行为不变）

| 槽 | 技能 | 重构形态 |
|---|---|---|
| 1、12 | 强制出牌 | 写 `mustPlay` |
| 2 | 顺序公开 | 写 `revealInOrder` |
| 3 | **右邻**随机 | 写 `mustPlayRandom`（随机抽 1 张代打） |
| 4 | **左邻**随机 | 写 `mustPlayRandom`（随机抽 1 张代打） |
| 5 | 行动绑定 | 写 `pairs` |
| 6 | 殿后 | 写 `goLastOption` |
| 7 | 获得幽魂 | 瞬时效果（知识/牌区变更） |
| 8 | 两邻出牌 | 写 `mustPlay`（左右邻入场） |
| 9 | 暗刃侦查 | 瞬时效果（本人知识） |
| 10 | 换牌 | 写 `redrawOption` |
| 11 | 窥牌 | 瞬时效果（本人知识） |

> 重构后所有初版行为的语义、日志、时序必须逐字节一致——以 132 个现有单测为验收。

### 7.2 扩充版 12 槽（10 技能）

| 槽 | 技能 | 机制与要点 |
|---|---|---|
| 1、12 | 指定必须出牌 | 同初版 1 号（`mustPlay`） |
| 2、11 | 指定不可出牌（8 人局以上 2 人） | 写 `mustPass`；**目标规格动态**：`need = playerCount ≥ 8 ? 2 : 1`，`min=max=need` |
| 3 | 左邻随机抽取（名称仅作叙述） | 写 `randomPlay` 旗标：本轮玩家**自愿**出牌时牌由引擎随机抽（新动作 `playRandom`，拒绝显式选牌）；跳过不受影响 |
| 4 | 出牌问 2 圈，每人 2 次机会 | 写 `laps = 2`：playOrder 循环 2 圈；每人每圈 1 次出牌机会（自愿或跳过）；本轮每人最多 2 张；reveal 汇总全部牌；`played` 本轮语义扩展为"已出牌列表"（见 §13） |
| 5 | 选 1–2 名有牌玩家与自己同出（≤3 张） | 写 `trio`（出牌集合）：目标池 = 其他有手牌者，可选 min(2, 池大小)；集合 = 自己（若有牌）+ 目标；集合内**必各出 1 张**；其余玩家自动跳过；边界见 §13 |
| 6 | 洗牌前指定未出牌者随机补出 | 公开前插入决策点：chooser 从「未出牌且有手牌」者中选 1 人 → 引擎随机抽其 1 张匿名入堆；池空则无事发生 |
| 7 | 我最后一个决定是否出牌 | 同初版 6 号（`goLastOption`） |
| 8 | 司教有牌要出牌 | 写**规则旗标**（不含玩家名单）：司教持牌时其"跳过"在引擎内被判非法；公开视图只下发规则文案，不点名（身份隐藏） |
| 9 | 不能出幽魂卡 | 出牌合法性：`card.kind === 'ghost'` 一律拒绝（含夜换与技能途径获得的幽魂） |
| 10 | 出到第 3 张就混洗开牌 | 写 `revealAtCount = 3`：第 3 张落牌后立即收束出牌阶段，按匿名混洗进入公开；未行动者仍按现状记为「跳过」 |

### 7.3 效果字段（`RoundEffect` 扩展自 `RoundModifiers`）

`mustPlay` / `mustPass` / `mustPlayRandom` / `pairs` / `goLastOption` / `goLastUsed` / `redrawOption` / `revealInOrder`（既有）+ 新增：

| 字段 | 类型 | 含义 |
|---|---|---|
| `randomPlay` | `boolean` | 本轮出牌一律由系统随机抽（3 号扩充；玩家自愿出牌/跳过不变，出牌时拒绝显式选牌） |
| `laps` | `1 \| 2` | 出牌圈数（4 号） |
| `trio` | `PlayerId[] \| null` | 收窄后的出牌集合（5 号） |
| `revealAtCount` | `number \| null` | 达到该牌数立即收束（10 号） |
| `bishopMustPlay` | `boolean` | 司教持牌不得跳过（8 号） |
| `noGhost` | `boolean` | 禁出幽魂（9 号） |
| `pendingPick` | `{ chooser, pool } \| null` | 公开前补出的待选状态（6 号） |

### 7.4 新动作、新状态与 setupData 注入（四处同步）

新动作（引擎 → 客户端 moves 表 → 服务器 `movePayload` → autoPlay 托管决策，四处同步）：

- `playRandom`（3 号轮：玩家选择"出牌"，牌由引擎随机抽；**不接受 `cardId`**）。
- `pickPreShuffleTarget`（6 号：chooser 选定补出者）。

setupData 注入（建房时固化技能组；**loadout 只在服务器 ↔ 引擎之间流动**）：

- 联机：**客户端不需要传任何参数**——服务器在首个座位认领时按 `roomExtras.loadout` 组 `setupData` 并建局（见 §8）。
- 热座：`Client` 无 setupData 入参，本地构造 game 时以 `createGame(names, { loadout })` 直接注入引擎，不经过传输层。
- `setup(ctx, setupData)` 解析 setupData：缺失或非法 → 回退 `LOADOUT_BASE`（保持与旧房间/旧客户端兼容）。

## 8. 服务端设计

| 项 | 设计 |
|---|---|
| 房间字段 | `roomExtras.loadout`（默认 `LOADOUT_BASE`），随房间生命周期；重开后保留房主当前的技能组 |
| 建局通道 | **服务器侧建局**：扩展 `POST /seat-claim`——对局不存在（现返回 `no-match`）且请求带 `count` + `gameName` 时：校验变体名在注册表内、count 在 5–10 → 取 `roomExtras.loadout` 组 `setupData` → 用 `boardgame.io/internal` 的 `createMatch({ game, numPlayers, setupData, unlisted: true })` 得到 `{ initialState, metadata }` → `server.db.createMatch(matchID, …)` 建局 → 继续座位认领并返回凭据（配比非法等异常转 400）。**不用 REST `/games/:name/create`**：其 matchID 是库生成 uuid，无法使用 6 位房间码 |
| 顺序保证 | 客户端一律「先 claim 后连接」；若对局已存在但 `metadata.setupData` 与房内 loadout 不一致（如旧客户端「空连接自动建房」留下的初版对局）、且未开局（`started !== true`），`/seat-claim` 先 `db.wipe` 再按房内 loadout 重建——保证任何入口都不会把非初版房间落在初版对局上（等待中的座位会因重建而重置，属预期） |
| 房主修改 | 新端点 `POST /room-skills`（房主凭据校验，同 `/room-name` 模式）：校验 loadout（12 槽形状 + id 白名单）→ 未开局（`!started`）：更新 `roomExtras.loadout` 并**清空当前对局数据**（`db.wipe(matchID)`，与重开相同：保留房间码与房间记录），此后玩家重新认领即按新技能组建局；对局中（`started`）：拒绝并提示先「重开」。**不使用 leave**（leave 删整房会丢 loadout） |
| 加入者 | 无需任何参数与选择：服务器按房内 loadout 建局，加入者天然采用房内技能组（loadout 不经过客户端） |
| 房间信息 | `/room-info/:id` 新增 `skillset` 字段（技能组标识与显示名，如 `base`/`2025` 及中文显示名），供房间面板展示；不泄露其他信息 |
| 旧客户端降级 | 不带 `count`/`gameName` 的请求：`/seat-claim` 仍回 `no-match` → 客户端走既有「空连接自动建房」（boardgame.io `setupData: undefined` → 初版），功能不受影响，仅拿不到非初版技能组 |
| 对局同步 | sync 包不含 setupData（库限制），客户端技能文案一律从 `G.skills` 派生（`G` 随同步下发），无需读取 setupData |
| 安全 | 建局用的 loadout 全部来自服务器内存（可信输入）；`/room-skills` 入参做 id 白名单 + 12 槽形状校验，建局侧 `validateSetupData` 兜底 |
| 兼容 | 无 `setupData`（旧房间/自动建房）→ `setup` 回退 `LOADOUT_BASE`；初版 loadout 与现有行为完全一致 |

## 9. 客户端设计

- **建房流程改造（改动很小）**：`claimSeat` 请求体增加 `count` 与 `gameName`（配比变体名）两个字段；对局不存在时由服务器建局并直接返回凭据——"no-match → createRoom → 重试"不再是正常路径。`createRoom()`（空连接建房）保留为**降级路径**：服务器未更新 / 无 `gameName` / 无 uid 时仍可用，只会拿到初版技能组。
- **房间面板**：显示「技能组：初版 / 2025 扩充包」；房主可见编辑入口（下拉 + 保存；保存时二次确认"将清空当前等待中的对局数据，其他玩家刷新后重新加入"）。
- **热座**：本地设置面板增加技能组选择器（默认初版），直接传给本地 `createGame`。
- **牌桌**：技能相关文案（自己的水晶技能、轮次水晶效果、目标选择提示）**全部从 `G` 派生**，无版本分支。
- **新交互**：3 号轮「随机出牌」按钮（点击即由引擎随机抽牌，无需选牌）；6 号轮公开前的补出者选择弹窗（仅未出牌且有牌者可选）；5 号轮目标选择（动态 1–2 人，按 `min/max` 限制选择数量）。
- **4 号两圈的公开结算**："上一轮公开"区域与翻牌动画需支持每人最多 2 张牌；`lastReveal.byPlayer` 从单卡改为数组，UI 逐张渲染。

## 10. AI 托管扩展

- 3 号轮：托管者轮到 → 直接选择「随机出牌」（提交 `playRandom`，牌由引擎抽），不跳过。
- 6 号轮：托管 chooser → 从池中随机选 1 人。
- 4/5/8 号轮：托管者按"必出/集合内必出/司教必出"规则沿用现有出牌策略；4 号每圈独立决策、可在第 2 圈改跳过。
- autoPlay 决策使用动态 `TargetSpec`：按 `pool` + `min/max` 随机选取合法目标数与目标。

## 11. 落地顺序与验收标准

> 每步的「全量绿」= `npm test` 132+ 用例全过 + `npm run typecheck` 无错误；测试组映射见 §12.6。

| 步 | 内容 | 验收 |
|---|---|---|
| 1 | 初版技能重构为「插件 + 效果」形式（行为等价） | **132 个单测全绿**；热座与联机的日志/时序无差异 |
| 2 | 流程决策点显式化（不引入新技能） | 同上 |
| 3 | 实现 8 个扩充技能 + 两个新动作 + autoPlay 覆盖 + 动态 TargetSpec | 每技能单测（§12.2–12.3：发动/目标/边界/无人出牌轮/8 号不泄露身份）+ 全量绿 |
| 4 | 服务器侧建局通道（`/seat-claim` + `roomExtras.loadout` → setupData）+ 房间持有技能组 + 房主编辑 + 面板展示 | tsc 无错误；§12.5 全绿；联机实测：房主改技能组 → 清局 → 按新技能组重建；非房主无权限；旧客户端落回初版 |
| 5 | 4 号两圈的公开结算 UI 与翻牌动画（每人最多 2 张） | §12.4（reveal-anim）+ 热座/联机实测展示正确 |
| 6 | 文档（RULES.md 技能版本章节、DESIGN.md 架构条目）+ 公网更新 | 部署验证通过 |

## 12. 测试方案

测试栈：`vitest`（`npm test`）、`tsc --noEmit`（`npm run typecheck`）；用例放各模块 `__tests__/`，与现有 13 个测试文件同风格（引擎用例复用 `engine.test.ts` 的 `newGame` 工具与固定 `seed`）。

### 12.1 回归基线（步骤 1–2 的硬门槛）

- 现有 **132 个用例**（引擎 62 = `engine.test.ts` 51 + `auto-play.test.ts` 11，其余在 client/server 侧）全绿；typecheck 无错误。
- 日志/时序等价：`engine.test.ts` 已断言关键日志文本（「出牌情况」行、建局日志不含「双刃」等）——重构为「插件 + 效果」后必须原样通过，它就是"初版行为逐字不变"的证据；**禁止放宽既有断言**，新增字段先扩断言再改实现。

### 12.2 引擎单测（步骤 3，按技能新增）

建议新增 `src/engine/__tests__/loadout.test.ts` 与 `expanded-skills.test.ts`（`SetupOptions` 增加 `loadout`；固定 `seed`，随机技能用"同 seed 两次跑一致"断言确定性）：

| 技能 | 用例要点 |
|---|---|
| 扩充 1/12 | 目标必须出牌；跳过被拦；日志与初版 1 号同构 |
| 扩充 2/11 | 5–7 人 need=1、≥8 人 need=2；mustPass 拦截出牌；跳过仍合法；池不足边界 |
| 扩充 3 | `randomPlay` 生效：显式 `cardId` 被拒；`playRandom` 由引擎抽牌且同 seed 可复现；玩家仍可跳过（自愿）；公开日志不泄露候选牌过程 |
| 扩充 4 | 两圈：每人最多 2 张；第 1 圈跳过者第 2 圈仍可出；收束=2 圈完；`lastReveal` 每人多张；「出牌情况」逐张呈现 |
| 扩充 5 | 池 0/1/2+；必选 min(2,池)；自己无牌；集合内必各出 1 张；集合空 → 无人出牌轮；其余人自动跳过 |
| 扩充 6 | 公开前进入 `pickPreShuffleTarget`；选定后匿名补出；池空无事发生；不产生指向补出者的公开信息 |
| 扩充 7 | 与初版 6 号等价（同参数跑两份 loadout，断言行为一致） |
| 扩充 8 | 司教持牌时跳过被拒、必须出牌；司教无牌无约束；**隐藏性**：全量公开日志与各座位 playerView 中不出现司教座位身份关联；托管路径同样不泄露 |
| 扩充 9 | 夜换与技能 7 获得的幽魂不可出；其他牌正常 |
| 扩充 10 | 第 3 张落牌即收束；未行动者记「跳过」；<3 张不触发；公开为混洗 |
| loadout 解析 | `G.skills` 与传入一致；缺失/非法回退或拒绝；JSON 往返（序列化）不变；初版 loadout 下新增字段均为默认值 |

### 12.3 托管决策（步骤 3）

扩展 `auto-play.test.ts`：3 号轮托管出牌（`playRandom`）、6 号轮托管选人（池空/非空）、4 号两圈决策、5/8 号必出规则；现有 11 个用例保持。

### 12.4 客户端适配层（步骤 3、5）

- 交互：3 号「随机出牌」按钮、6 号选人弹窗、5 号动态目标选择（min/max 限制）——沿用 `board-actions` / adapter 测试模式补用例。
- 4 号：`reveal-anim` 用例扩展（翻牌张数 = 本轮总牌数，最高 2N）；「上一轮公开」渲染数据。
- `client-smoke.test.ts`（现有 3 个）保持全绿（含热座切视角回归）。

### 12.5 服务器 / 联机（步骤 4）

- 单元：loadout 校验（12 槽、id 白名单）、`/room-skills` 权限与 `started` 判定（与现有 account/seat 测试同风格）。
- 接口级（脚本化冒烟或手测清单）：
  1. 2025 房间首座 claim → 对局建立且 `metadata.setupData` = 房内 loadout；socket 连上后 `G.skills` 为 2025。
  2. `/room-skills`：非法 loadout → 400；非房主 → 403；`started` 时 → 拒绝。
  3. 房主改 loadout → 对局被清 → 重新 claim/连接 → 新 loadout 生效；房间码不变。
  4. 旧客户端降级：不带 `count`/`gameName` 的 claim → 仍走自动建房 → 初版可玩。
  5. 兜底路径：先用空连接建出初版对局、再在 2025 房 claim → 触发 wipe 重建为 2025。
  6. 双客户端（无头或两窗口）：不同座位进同一房间技能组一致；3 号 `playRandom`、6 号选人动作实时同步。
- 手测清单：房主改技能组 → 其他玩家刷新重进按新配置开局；8 号轮在观战视角 / 日志 / 玩家面板均不泄露司教身份；4 号两圈 5 秒翻牌动画（最多 2N 张）与「上一轮公开」展示正确。

### 12.6 步骤 ↔ 测试组映射

| 步骤 | 测试组 |
|---|---|
| 1–2 | 12.1 |
| 3 | 12.2 + 12.3 + 12.4（交互） |
| 4 | 12.5 + 12.1 |
| 5 | 12.4（reveal-anim）+ 12.5 手测 |
| 6 | §11 部署验证 |

## 13. 边界情况与风险

- **4 号（两圈）级联影响**：`played` 本轮从单卡变为列表；与"跳过"计数（每人每圈独立）、轮末换牌挂起（10 号初版不叠加）、公开结算"出牌情况"（每人最多 2 张，按圈序列出）、5 秒翻牌动画（最多 2N 张牌同时翻开后飞入"上一轮公开"）、`lastReveal.byPlayer` 结构都需联动改造，逐条定测。
- **5 号边界**：自己无牌 → 自己不出；可选 0 人 → 仅自己（若有牌）；集合空 → 走「无人出牌轮」；目标池与"有手牌"判定必须用当前手牌实况。
- **6 号**：补出牌匿名（恒按混洗公开，本技能与 2 号初版不同轮、不叠加）；补出者的「出牌情况」呈现当前拟记为"已出牌"，实现时最终确认。
- **8 号**：任何公开下发（视图/日志/提示）都不得出现指向司教座位的信息；托管与断线代打同样受该约束。`playerView`（`view.ts`）是显式逐字段构造的白名单：`G.skills`、`RoundEffect` 新字段、`pendingMagic` 的技能文案（`name/text` 需从本局 loadout 的 `SkillDef` 取，**不能再用静态 `SKILLS` 表**）都必须在其中显式下发，漏发则联机端读不到。
- **10 号**：立即收束后未行动者不再询问，按现状显示「跳过」。
- **建局通道**：联机由服务器侧建局（loadout 不经客户端；`createMatch` 依赖 `boardgame.io/internal`，0.50.2 已含类型）；热座由本地 `createGame` 注入。`validateSetupData` 返回 `string | undefined`（非 boolean），按字符串错误信息处理。
- **确定性与序列化**：`G.skills` 与 `RoundEffect` 均为可序列化数据（`SkillDef` 只存在于代码侧，按 `SkillId` 查表）；一切随机走种子 RNG，保证可复现与联机一致。
- **安全**：loadout 只接受预定义技能 id——入参校验集中在 `/room-skills`（id 白名单 + 12 槽形状），建局侧 `validateSetupData` 兜底；联机 loadout 不经客户端传输，无法伪造。
- **兼容**：初版 game 变体名、房间码、URL、现有测试全部不变；老链接与老客户端自动落回初版。
- **新增 moves**：沿用现有约定 `client: false`，避免本地乐观执行与过滤视图冲突。

## 14. 后续演进（不在本期）

- **自定义技能组合编辑器**：对 12 个槽位自由装配（同一技能可占多槽）；数据模型与引擎已天然支持，届时只需 UI + 校验扩展。
- 若将来引入"多水晶同轮发动"，再定义同决策点字段的**合并语义**（并集/取严格值等），本期无需。