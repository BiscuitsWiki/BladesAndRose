# 「血与刃的白蔷薇」生产镜像
# 同一个 Node 进程托管：前端构建产物（dist，同源）+ boardgame.io 服务（socket.io + REST）
# 基础镜像用 node:22-alpine：体积小、国内服务器上已缓存（免拉取超时），本项目不依赖原生扩展
FROM node:22-alpine

WORKDIR /app

# 依赖层：只有 package*.json 变化时才重装依赖（npm 走国内镜像源加速）
COPY package.json package-lock.json ./
RUN npm ci --registry=https://registry.npmmirror.com

# 源码层：tsc 类型检查 + vite 构建前端
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
# 静态资源（卡面美术等）；缺了这一行线上会没有图
COPY public ./public
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8000

# 房间服务器（含生产静态站点托管）；账号表落盘 data/accounts.json（由 compose 挂卷持久化）
CMD ["npx", "tsx", "src/server/dev-server.ts"]