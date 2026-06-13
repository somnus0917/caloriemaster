# 卡路里追踪 v2 — 多用户云端版

拍照识别食物热量，薄荷数据库增强营养信息的服务端 PWA。React + Vite + TypeScript 前端，Fastify + PostgreSQL 后端。

## 架构总览

```
┌──────────┐ same-origin HTTP   ┌─────────────────────────────┐
│ 浏览器   │ /api/*             │ Fastify (Node 20)           │
│ (你的)   │ credentials:"include"│   ├── Cookie Session       │
│ 不持有   │ ◄─────────────────►│   ├── /api/auth/*          │
│ 任何 key │   JSON + 错误信封  │   ├── /api/recognize-food  │
└──────────┘                     │   ├── /api/boohee          │
                                 │   ├── /api/records         │
                                 │   ├── /api/settings        │
                                 │   └── /api/health          │
                                 │             │               │
                                 │             ▼               │
                                 │   PostgreSQL 16 (Drizzle)  │
                                 │   └── users, sessions,     │
                                 │       food_records,        │
                                 │       food_items,          │
                                 │       user_settings,       │
                                 │       ai_usage             │
                                 └─────────────────────────────┘
                                  ▲                ▲
                                  │ HTTPS          │ HTTPS
                                  │                │
                       ┌──────────┴──────┐  ┌──────┴─────────┐
                       │ 百炼 (Qwen-VL)  │  │ 薄荷 (Boohee)   │
                       └─────────────────┘  └────────────────┘
```

**关键不变量**

- 浏览器只持有 `HttpOnly + SameSite=Lax` 的 session cookie。`QWEN_API_KEY` 和 `BOOHEE_API_KEY` **永远**只存在于服务端 `.env`。
- 没有任何 JWT 或 token 存到 `localStorage`。
- 所有受保护接口（recognize-food / boohee / records / settings）要求登录，401 兜底。
- 每条记录都按 `userId` 隔离；不可能跨用户读/写/删。
- 修改性请求（POST/PUT/DELETE）必须有 `Origin` 头，且与 `APP_ORIGIN` 一致，否则 403。
- `/api/recognize-food` 仍然只在服务端构造 system prompt / 模型 / 温度。客户端只能提交 `imageBase64`。
- 原始 1024px 识别图只在内存中保存，确认后立即释放；只有处理后的缩略图（512px）和原图（2048px）可能进入数据库（且仅在用户显式保存时）。

## 快速开始

### 1. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少填入 DATABASE_URL（参考 docker-compose.yml 里的默认）
# 以及 QWEN_API_KEY（生产必需）
```

### 2. 启动数据库 + 服务

**方式 A：本地开发（已装好 PostgreSQL）**

```bash
# 创建数据库与用户
psql -U postgres -c "CREATE USER caloriemaster WITH PASSWORD 'caloriemaster';"
psql -U postgres -c "CREATE DATABASE caloriemaster OWNER caloriemaster;"

# 安装依赖、跑迁移
npm install
npm run db:migrate

# 启动 dev server（Fastify + Vite 并发）
npm run dev
# → http://localhost:5173
# → API http://localhost:3000
```

**方式 B：Docker Compose（推荐）**

```bash
# 服务器生产部署：先复制并编辑 .env
cp .env.example .env
# 至少设置：
# NODE_ENV=production
# APP_ORIGIN=https://xn--rhqt4frvcyuma120e2nl3sb0w5cc9gfrdh28idgq.somnus.top
# TRUST_PROXY=true
# POSTGRES_PASSWORD=<strong-password>
# QWEN_API_KEY=<your-key>

./scripts/deploy.sh
# → https://郑思雅是全世界最可爱的宝宝.somnus.top
```

生产部署不自动跑 Drizzle migration；`./scripts/deploy.sh` 会先构建镜像、启动 PostgreSQL、用生产镜像里的编译产物显式执行 migration，再重启 app 和 Caddy。PostgreSQL 数据持久化在 named volume `pg_data`。

## 数据模型

```sql
users (
  id              uuid PK,
  email           varchar(255) UNIQUE NOT NULL,
  username        varchar(50),
  password_hash   text NOT NULL,           -- Argon2id
  created_at, updated_at
)

