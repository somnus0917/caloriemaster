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
: "${POSTGRES_USER:=caloriemaster}"
: "${POSTGRES_PASSWORD:=caloriemaster}"
: "${POSTGRES_DB:=caloriemaster}"
: "${POSTGRES_IMAGE:=postgres:16-alpine}"
export NODE_ENV PORT DATABASE_URL APP_ORIGIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB POSTGRES_IMAGE

# ===== 依赖 ============================================================
ensure_deps() {
  if [[ ! -d node_modules ]]; then
    info "安装依赖 (npm ci)..."
    npm ci
  fi
}

# ===== PostgreSQL ======================================================
docker_daemon_ok() {
  command -v docker >/dev/null 2>&1 || return 1
  docker info >/dev/null 2>&1 || return 1
  return 0
}

docker_pg_container_exists() {
  docker ps -a --format '{{.Names}}' 2>/dev/null | grep -q '^caloriemaster-postgres$'
}

docker_pg_run_failed() {
  local output="$1"
  err "Docker 启动 PostgreSQL 失败。"
  printf "%s\n" "$output" | sed 's/^/  /'
  if printf "%s\n" "$output" | grep -qi "pull rate limit"; then
    err "Docker Hub 拉取限流。请先执行 docker login 后重试，或改用可访问的镜像：POSTGRES_IMAGE=<registry>/postgres:16-alpine ./start.sh"
  else
    err "请检查 Docker 是否能拉取/运行镜像，或设置 POSTGRES_IMAGE 指向兼容官方 postgres 环境变量的镜像。"
  fi
}

pg_detect() {
  if docker_daemon_ok; then
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
  if command -v docker >/dev/null 2>&1; then
    echo "docker-unavailable"
    return
  fi
  echo "none"
}

PG_BACKEND="$(pg_detect)"
pg_running() {
  case "$PG_BACKEND" in
    docker)
      docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^caloriemaster-postgres$' || return 1
      docker exec caloriemaster-postgres pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB" || return 1
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

pg_running_stable() {
  pg_running || return 1
  sleep 2
  pg_running || return 1
}

pg_start() {
  if [[ "${SKIP_DB_BOOTSTRAP:-false}" == "true" ]]; then
    info "跳过本地 PostgreSQL 启动，直接使用 DATABASE_URL"
    return 0
  fi

  if pg_running_stable; then return 0; fi
  case "$PG_BACKEND" in
    docker)
      info "用 Docker 启动 PostgreSQL (${POSTGRES_IMAGE})..."
      if docker_pg_container_exists; then
        if ! run_output="$(docker start caloriemaster-postgres 2>&1)"; then
          docker_pg_run_failed "$run_output"
          exit 1
        fi
      elif ! run_output="$(docker run -d --rm --name caloriemaster-postgres \
          -e POSTGRES_USER="$POSTGRES_USER" \
          -e POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
          -e POSTGRES_DB="$POSTGRES_DB" \
          -p 5432:5432 \
          "$POSTGRES_IMAGE" 2>&1)"; then
        docker_pg_run_failed "$run_output"
        exit 1
      fi
      ;;
    docker-unavailable)
      err "检测到 docker 命令，但当前用户无法连接 Docker daemon。"
      docker info 2>&1 | sed 's/^/  /' || true
      err "处理方式：启动 Docker 服务，或在 Linux 上将当前用户加入 docker 组后重新登录：sudo usermod -aG docker \"$USER\""
      err "也可以安装本机 PostgreSQL 客户端/服务，或使用外部 DATABASE_URL 并设置 SKIP_DB_BOOTSTRAP=true。"
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
      err "没找到 PostgreSQL。请安装 PostgreSQL，或安装并启动 Docker。"
      err "macOS: brew install postgresql@16；Linux: 用系统包管理器安装 postgresql，或 sudo systemctl start docker。"
      exit 1
      ;;
  esac
  for i in $(seq 1 60); do
    if pg_running_stable; then ok "PostgreSQL 已启动"; return 0; fi
    sleep 1
  done
  err "PostgreSQL 60s 内未稳定就绪"
  exit 1
}

pg_ensure_db() {
  if [[ "${SKIP_DB_BOOTSTRAP:-false}" == "true" ]]; then
    return 0
  fi

  if [[ "$PG_BACKEND" == "docker" ]]; then
    # The official Postgres image creates this user and database on first boot.
    return 0
  fi

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
  POSTGRES_IMAGE: ${POSTGRES_IMAGE}
  SKIP_DB_BOOTSTRAP: ${SKIP_DB_BOOTSTRAP:-false}
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

  # 在 dev 模式下，CSRF 接受 Origin: localhost:5173 / 127.0.0.1:5173 / 缺失。
  # 直接 curl 3000 时必须显式带 Origin 与 APP_ORIGIN 匹配，否则 403。
  local ORIGIN="${APP_ORIGIN:-http://localhost:5173}"
  local SMOKE_EMAIL="smoke+$(date +%s)@example.com"

  smoke_request() {
    local label="$1"
    shift
    local body_file status
    body_file="$(mktemp)"

    info "$label"
    if ! status="$(curl -sS -o "$body_file" -w "%{http_code}" "$@")"; then
      cat "$body_file"
      rm -f "$body_file"
      err "冒烟测试失败: $label 请求失败"
      exit 1
    fi

    head -1 "$body_file"
    echo
    if [[ ! "$status" =~ ^2 ]]; then
      rm -f "$body_file"
      err "冒烟测试失败: $label 返回 HTTP $status"
      exit 1
    fi
    rm -f "$body_file"
  }

  smoke_request "1) GET /api/health" \
    http://127.0.0.1:3000/api/health

  rm -f /tmp/cm-smoke-cookies.txt
  smoke_request "2) POST /api/auth/register ($SMOKE_EMAIL)" \
    -c /tmp/cm-smoke-cookies.txt \
    -X POST http://127.0.0.1:3000/api/auth/register \
    -H "Content-Type: application/json" \
    -H "Origin: $ORIGIN" \
    -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"password1234\"}"

  smoke_request "3) GET /api/auth/me (with cookie)" \
    -b /tmp/cm-smoke-cookies.txt \
    http://127.0.0.1:3000/api/auth/me

  smoke_request "4) POST /api/records (no image)" \
    -b /tmp/cm-smoke-cookies.txt \
    -X POST http://127.0.0.1:3000/api/records \
    -H "Content-Type: application/json" \
    -H "Origin: $ORIGIN" \
    -d '{"timestamp":1700000000000,"mealType":"午餐","items":[{"name":"测试","weightG":100,"caloriesPer100g":100}]}'

  smoke_request "5) POST /api/auth/logout" \
    -b /tmp/cm-smoke-cookies.txt \
    -X POST http://127.0.0.1:3000/api/auth/logout \
    -H "Origin: $ORIGIN"

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
