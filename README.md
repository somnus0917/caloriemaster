# 食物卡路里追踪器 Demo

这是一个单文件网页 Demo：上传或拍摄食物图片后，调用通义千问 Qwen-VL 识别食物、估算克重和热量，并可在保存前微调克重。记录保存在浏览器 `localStorage` 中。

## 使用方式

推荐通过本地服务器运行，这样可以从 `.env` 读取 API 预设：

```bash
cp .env.example .env
node server.js
```

然后访问：

```text
http://localhost:8000
```

首次进入会弹出 API Key 配置，页面会优先使用 localStorage 中手动保存的值；如果没有手动保存，则使用 `.env` 里的预设：

- Qwen API Key：必填，用于调用百炼平台兼容 OpenAI 的视觉模型接口。
- 薄荷 X-Api-Key：推荐填写，用于调用薄荷开放平台新版食物详情接口 `/v1/food/detail`。
- 每日目标：默认 `2000 kcal`。
- 每日摄入上限：默认 `2300 kcal`，首页进度条和趋势图会按上限提示风险。

Key 只会保存在本机浏览器 `localStorage`，不会发送到除 Qwen/薄荷接口调用以外的服务器。

直接打开 `index.html` 仍可运行，但浏览器不能直接读取本地 `.env`，因此需要在设置弹窗里手动填写。

## 本地预览

项目内置了无依赖本地服务器，会读取 `.env` 并提供 `/env-config.js` 给页面使用：

```bash
node server.js
```

可用的 `.env` 字段：

```dotenv
QWEN_API_KEY=
QWEN_API_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
QWEN_MODEL=qwen3-vl-flash
BOOHEE_API_KEY=
DAILY_GOAL=2000
DAILY_LIMIT=2300
```

## 功能范围

- 首页看板：今日总热量、目标进度、今日记录、近 7 日 SVG 趋势图。
- 拍照引导：拍照和相册选择入口，上传前压缩图片。
- AI 识别：Qwen-VL 调用、JSON 解析、错误 toast、加载动画。
- 营养增强：薄荷开放平台命中后替换热量密度，并显示蛋白质、脂肪、碳水与食物红绿灯；失败则保留 AI 估算。
- 克重确认：滑块、步进按钮、数字输入、份量预设共用同一状态。
- 记录管理：保存到 `localStorage`，支持按钮删除、移动端左滑删除、桌面右键删除；无上传图时会优先使用薄荷食物缩略图。
- 历史页面：查看全部记录。
- 每日上限：设置中可修改摄入上限，首页展示目标、上限、剩余额度和超限提示，趋势图同时显示目标线和上限线。

页面内置了一个“演示”按钮，可以在没有 API Key 或不上传图片时体验确认和保存流程。

## 薄荷接口说明

当前实现参考薄荷文档 `https://ai.boohee.com/docs/?id=dc043193`：

- 新版详情：`GET https://api.boohee.com/v1/food/detail?code=...`
- 认证：Header 使用 `X-Api-Key`
- 当前薄荷控制台只提供 API Key，因此项目不再使用旧版令牌搜索接口；当 AI 没有返回薄荷 food code 时，会保留 AI 估算热量。