sessions (
  id              uuid PK,
  user_id         uuid FK users(id) ON DELETE CASCADE,
  token_hash      text UNIQUE NOT NULL,    -- SHA-256(随机 token)
  expires_at      timestamp NOT NULL,
  created_at
)

user_settings (
  user_id         uuid PK FK users(id) ON DELETE CASCADE,
  daily_target    real NOT NULL DEFAULT 2000,
  daily_limit     real NOT NULL DEFAULT 2300,
  updated_at
)

food_records (
  id              uuid PK,
  user_id         uuid FK users(id) ON DELETE CASCADE,
  source_id       varchar(100),            -- 旧 localStorage id / undo / demo
  timestamp       timestamp NOT NULL,
  meal_type       varchar(20) NOT NULL,
  total_calories  real NOT NULL,           -- 服务端重算
  thumbnail_url   text,                    -- 旧字段，仅用于迁移
  image_object_key text,                   -- OSS 缩略图对象键 (512px WebP)
  image_mime_type  varchar(30),
  image_size       integer,
  original_image_object_key text,          -- OSS 原图对象键 (2048px WebP)
  original_image_mime_type  varchar(30),
  original_image_size       integer,
  is_demo         boolean NOT NULL DEFAULT false,
  created_at, updated_at,
  UNIQUE (user_id, source_id)              -- 用于去重
)

food_items (
  id              uuid PK,
  record_id       uuid FK food_records(id) ON DELETE CASCADE,
  position        integer NOT NULL,
  name            varchar(50) NOT NULL,
  weight_g        real NOT NULL,
  calories_per_100g real NOT NULL,
  total_calories  real NOT NULL,
  confidence      varchar(10),
  calorie_source  varchar(20),
  boohee_code     varchar(50),
  protein_per_100g, fat_per_100g, carbohydrate_per_100g, health_light
)

