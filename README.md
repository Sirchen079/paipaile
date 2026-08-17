# 🎮 拍拍乐

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

## 部署到云服务器（Docker）

```bash
# 1. 准备环境变量（必改！）
cp .env.example .env
vim .env             # 设置 ACCESS_PASSWORD 和 COOKIE_SECRET

# 2. 一键起（app + nginx）
docker compose up -d --build

# 3. 开放 80 端口，玩家访问 http://你的服务器IP 即可
```

有域名的话：把证书放进 `./certs/`，放开 `docker-compose.yml` 的 443 和 `nginx.conf` 的 TLS 段，`server_name` 改成你的域名。

不用 Docker 也可以：`npm install && cd web && npm run build && cd .. && pm2 start npx --name paipaile -- tsx server/index.ts`，再用自己的 nginx 反代（参考 `nginx.conf`，**WebSocket 升级头必须配**）。

## 项目结构

```
shared/    结算引擎（纯函数）+ 招式表 + 类型 + 单测 —— 游戏规则的唯一事实源
server/    Express 密码门 + socket.io 房间/回合状态机
web/       Vue3 + Vite 前端（登录/主页/房间/对战）
docs/      设计文档与实施计划
```

## 当前状态与路线图

- **M0 已完成**：密码门、房间、回合循环、结算引擎（21 单测）、文字战报、双端适配
- **M1（下一步）**：GSAP 事件动画、命中停顿（hit-stop）、屏幕震动、粒子特效、音效
- **M2**：组队模式（引擎已支持）、断线重连优化、表情快捷互动、观战

## 已知限制

- 房间状态在内存中，服务重启即清空（轻量场景可接受）
- 断线后用**相同昵称**重新加入房间可找回座位
