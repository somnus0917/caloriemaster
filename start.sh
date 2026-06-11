#!/usr/bin/env bash
# CalorieMaster 一键启动脚本
#
# 用法：
#   ./start.sh              # 启动开发模式（Fastify + Vite）
#   ./start.sh dev          # 同上
#   ./start.sh build        # 构建生产产物（不运行）
#   ./start.sh prod         # 用构建产物启动生产服务
#   ./start.sh docker       # docker compose up --build
#   ./start.sh docker:down  # docker compose down
#   ./start.sh stop         # 停止当前开发服务
#   ./start.sh reset-db     # 删库重建（慎用！）
#   ./start.sh migrate      # 只跑 Drizzle migration
#   ./start.sh help         # 打印本帮助
#
# 第一次跑？先 `cp .env.example .env` 并填好 QWEN_API_KEY / OSS_* 字段。

set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

# ===== 颜色输出 =========================================================
if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_GRN=$'\033[32m'; C_CYN=$'\033[36m'; C_RST=$'\033[0m'
else
  C_RED=""; C_YEL=""; C_GRN=""; C_CYN=""; C_RST=""
fi
info() { printf "%s[INFO]%s %s\n" "$C_CYN" "$C_RST" "$*"; }
warn() { printf "%s[WARN]%s %s\n" "$C_YEL" "$C_RST" "$*"; }
err()  { printf "%s[ERR ]%s %s\n" "$C_RED"  "$C_RST" "$*"; }
ok()   { printf "%s[OK  ]%s %s\n" "$C_GRN"  "$C_RST" "$*"; }

# ===== 检查环境 ========================================================
need_cmd() { command -v "$1" >/dev/null 2>&1 || { err "缺少命令: $1"; exit 1; }; }
need_cmd node
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  err "需要 Node.js >= 20，当前 $(node --version)"
  exit 1
fi

if [[ ! -f .env ]]; then
  if [[ -f .env.example ]]; then
    warn ".env 不存在。已复制 .env.example → .env，请填入必填字段后再跑。"
    cp .env.example .env
  else
    err ".env 和 .env.example 都不存在"
    exit 1
  fi
fi

# 用 dotenv-style 加载 .env 进当前 shell，避免 Node 进程拿不到
set -a
# shellcheck disable=SC1091
source .env
set +a

# ===== 关键变量默认值 =================================================
: "${NODE_ENV:=development}"
: "${PORT:=3000}"
: "${DATABASE_URL:=postgresql://caloriemaster:caloriemaster@localhost:5432/caloriemaster}"
: "${APP_ORIGIN:=http://localhost:5173}"

# ===== 依赖 ============================================================
ensure_deps() {
  if [[ ! -d node_modules ]]; then
    info "安装依赖 (npm ci)..."
    npm ci
  fi
}

# ===== PostgreSQL ======================================================
pg_detect() {
  if command -v docker >/dev/null 2>&1; then
    echo "docker"
    return
  fi
  if command -v /opt/homebrew/opt/postgresql@16/bin/psql >/dev/null 2>&1; then
    echo "brew"
    return
  fi
  if command -v psql >/dev/null 2>&1; then
    echo "system"
    return
  fi
  echo "none"
}

PG_BACKEND="$(pg_detect)"
pg_running() {
  case "$PG_BACKEND" in
    docker)
      docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^caloriemaster-postgres$' || return 1
      ;;
    brew)
      /opt/homebrew/opt/postgresql@16/bin/pg_isready -q -h localhost -p 5432 || return 1
      ;;
    system)
      pg_isready -q || return 1
      ;;
    *)
      return 1
      ;;
  esac
}