ai_usage (
  id              uuid PK,
  user_id         uuid FK users(id) ON DELETE CASCADE,
  date            varchar(10) NOT NULL,    -- YYYY-MM-DD UTC
  count           integer NOT NULL DEFAULT 0,
  UNIQUE (user_id, date)                   -- 每日配额
)
```

完整迁移在 `migrations/0000_initial.sql`，由 Drizzle 生成。

## 认证与 Cookie 设计

- **密码哈希**：Argon2id（`memoryCost=19 MiB`、`timeCost=2`、`parallelism=1`）。明文密码从不进入数据库或日志。
- **Session Token**：`crypto.randomBytes(32)` 生成 256 位 base64url 字符串。Cookie 保存原始 token，数据库只存 `SHA-256(token)`。
- **Cookie 属性**：
  - `HttpOnly`：JS 无法读取，挡住 XSS 偷 token
  - `SameSite=Lax`：挡掉跨站 POST CSRF
  - `Secure`：生产环境开启（HTTPS）
  - `Max-Age`：30 天（可配 `SESSION_TTL_DAYS`）
  - `Path=/`
  - 没有 `Domain` 属性 → 限定在颁发 cookie 的 host
- **CSRF**：除了 SameSite，所有 `POST/PUT/DELETE/PATCH` 都校验 `Origin === APP_ORIGIN`，否则 403 `CSRF_ORIGIN_REJECTED`。
- **登录失败信息统一**：邮箱不存在 / 密码错误都返回 401 `INVALID_CREDENTIALS`，防止枚举。
- **时序安全**：对未知邮箱仍然跑一次 Argon2id 验证（用预生成的 dummy hash），让两种情况的延迟接近。

## API 列表

| Method | Path | Auth | 说明 |
|---|---|---|---|
| `GET`  | `/api/health` | – | 健康检查 |
| `POST` | `/api/auth/register` | – | 注册 + 自动登录 |
| `POST` | `/api/auth/login` | – | 登录 |
| `POST` | `/api/auth/logout` | Cookie | 退出，删除 session |
| `GET`  | `/api/auth/me` | Cookie | 当前用户信息 |
| `POST` | `/api/recognize-food` | Cookie | 图片 → Qwen |
| `GET`  | `/api/boohee?code=…` | Cookie | 营养详情 |
| `GET`  | `/api/records` | Cookie | 列表（按 timestamp 倒序） |
| `POST` | `/api/records` | Cookie | 新建 |
| `PUT`  | `/api/records/:id` | Cookie | 更新 |
| `DELETE` | `/api/records/:id` | Cookie | 删除 |
| `GET`  | `/api/records/:id` | Cookie | 单条 |
| `GET`  | `/api/records/:id/image-url` | Cookie | 返回 `{ url, expiresIn }`；浏览器用此签名 URL 加载图片。支持 `?type=original` 参数获取原图 URL |
| `POST` | `/api/records/import` | Cookie | 一次性导入（迁移用） |
| `GET`  | `/api/settings` | Cookie | 读取设置 |
| `PUT`  | `/api/settings` | Cookie | 更新设置 |

**统一错误信封**：
```json
{ "error": { "code": "STABLE_CODE", "message": "可读提示" } }
```

错误码：`INVALID_REQUEST`、`UNAUTHENTICATED`、`FORBIDDEN`、`INVALID_CREDENTIALS`、`EMAIL_ALREADY_EXISTS`、`PASSWORD_TOO_WEAK`、`SESSION_EXPIRED`、`METHOD_NOT_ALLOWED`、`ROUTE_NOT_FOUND`、`CSRF_ORIGIN_REJECTED`、`RATE_LIMITED`、`DAILY_QUOTA_EXCEEDED`、`PAYLOAD_TOO_LARGE`、`UNSUPPORTED_MEDIA`、`QWEN_NOT_CONFIGURED`、`BOOHEE_NOT_CONFIGURED`、`UPSTREAM_TIMEOUT`、`UPSTREAM_ERROR`、`NO_FOOD_DETECTED`、`RECORD_NOT_FOUND`、`DATABASE_ERROR`。

## AI 限流

| 维度 | 实现 | 默认 |
|---|---|---|
| 每用户每分钟 | 进程内存 sliding window | 5 |
| 每 IP 每分钟 | 进程内存 sliding window | 20 |
| 每用户每天 | PostgreSQL upsert | 100 |
| 每 IP 登录/注册每分钟 | 进程内存 sliding window | 10 |

**注意**：内存限流只在单实例下有效。多实例部署需要共享存储（PostgreSQL 或 Redis）。本仓库不为多实例提供开箱即用的方案。

## 反向代理（Caddy / Nginx / Cloudflare）

把反向代理放前面，HTTPS 终止、静态缓存都可以。需要在环境变量中：

```dotenv
TRUST_PROXY=true
APP_ORIGIN=https://xn--rhqt4frvcyuma120e2nl3sb0w5cc9gfrdh28idgq.somnus.top
SESSION_COOKIE_NAME=caloriemaster_session  # 可选，保持默认
```

**Caddyfile 示例**：
```
# Punycode for: 郑思雅是全世界最可爱的宝宝.somnus.top
xn--rhqt4frvcyuma120e2nl3sb0w5cc9gfrdh28idgq.somnus.top {
  reverse_proxy app:3000

  request_body {
    max_size 20MB
  }
}
```

**Nginx 示例**：
```nginx
location / {
  proxy_pass http://127.0.0.1:3000;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header Host $host;
}
```

**Cloudflare**：`TRUST_PROXY=true` + `APP_ORIGIN` 必须设为最终的 https URL。

## 阿里云 OSS 图片存储

食物记录的缩略图保存在私有 OSS Bucket 中，**前端永远拿不到 AccessKey**。

### 流程

```
浏览器 (data:image/...;base64,...)
  ↓  POST /api/records  body.thumbnailDataUrl
Fastify (认证用户)
  ├── decodeDataUrlImage  (校验 data URL 格式)
  ├── processImage / sharp (缩略图: 512px WebP, ≤500 KB)
  ├── processOriginalImage / sharp (原图: 2048px WebP, ≤5 MB)
  ├── storage.uploadRecordImage  → 阿里云 OSS 私有 Bucket (缩略图)
  ├── storage.uploadOriginalImage  → 阿里云 OSS 私有 Bucket (原图)
  ├── INSERT food_records  (仅存 imageObjectKey + originalImageObjectKey)
  └── 返回 { record }

浏览器需要查看图片时:
  GET /api/records/:id/image-url           # 缩略图 (默认)
  GET /api/records/:id/image-url?type=original  # 原图
    ↓
  Fastify 用 ObjectStorage.createSignedGetUrl 生成 10 分钟短期签名 URL
    ↓
  浏览器 <img src={signed_url}>
