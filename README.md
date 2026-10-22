# 《血与刃的白蔷薇》线上版

在线身份推理桌游的网页实现：**纯 TypeScript 规则引擎**（零框架依赖）+ **React 客户端** + **房间服务器**，支持 5–10 人的联机对局与单页热座（仅开发调试）。

## 特性

- **完整规则引擎**：夜晚阶段、12 枚水晶技能、出牌 / 换牌、公开结算与胜负判定，可独立单测
- **联机对局**：座位凭据、观战席、断线重连（对局中保留座位）、断线超 3 分钟 AI 临时托管
- **玩家身份**：游客（10 位 UID）与专属账号（9 位 UID，scrypt 加盐哈希），账号表落盘持久化
- **确定性随机**：种子随状态序列化，同一局面 + 同一动作序列 ⇒ 同一结果
- **一键部署**：Docker 构建，房间服务器与前端静态站点同源

## 快速开始

```bash
npm install
npm run dev         # 前端开发服务器 http://localhost:5173（含热座调试入口）
npm run dev:server  # 房间服务器 http://localhost:8000（联机多开测试；源码改动自动重启）
npm test            # 运行全部测试（Vitest）
npm run typecheck   # tsc --noEmit
npm run build       # 类型检查 + 生产构建（tsc + vite build）
```

联机：进入页面创建 / 加入房间，把含房间号与配比的链接发给其他人即可（同一房间需相同人数与配比）。

> 单页热座是**开发调试工具**（单窗口切换全部视角），由构建开关门控：仅 `npm run dev` 可见，生产构建不渲染热座入口、URL hash 直入热座也会回落大厅。

## 目录结构

```
src/engine/   纯规则引擎（状态机、技能、结算、AI 托管决策；零框架依赖）
src/client/   boardgame.io 适配与 React 界面（大厅、牌桌、结算动画）
src/server/   房间服务器（房间 / 账号 / 座位 API、按 IP 限流）
docs/         文档（游戏规则、设计与技术架构、服务器部署）
```

## 文档

- [开发进度与下一步](docs/PROGRESS.md) —— **跨会话交接入口**：当前坐标、已完成 / 未完成、待验证项与踩坑提醒
- [游戏规则](docs/RULES.md) —— 面向玩家与规则维护
- [设计与技术架构](docs/DESIGN.md) —— 引擎 / 适配 / 表现三层设计、隐藏信息边界、测试与验证
- [表现层改造方案](docs/UI-OVERHAUL-PLAN.md) —— 2D 插画风精美化：场景、美术清单、动效与双端（Web + 小程序）规划
- [技能组方案](docs/SKILL-LOADOUT-PLAN.md) —— 技能插件化与扩充包
- [服务器部署](docs/DEPLOYMENT.md) —— Docker 部署与运维记录

## 技术栈

React 18 · TypeScript · Vite · boardgame.io 0.50.2（版本锁定）· Vitest · Docker