pg_start() {
  if pg_running; then return 0; fi
  case "$PG_BACKEND" in
    docker)
      info "用 Docker 启动 PostgreSQL..."
      docker run -d --rm --name caloriemaster-postgres \
        -e POSTGRES_USER=caloriemaster \
        -e POSTGRES_PASSWORD=caloriemaster \
        -e POSTGRES_DB=caloriemaster \
        -p 5432:5432 \
        postgres:16-alpine
      for i in $(seq 1 30); do
        if pg_running; then ok "PostgreSQL 已启动"; return 0; fi
        sleep 1
      done
      err "PostgreSQL 30s 内未就绪"
      exit 1
      ;;
    brew)
      info "用 brew PostgreSQL 启动..."
      LC_ALL="en_US.UTF-8" /opt/homebrew/opt/postgresql@16/bin/pg_ctl \
        -D /opt/homebrew/var/postgresql@16 -l /tmp/pglog.log start
      ;;
    system)
      info "用系统 PostgreSQL 启动..."
      warn "假设你的 PostgreSQL 已经能用 systemctl 或 service 启动"
      ;;
    *)
      err "没找到 PostgreSQL。请安装 brew postgres@16 或 docker"
      exit 1
      ;;
  esac
  for i in $(seq 1 30); do
    if pg_running; then ok "PostgreSQL 已启动"; return 0; fi
    sleep 1
  done
  err "PostgreSQL 30s 内未就绪"
  exit 1
}

pg_ensure_db() {
  case "$PG_BACKEND" in
    brew) PSQL="/opt/homebrew/opt/postgresql@16/bin/psql" ;;
    *)    PSQL="psql" ;;
  esac
  # 创建用户 + 数据库（如果不存在）
  local exists
  exists="$($PSQL -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='caloriemaster'" 2>/dev/null || true)"
  if [[ "$exists" != "1" ]]; then
    info "创建数据库 / 用户..."
    $PSQL -d postgres -c "CREATE USER caloriemaster WITH PASSWORD 'caloriemaster';" >/dev/null 2>&1 || true
    $PSQL -d postgres -c "CREATE DATABASE caloriemaster OWNER caloriemaster;" >/dev/null 2>&1 || true
    $PSQL -d postgres -c "GRANT ALL PRIVILEGES ON DATABASE caloriemaster TO caloriemaster;" >/dev/null 2>&1 || true
    ok "数据库已就绪"
  fi
}

migrate() {
  pg_start
  pg_ensure_db
  info "应用 Drizzle migrations..."
  npm run db:migrate
}

# ===== 帮助 ============================================================
print_help() {
  cat <<EOF
CalorieMaster 一键启动脚本

用法:
  ./start.sh              默认 (dev): 启动开发模式（Fastify + Vite 并发）
  ./start.sh dev          同上
  ./start.sh build        只跑生产构建 (tsc + vite build)
  ./start.sh prod         用构建产物启动生产服务
  ./start.sh docker       docker compose up --build
  ./start.sh docker:down  docker compose down
  ./start.sh stop         停止本机开发服务（杀掉 3000 / 5173 端口进程）
  ./start.sh migrate      只跑数据库 migration
  ./start.sh reset-db     删表重建（开发用，会清空所有数据）
  ./start.sh smoke        启动后跑冒烟测试：注册 / 登录 / 创建记录
  ./start.sh help         打印本帮助

环境:
  PG backend: ${PG_BACKEND}
  DATABASE_URL: ${DATABASE_URL}
  APP_ORIGIN: ${APP_ORIGIN}
EOF
}

# ===== 停止 ============================================================
stop_dev() {
  info "杀掉 3000 / 5173 端口的进程..."
  for port in 3000 5173; do
    local pids
    pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
    if [[ -n "$pids" ]]; then
      echo "$pids" | xargs kill -TERM 2>/dev/null || true
      ok "杀掉 port=$port 上 pid=$pids"
    fi
  done
  # 兜底：杀残留的 vite / tsx
  pkill -f "vite" 2>/dev/null || true
  pkill -f "tsx watch src/server" 2>/dev/null || true
  ok "停止完成"
}