```

### Object Key 结构

服务端生成，客户端无法干预：

```
users/{userId}/records/{recordId}/thumbnail-{6 字节随机 hex}.webp
users/{userId}/records/{recordId}/original-{6 字节随机 hex}.webp
```

### RAM 最小权限示例

创建一个 RAM 用户或角色，仅授权：

```json
{
  "Version": "1",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "oss:PutObject",
        "oss:GetObject",
        "oss:DeleteObject"
      ],
      "Resource": "acs:oss:*:*:your-private-bucket/users/*"
    }
  ]
}
```

不要授予 `oss:*` 或 `Resource: "*"`。创建 Bucket 时关闭公共读 ACL：

```bash
# aliyun CLI: 创建时默认私有；修改 ACL（谨慎）
aliyun oss bucket setacl oss://your-private-bucket private
```

### 同地域 ECS 内网 Endpoint

如果应用部署在与 OSS Bucket 相同的地域（例如 `oss-cn-hangzhou`），可同时配置：

```dotenv
OSS_PUBLIC_ENDPOINT=https://your-private-bucket.oss-cn-hangzhou.aliyuncs.com
OSS_INTERNAL_ENDPOINT=https://your-private-bucket.oss-cn-hangzhou-internal.aliyuncs.com
```

- `OSS_INTERNAL_ENDPOINT` 用于上传 / 删除，节省带宽。
- 签名 URL 永远使用 `OSS_PUBLIC_ENDPOINT`，浏览器才能访问。

如果只配置 `OSS_PUBLIC_ENDPOINT`，服务端所有 OSS 操作都走公网；这对小流量场景完全够用。

### 失败补偿

`food_records` 与 OSS 对象不在同一个事务里，因此我们用显式补偿：

| 步骤 | 失败时 |
|---|---|
| 1. 校验 + sharp 处理（缩略图 + 原图并行） | 抛 `IMAGE_INVALID` / `IMAGE_TOO_LARGE` / `IMAGE_PROCESSING_FAILED` |
| 2. 上传 OSS（缩略图 + 原图并行） | DB 还没碰；抛 `IMAGE_UPLOAD_FAILED` |
| 3. 写 food_records / food_items | 删掉刚上传的 OSS objects（孤儿），抛 `DATABASE_ERROR` |
| 4. 删除记录（DELETE） | DB 先删，OSS 删除失败仅记日志（不影响用户） |

对象 Key 由 `users/{userId}/records/...` 前缀兜底，因此即使补偿失败留下极少量孤儿，也可以靠 RAM Policy 限定前缀减小风险面，并配合 OSS 生命周期规则定期清理 `users/*/records/*/thumbnail-*.webp` 和 `users/*/records/*/original-*.webp`。

### CORS

本轮采用"浏览器 → Fastify → OSS"，浏览器不直接跨域上传 OSS，因此 Bucket **不需要** CORS 规则让 PUT 通过。

将来若引入"浏览器直传 OSS"等场景，再为 Bucket 配置精确 CORS（不要 `*`）：

```json
[
  {
    "AllowedOrigin": ["https://calorie.example.com"],
    "AllowedMethod": ["GET", "HEAD"],
    "AllowedHeader": [],
    "ExposeHeader": ["ETag"],
    "MaxAgeSeconds": 600
  }
]
```

### 图片隐私

- Bucket 私有，Object ACL 不设置为公共读。
- 上传时设置 `Cache-Control: private, max-age=3600`，避免被 CDN 误缓存。
- 不在 OSS Metadata 里写 email / username / 原始文件名 / Session ID。
- 服务端日志**绝不**记录 Base64 / 签名 URL / Cookie Token / AccessKey。
- sharp 重编码时去掉 EXIF（包括 GPS、设备信息）。
- 缩略图和原图都经过 EXIF 剥离处理，保护用户隐私。

## 前端变化

- 启动时调用 `GET /api/auth/me`，根据 `loading | authenticated | unauthenticated` 三态决定路由。
- 登录/注册页：`src/pages/AuthForm.tsx`。失败时显示服务端 `message`。
- 主页（登录后）调用 `useRecords()` / `useSettings()`，全部走 API。
- 删除记录的撤销重新 `POST` 一条新记录（带 `sourceId: "undo-<oldId>"`），避免在数据库里"假装恢复"。
- 旧 `localStorage` 里的 `calorie_records` 数据：登录后弹出"导入历史记录"提示。用户确认后批量 `POST /api/records/import`，完成后清除旧 key。
- `useRecognitionFlow.startRecognition()` 返回 `boolean`：仅在成功时跳到确认页。`NO_FOOD_DETECTED` 时停留在拍照页。
- 编辑记录使用独立的 `EditPage` 组件，不再复用确认页面。
- 点击记录卡片的缩略图可打开 `ImageViewer` 组件查看大图（优先加载原图）。
- `useSettings()`、`useRecords()` 全部 async，失败抛错，UI 转 toast。

## localStorage 迁移

升级到 v2 后，登录成功 → `hasPendingMigration()` 检测到旧 `calorie_records` 数组 → 弹出 `MigrationPrompt` 组件。用户：

- **导入**：把每条记录通过 `POST /api/records` 上传（带 `sourceId = 原 id`），成功后才删除 localStorage；部分失败则保留旧数据让用户重试。
- **跳过**：标记 `calorie_records_migrated_v1 = done`，并删除旧 key（防止下次再问）。

`sourceId` 字段 + `(user_id, source_id) UNIQUE` 索引保证幂等：即使重复导入同一批旧记录也只会创建一次。

## 备份建议

`docker compose exec postgres pg_dump -U caloriemaster -d caloriemaster -Fc -f /tmp/backup.dump` 定期备份。`docker compose cp` 把 dump 拉出来。建议至少每日 1 次。

生产升级建议固定走：

```bash
git pull
./scripts/deploy.sh
```

## 环境变量

完整列表见 `.env.example`。重点：

- `DATABASE_URL`：Postgres 连接串。
- `APP_ORIGIN`：部署后的对外 URL（影响 CSRF 和 cookie 域）。
- `TRUST_PROXY`：是否信任 `X-Forwarded-*`。
- `SESSION_TTL_DAYS`：cookie 寿命（默认 30）。
- `QWEN_API_KEY`、`BOOHEE_API_KEY`：服务端持有，浏览器永远拿不到。
- `AI_RATE_LIMIT_PER_MINUTE`、`AI_DAILY_QUOTA`、`AUTH_RATE_LIMIT_PER_MINUTE`、`AI_IP_RATE_LIMIT_PER_MINUTE`。

启动时 `src/server/config.ts` 用 Zod 校验所有关键变量。失败立刻退出，不静默回退。

## 命令

```bash
npm run dev          # 并发启动 Fastify (3000) + Vite (5173)，Vite 代理 /api
npm run dev:server   # 仅 Fastify
npm run dev:web      # 仅 Vite
npm run build        # tsc (server) + vite build (client)
npm run start        # NODE_ENV=production node dist-server/server/index.js
npm run db:generate  # 基于 schema 生成新 migration
npm run db:migrate   # 应用 migrations
npm run db:studio    # Drizzle Studio（可视化）
npm run typecheck    # tsc --noEmit
npm run lint         # ESLint
npm test             # 全部测试
```

## 测试

```bash
# 不需要数据库的测试
npm test

