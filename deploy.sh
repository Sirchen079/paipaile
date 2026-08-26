#!/usr/bin/env bash
# 拍拍乐一键部署脚本（Linux）
#
# 用法：
#   ./deploy.sh            首次部署 / 启动（校验配置 → 装依赖 → 构建前端 → 拉起服务）
#   ./deploy.sh stop       停止服务
#   ./deploy.sh restart    重启服务
#   ./deploy.sh status     查看运行状态
#   ./deploy.sh update     拉取最新代码 → 重装依赖 → 重建前端 → 重启
#   ./deploy.sh logs       跟随日志（Ctrl+C 退出）
#
# 首次使用：cp .env.example .env 并编辑好 ACCESS_PASSWORD（COOKIE_SECRET 留占位符会自动生成），
# 然后直接 ./deploy.sh 即可，浏览器访问 http://服务器IP:PORT 游玩。
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME=paipaile
LOG_FILE="$PWD/deploy.log"
PID_FILE="$PWD/.deploy.pid"

# ---------- 工具函数 ----------

env_value() {  # 从 .env 读一个变量值（不存在则空）
  grep -E "^[[:space:]]*${1}=" .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

pid_alive() {  # pidfile 里的进程还活着吗
  [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null
}

using_pm2() { command -v pm2 >/dev/null 2>&1; }

server_port() {
  local p; p="$(env_value PORT)"
  echo "${p:-25173}"
}

print_url() {
  local port; port="$(server_port)"
  echo "------------------------------------------------------------"
  echo "  就绪：浏览器访问  http://<服务器IP或域名>:${port}"
  echo "  日志：./deploy.sh logs        停止：./deploy.sh stop"
  echo "------------------------------------------------------------"
}

wait_up() {  # 等 /api/me 响应（401 也算服务已起）
  local port="$1" i
  for i in $(seq 1 30); do
    if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${port}/api/me"; then return 0; fi
    sleep 1
  done
  return 1
}

# ---------- 环境与依赖 ----------

ensure_env() {
  if [ ! -f .env ]; then
    cp .env.example .env
    echo "[!] 已从模板生成 .env，请先编辑 ACCESS_PASSWORD 再运行本脚本："
    echo "      vim .env"
    exit 1
  fi
  local pw; pw="$(env_value ACCESS_PASSWORD)"
  if [ -z "$pw" ] || [ "$pw" = "change-me" ]; then
    echo "[x] .env 里 ACCESS_PASSWORD 还是占位符/为空，请设置一个真实密码（这是玩家进门密码）"
    exit 1
  fi
  local cs; cs="$(env_value COOKIE_SECRET)"
  if [ -z "$cs" ] || [[ "$cs" == please-change-* ]]; then
    if command -v openssl >/dev/null 2>&1; then
      sed -i.bak "s|^COOKIE_SECRET=.*|COOKIE_SECRET=$(openssl rand -hex 32)|" .env && rm -f .env.bak
      echo "[√] 已自动生成 COOKIE_SECRET"
    else
      echo "[x] 请手动把 .env 的 COOKIE_SECRET 改成一段长随机串"
      exit 1
    fi
  fi
}

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    if [ "$(id -u)" = "0" ] && command -v apt-get >/dev/null 2>&1; then
      echo "[..] 未检测到 Node.js，尝试自动安装 Node 20（需要几分钟）"
      curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
      apt-get install -y nodejs
    else
      echo "[x] 未检测到 Node.js（需要 20+）。安装示例："
      echo "      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
      echo "    或使用 nvm:  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash && nvm install 20"
      exit 1
    fi
  fi
  local major; major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  if [ "${major:-0}" -lt 20 ]; then
    echo "[x] Node 版本过低（当前 $(node -v)，需要 20+），请升级后重试"
    exit 1
  fi
}

install_deps() {
  if [ ! -d node_modules ] || [ "${1:-}" = "force" ]; then
    echo "[..] 安装服务端依赖"
    npm install --omit=dev --no-audit --no-fund
  fi
}

build_web() {
  echo "[..] 构建前端（首次或更新时需要一两分钟）"
  (cd web && npm install --no-audit --no-fund && npm run build)
}

# ---------- 生命周期 ----------

do_start() {
  ensure_env
  ensure_node
  if using_pm2 && pm2 info "$APP_NAME" >/dev/null 2>&1; then
    echo "[√] 已在运行（pm2 托管）"; print_url; exit 0
  fi
  if pid_alive; then
    echo "[√] 已在运行（pid $(cat "$PID_FILE")）"; print_url; exit 0
  fi
  install_deps
  [ -d web/dist ] || build_web

  local port; port="$(server_port)"
  if using_pm2; then
    pm2 start npx --name "$APP_NAME" -- tsx server/index.ts >/dev/null
    pm2 save >/dev/null 2>&1 || true
    echo "[√] 已用 pm2 拉起（开机自启可执行: pm2 startup）"
  else
    nohup npx tsx server/index.ts >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    echo "[√] 已后台拉起（未装 pm2，用 nohup 兜底；日志: deploy.log）"
  fi

  if wait_up "$port"; then print_url
  else
    echo "[x] 服务 30 秒内未响应，请查日志：./deploy.sh logs"; exit 1
  fi
}

do_stop() {
  if using_pm2 && pm2 info "$APP_NAME" >/dev/null 2>&1; then
    pm2 delete "$APP_NAME" >/dev/null && pm2 save >/dev/null 2>&1 || true
    echo "[√] 已停止（pm2）"
  elif pid_alive; then
    kill "$(cat "$PID_FILE")" && rm -f "$PID_FILE"
    echo "[√] 已停止（pid 进程）"
  else
    echo "当前没有在运行"
  fi
}

do_restart() { do_stop; do_start; }

do_status() {
  local port; port="$(server_port)"
  if using_pm2 && pm2 info "$APP_NAME" >/dev/null 2>&1; then
    pm2 info "$APP_NAME"; echo "健康检查: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/api/me") （401=正常，密码门在工作）"
  elif pid_alive; then
    echo "运行中 pid $(cat "$PID_FILE")，健康检查: $(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:${port}/api/me") （401=正常）"
  else
    echo "未运行"
  fi
}

do_update() {
  ensure_env
  ensure_node
  echo "[..] 拉取最新代码"
  git pull --ff-only
  install_deps force
  build_web
  do_restart
}

do_logs() {
  if using_pm2 && pm2 info "$APP_NAME" >/dev/null 2>&1; then
    exec pm2 logs "$APP_NAME"
  elif [ -f "$LOG_FILE" ]; then
    exec tail -f "$LOG_FILE"
  else
    echo "暂无日志（服务未启动过）"
  fi
}

case "${1:-start}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_restart ;;
  status)  do_status ;;
  update)  do_update ;;
  logs)    do_logs ;;
  *) echo "用法: ./deploy.sh [start|stop|restart|status|update|logs]"; exit 1 ;;
esac