# ===== 启动方式 ========================================================
cmd_dev() {
  ensure_deps
  migrate
  ok "环境就绪，启动开发模式..."
  exec npm run dev
}

cmd_build() {
  ensure_deps
  migrate
  info "编译 server + 构建 client..."
  npm run build
  ok "产物在 dist/ 和 dist-server/"
}

cmd_prod() {
  ensure_deps
  migrate
  if [[ ! -d dist-server || ! -d dist ]]; then
    info "首次启动，先构建..."
    npm run build
  fi
  info "启动生产服务 (NODE_ENV=production node dist-server/server/index.js)..."
  exec env NODE_ENV=production node dist-server/server/index.js
}

cmd_docker() {
  ensure_deps
  if ! command -v docker >/dev/null 2>&1; then
    err "未安装 docker"; exit 1
  fi
  info "docker compose up --build..."
  exec docker compose up --build
}

cmd_docker_down() {
  exec docker compose down
}

cmd_migrate() {
  ensure_deps
  migrate
  ok "Migration 完成"
}

cmd_reset_db() {
  ensure_deps
  migrate
  warn "准备重置数据库（TRUNCATE 所有表）..."
  case "$PG_BACKEND" in
    brew) PSQL="/opt/homebrew/opt/postgresql@16/bin/psql" ;;
    *)    PSQL="psql" ;;
  esac
  $PSQL -d caloriemaster -c "TRUNCATE sessions, ai_usage, food_items, food_records, user_settings, users RESTART IDENTITY CASCADE;"
  ok "已清空"
}

cmd_smoke() {
  ensure_deps
  migrate
  info "启动服务（后台），跑冒烟测试，再停止..."
  # 后台启动 dev
  npm run dev >/tmp/cm-dev.log 2>&1 &
  local pid=$!
  trap "kill $pid 2>/dev/null || true" EXIT

  # 等服务起来
  for i in $(seq 1 30); do
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/health 2>/dev/null | grep -q 200; then
      break
    fi
    sleep 1
  done

  info "1) GET /api/health"
  curl -s http://127.0.0.1:3000/api/health | head -1
  echo

  info "2) POST /api/auth/register (smoke@example.com)"
  rm -f /tmp/cm-smoke-cookies.txt
  curl -s -c /tmp/cm-smoke-cookies.txt -X POST http://127.0.0.1:3000/api/auth/register \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d '{"email":"smoke@example.com","password":"password1234"}' | head -1
  echo

  info "3) GET /api/auth/me (with cookie)"
  curl -s -b /tmp/cm-smoke-cookies.txt http://127.0.0.1:3000/api/auth/me | head -1
  echo

  info "4) POST /api/records (no image)"
  curl -s -b /tmp/cm-smoke-cookies.txt -X POST http://127.0.0.1:3000/api/records \
    -H "Content-Type: application/json" \
    -H "Origin: http://localhost:3000" \
    -d '{"timestamp":1700000000000,"mealType":"午餐","items":[{"name":"测试","weightG":100,"caloriesPer100g":100}]}' | head -1
  echo

  info "5) POST /api/auth/logout"
  curl -s -b /tmp/cm-smoke-cookies.txt -X POST http://127.0.0.1:3000/api/auth/logout \
    -H "Origin: http://localhost:3000" | head -1
  echo

  ok "冒烟测试完成"
}

# ===== 入口 ============================================================
case "${1:-dev}" in
  dev)            cmd_dev ;;
  build)          cmd_build ;;
  prod)           cmd_prod ;;
  docker)         cmd_docker ;;
  docker:down)    cmd_docker_down ;;
  stop)           stop_dev ;;
  migrate)        cmd_migrate ;;
  reset-db)       cmd_reset_db ;;
  smoke)          cmd_smoke ;;
  help|--help|-h) print_help ;;
  *)
    err "未知命令: $1"
    print_help
    exit 1
    ;;
esac