# 全部测试（需要 Postgres）
docker run -d --rm --name cm-test -p 5433:5432 \
  -e POSTGRES_USER=cm -e POSTGRES_PASSWORD=cm -e POSTGRES_DB=cm \
  postgres:16-alpine
DATABASE_URL=postgresql://cm:cm@localhost:5433/cm npm test
```

不设 `DATABASE_URL` 时 `tests/server/*` 会自动跳过（输出明确提示）。

## 已知限制

1. **单实例限流**：`AI_RATE_LIMIT_PER_MINUTE` 等基于内存。多实例部署需要共享存储。
2. **没有忘记密码 / 邮箱验证**：本期不做。可以后续在 `users` 加 `email_verified` 字段并补 `/api/auth/*` 端点。
3. **没有第三方 OAuth**。
4. **图片存储在阿里云 OSS**：同时保存缩略图（512px）和原图（2048px），支持点击查看大图。
5. **食物重量仍然只是视觉估算**。登录与加密不能让它变准。`/api/recognize-food` 的 prompt 已写明不确定性。
6. **CSRF Origin 校验依赖 APP_ORIGIN**：必须正确配置。`http://` 和 `https://` 视为不同 origin。
7. **没有管理后台**：Drizzle Studio 是当前唯一的运维 UI。
8. **没有 Redis / 队列 / Kubernetes**：单体 PostgreSQL 足够个人或小团队使用。

## 目录结构

```
caloriemaster/
├── src/
│   ├── components/                # React 组件
│   │   ├── auth/                  # 暂无独立组件
│   │   ├── common/                # Modal / LoadingOverlay / SetupModal / Toast / MigrationPrompt
│   │   ├── layout/                # TopNav / BottomNav
│   │   ├── recognition/           # FoodCard / WeightAdjuster / ImagePicker
│   │   └── records/               # RecordList / RecordCard / TrendChart / ImageViewer
│   ├── data/                      # 静态数据 (booheeFoods, demoData)
│   ├── hooks/
│   │   ├── useAuth.ts             # NEW: 认证状态
│   │   ├── useRecords.ts          # API 驱动
│   │   ├── useSettings.ts         # API 驱动
│   │   ├── useRecognitionFlow.ts  # 识别流程状态机，返回 boolean
│   │   └── useToast.ts
│   ├── pages/
│   │   ├── AuthForm.tsx           # NEW: 登录 + 注册
│   │   ├── HomePage.tsx
│   │   ├── CameraPage.tsx
│   │   ├── ConfirmPage.tsx
│   │   └── HistoryPage.tsx
│   ├── server/                    # NEW: Fastify 后端
│   │   ├── index.ts               # Fastify 入口，路由注册
│   │   ├── config.ts              # Zod 环境变量校验
│   │   ├── errors.ts              # 统一错误信封
│   │   ├── ai/
│   │   │   ├── validation.ts      # 图片 / record Zod schema + 限流常量
│   │   │   ├── rateLimit.ts       # 内存限流器
│   │   │   └── routes.ts          # /api/recognize-food + /api/boohee
│   │   ├── auth/
│   │   │   ├── session.ts         # token gen / hash
│   │   │   ├── service.ts         # register / login / resolve / destroy
│   │   │   ├── middleware.ts      # requireAuth
│   │   │   └── routes.ts
│   │   ├── records/
│   │   │   ├── service.ts         # CRUD + import
│   │   │   └── routes.ts
│   │   ├── settings/
│   │   │   ├── service.ts
│   │   │   └── routes.ts
│   │   └── db/
│   │       ├── schema.ts          # Drizzle 表定义
│   │       ├── client.ts          # postgres.js 客户端
│   │       └── migrate.ts         # CLI runner
│   ├── services/                  # 浏览器侧 API 客户端
│   │   ├── auth.ts                # fetchMe / login / register / logout
│   │   ├── records.ts             # list / create / update / delete / import
│   │   ├── settings.ts
│   │   ├── qwen.ts                # POST /api/recognize-food
│   │   ├── boohee.ts
│   │   ├── http.ts                # apiRequest (含 credentials: include)
│   │   ├── image.ts               # compressForRecognition / compressForThumbnail
│   │   └── migrate.ts             # 旧 localStorage → API
│   ├── storage/                   # 已删除（迁到服务端）
│   ├── styles/global.css
│   ├── types/index.ts
│   ├── App.tsx                    # 鉴权门控路由
│   └── main.tsx
├── tests/                         # Vitest
│   ├── server/api.test.ts         # NEW: 21 个集成测试（需 PG）
│   ├── useAuth.test.ts            # NEW
│   ├── useRecords.test.ts         # 改写为 API 驱动
│   ├── recognizeFoodService.test.ts
│   ├── validation.test.ts
│   ├── csv.test.ts
│   ├── demoData.test.ts
│   └── setup.ts
├── migrations/                    # Drizzle 生成
│   └── 0000_initial.sql
├── drizzle.config.ts              # NEW
├── tsconfig.json                  # 客户端
├── tsconfig.server.json           # NEW: 服务端
├── vite.config.ts                 # 代理 /api → 3000
├── vitest.config.ts
├── eslint.config.js
├── Dockerfile                     # NEW
├── docker-compose.yml             # NEW
├── .dockerignore                  # NEW
└── .env.example                   # 完整环境变量
```
