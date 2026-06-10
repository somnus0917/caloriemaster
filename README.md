# 卡路里追踪

拍照识别食物热量，薄荷数据库增强营养信息的 PWA Demo。React + Vite + TypeScript。

## 架构总览（v2）

```
┌──────────┐     /api/qwen     ┌──────────────────┐
│ 浏览器   │  ───────────────► │ 本地 Node 服务器  │  读 .env
│ (你的)   │  /api/boohee      │  server.cjs /    │  (gitignored)
│ 不持有   │  ◄─────────────── │  Vite dev plugin │  ─────►  百炼 / 薄荷
│ 任何 key │   返回识别结果    └──────────────────┘
└──────────┘
```

**关键不变量**：
- `QWEN_API_KEY` / `BOOHEE_API_KEY` 只在**服务端**读取（`.env`，已加入 `.gitignore`）。
- 浏览器只调 `/api/*`（同源），**永远不接触原始 key**。
- `dist/` 产物里不会出现任何 key 字符串。
- `.env` 不会被提交到 GitHub。

## 快速开始

```bash
cp .env.example .env       # 填入 QWEN_API_KEY（必填）和 BOOHEE_API_KEY（推荐）
npm install
npm run dev                # 打开 http://localhost:5173，无需再输入 API Key
```

## 功能范围

- 首页看板：今日总热量、目标进度、今日记录、近 7 日 SVG 趋势图。
- 拍照引导：拍照和相册选择入口，上传前自动压缩（识别 1024px / 缩略图 64px）。
- AI 识别：Qwen-VL 调用、JSON 解析、错误 toast、加载动画。
- 营养增强：薄荷开放平台命中后替换热量密度，并显示蛋白质、脂肪、碳水与食物红绿灯。
- 克重确认：滑块、步进按钮、数字输入、份量预设共用同一状态。
- 记录管理：保存到 `localStorage`，支持按钮删除、移动端左滑删除、桌面右键删除。
- 历史页面：查看全部记录。
- 每日上限：设置中可修改摄入上限，首页展示目标、上限、剩余额度和超限提示。
- 深色模式：跟随系统 `prefers-color-scheme`。
- PWA：包含 `manifest.json` 与 `sw.js`。

## API Key 配置

只需要把 key 填进项目根目录的 `.env`（从 `.env.example` 复制）：

```dotenv
QWEN_API_KEY=sk-xxxxxxxx         # 必填：百炼 / 通义千问
BOOHEE_API_KEY=sk-xxxxxxxx       # 推荐：薄荷开放平台
QWEN_MODEL=qwen3-vl-flash
```

`.env` 在 `.gitignore` 里，**不会**随代码上传到 GitHub。

设置弹窗现在只调整"每日目标 / 上限"两项，不再要求输入 API Key。

## 开发与构建

```bash
npm run dev          # Vite 开发服务器（http://localhost:5173），自带 /api/* 代理
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # Vitest
npm run build        # tsc + Vite 生产构建，输出到 dist/
npm run preview      # 仅服务 dist/ 的生产预览（同时挂 /api/* 代理）
```

## `/api/*` 端点

由 `server/api.cjs` 提供，同时挂在 `npm run dev` 的 Vite 中间件和 `npm run preview` 的 HTTP 服务器上：

| Method | Path | 说明 |
|---|---|---|
| `POST` | `/api/qwen` | 透传到 `QWEN_API_URL`，自动加 `Authorization: Bearer ${QWEN_API_KEY}` |
| `GET`  | `/api/boohee?code=xxx` | 透传到 `api.boohee.com/v1/food/detail`，自动加 `X-Api-Key` |

`QWEN_API_KEY` / `BOOHEE_API_KEY` 缺失时返回 `503` 并附明确提示。

## 薄荷食物映射

`src/data/booheeFoods.ts` 内置约 100 种中国常见食物的标准名 → 薄荷 code 映射，配合 AI prompt 让模型返回标准名，命中后能稳定拿到薄荷的精确热量、营养素、红绿灯和缩略图。冷门食物（地方菜、特定品牌、新品）大概率命中不了，需要手动扩展此表。

## 演示数据

页面内置"演示"按钮：首次点击且无真实数据时，会灌入 7 天历史演示数据让趋势图立刻有内容。

## 生产部署注意事项

`/api/*` 代理**无身份验证**——任何能访问你部署的服务器的人都能用你的 key 调用百炼/薄荷。本仓库只适合：

- 本地开发
- 部署到你自己的内网 / 家庭服务器（受防火墙保护）

如果要公开部署，必须在代理前加一层鉴权（API token / OAuth / Cloudflare Access 等）。把 `server/api.cjs` 当作参考实现，业务侧加上自己的网关。

## 目录结构

```
caloriemaster/
├── public/                  # 静态资源（manifest、sw、icons）
├── src/
│   ├── components/          # 通用 / 业务组件
│   ├── pages/               # 路由页面
│   ├── hooks/               # 自定义 React Hooks
│   ├── services/            # /api/* 客户端
│   ├── storage/             # localStorage 读写
│   ├── data/                # 静态数据 / 演示数据
│   ├── utils/               # 日期、营养、校验、CSV
│   ├── types/               # TypeScript 类型
│   ├── styles/global.css    # 全部样式
│   ├── App.tsx              # 应用根组件
│   └── main.tsx             # 入口
├── server/
│   ├── api.cjs              # /api/* 代理（共享于 dev + preview）
│   └── server.cjs           # 生产预览服务器
├── tests/                   # Vitest 测试
├── index.html               # Vite 入口
├── vite.config.ts           # Vite + 代理插件
├── vitest.config.ts
├── tsconfig.json
├── eslint.config.js
└── package.json
```
