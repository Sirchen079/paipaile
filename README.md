# 拍拍乐

网页联机派对对战游戏：所有人**同时出招、统一结算**，V 资源管理 + 14 招循环克制，没有无敌招。

## 玩法速览

- 访问网页需输入**访问密码**（设给玩家的）
- 房主建房得 4 位房间码，玩家输码加入（2~9 人，手机/PC 均可）
- 每回合倒计时内秘密出招（单体招需选目标），V 不足的招不可用
- 倒计时结束不出招 = 自动**爆V**（+1V）
- 被打中一次掉 1 血（血量建房可调，默认 1），最后存活者获胜

### 招式与克制（详见 `docs/superpowers/specs/`）

- **2V 反制环**：冲击波系 ←魔爆术← ... 实际闭环：魔爆克一切冲击波（含究极）→ 锤天锤地克魔爆 → 一阳指克锤天锤地 → 扭曲虚空克一阳指 → 超冲/究极克扭曲虚空 → 回到魔爆
- **飞天/遁地**躲一切单体攻击，被锤天/锤地/锤天锤地/究极针对
- **超级盾**挡一切冲击波（含究极），唯一克星是一阳指；**究极**打不中爆V者

## 本地开发

```bash
# 根目录（服务端 + 结算引擎）
npm install
npm run dev          # 服务端 http://localhost:3000（默认密码 paipai2026）

# 另开终端：前端
cd web
npm install
npm run dev          # Vite http://localhost:5173（自动代理 API/WebSocket）
```

测试与冒烟：

```bash
npm test             # 结算引擎 21 个单测
npm run smoke        # 需先起服务端；模拟 3 个机器人打完整一局
```

## 部署

一台最低配（1C1G）的 Linux 云服务器即可：单 Node 进程 + 内存房间，无数据库；前端构建产物由服务端直接托管，不需要额外的静态站点。

### 环境变量

| 变量 | 必改 | 说明 |
|---|---|---|
| `ACCESS_PASSWORD` | ✅ | 网页访问密码，玩家输这个进门。不设置会用内置默认密码，等于没锁门 |
| `COOKIE_SECRET` | ✅ | Cookie 签名密钥，用 `openssl rand -hex 32` 生成一段随机串 |
| `PORT` | — | 服务监听端口，默认 `3000` |

### 方式一：Docker 部署（推荐）

```bash
# 1. 安装 Docker（已装可跳过）
curl -fsSL https://get.docker.com | sh

# 2. 克隆仓库
git clone https://github.com/Sirchen079/paipaile.git
cd paipaile

# 3. 配置环境变量（必改！）
cp .env.example .env
vim .env      # ACCESS_PASSWORD 设成你的密码；COOKIE_SECRET 用 openssl rand -hex 32 生成

# 4. 构建并启动（app + nginx 两个容器，前端在镜像内自动构建）
docker compose up -d --build

# 5. 云厂商安全组/防火墙放行 80 端口，玩家浏览器访问 http://你的服务器IP
```

常用运维命令：

```bash
docker compose logs -f                          # 看日志
docker compose restart                          # 重启
git pull && docker compose up -d --build        # 更新到最新版
```

上 HTTPS（可选，需要域名）：证书放进 `./certs/`（`full.pem` + `key.pem`）→ 放开 `docker-compose.yml` 里 443 端口映射和 certs 挂载的注释 → 放开 `nginx.conf` 底部的 TLS server 段并把 `server_name` 改成你的域名 → `docker compose up -d` 生效。

### 方式二：Linux 裸机部署（Node.js + pm2）

不装 Docker 也行，直接常驻一个 Node 进程。

```bash
# 1. 安装 Node.js 20+（Ubuntu/Debian 示例；其它发行版用对应包管理器或 nvm）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. 克隆并安装依赖
git clone https://github.com/Sirchen079/paipaile.git
cd paipaile
npm install

# 3. 构建前端产物（产出 web/dist，服务端会直接托管它）
cd web && npm install && npm run build && cd ..

# 4. 配置环境变量（同上，必改）
cp .env.example .env
vim .env

# 5. pm2 常驻运行 + 开机自启
npm install -g pm2
pm2 start npx --name paipaile -- tsx server/index.ts
pm2 save && pm2 startup
```

此时服务跑在 `3000` 端口：要么玩家直接访问 `http://IP:3000`，要么加一层系统 nginx 转 80 端口——反代配置参考仓库根目录的 `nginx.conf`，注意 `/socket.io/` 那段的 **WebSocket 升级头（Upgrade/Connection）必须保留**，否则联机不通。

更新版本：

```bash
git pull && npm install && cd web && npm install && npm run build && cd ..
pm2 restart paipaile
```

## 项目结构

```
shared/    结算引擎（纯函数）+ 招式表 + 类型 + 单测 —— 游戏规则的唯一事实源
server/    Express 密码门 + socket.io 房间/回合状态机
web/       Vue3 + Vite 前端（登录/主页/房间/对战）
docs/      设计文档与实施计划
```

## 当前状态与路线图

- **M0 已完成**：密码门、房间、回合循环、结算引擎（21 单测）、文字战报、双端适配
- **M1 已完成**：水墨斗法场演出（事件时间表编排）、弹道与命中时刻对齐、反制/对冲打断弹道、命中停顿（hit-stop）、震屏、水墨粒子、合成音效、触觉反馈
- **M2（下一步）**：组队模式（引擎已支持）、断线重连优化、表情快捷互动、观战

## 已知限制

- 房间状态在内存中，服务重启即清空（轻量场景可接受）
- 断线后用**相同昵称**重新加入房间可找回座位
