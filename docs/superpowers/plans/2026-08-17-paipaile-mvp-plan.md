# 拍拍乐 MVP 实施计划

对应设计文档：`docs/superpowers/specs/2026-08-17-paipaile-design.md`（v0.2 已审定）
日期：2026-08-17

## 阶段划分（M0 = P1~P5，M1 单列）

| 阶段 | 内容 | 产出 / 验收 |
|---|---|---|
| P1 脚手架 | 根 package.json（server+shared）、web/ Vite+Vue3、TS 配置、.gitignore | `npm run dev` 两端可起 |
| P2 结算引擎 | shared/：类型、招式表、resolveRound 纯函数、判定矩阵 | `npm test` 全绿（矩阵逐格+对冲三角+取消链+边界） |
| P3 服务端 | express 密码门（HMAC cookie）、socket.io 房间/回合状态机、超时自动爆V | curl 登录拿 cookie；smoke 脚本 3 客户端打完整局 |
| P4 前端 M0 | 登录/主页/房间/对战四个视图，文字战报，出招面板+目标选择+倒计时 | 手机+PC 浏览器多标签可完整游玩 |
| P5 部署物 | Dockerfile、docker-compose（app+nginx）、nginx 示例、README、.env.example | 服务器一键起 |
| M1 表演层 | GSAP 事件动画、hit-stop、屏幕震动、粒子（后续单独计划） | 玩家试玩"爽" |

## 关键实现决定

- 单仓库两包：根目录 = server + shared（tsx 直跑），web/ = Vite 应用（`@shared` 别名引共享类型）。
- 引擎纯函数 `resolveRound(players, submissions, config, round) → {events, players}`，事件流同时驱动服务端广播与前端演出。
- 服务端权威：一切校验（V 足否、目标合法、存活）在服务端；前端只做可用性置灰。
- 倒计时用服务端 deadline 时间戳 + serverNow 校正，避免客户端时钟漂移。
- 表演等待时长 = min(8s, 2s + 0.6s×事件数)，服务端控制节奏。
- 密码与密钥走环境变量（ACCESS_PASSWORD / COOKIE_SECRET）。

## P2 引擎测试清单（对应设计文档 §3.3）

1. 判定矩阵逐格：9 个攻击招 × 典型防守招（爆V/普盾/超盾/上天/下地/各架势）
2. 对冲三角：A→B、B→C、C→A（非互指不抵消）；互指同档抵消；高低档压制
3. 取消链：魔爆取消普冲/超冲/究极并反伤；扭曲虚空取消一阳指并反伤
4. D1：飞天/遁地躲全部单体招；被锤天/锤地/锤天锤地/究极命中
5. 边界：爆V 到 99 封顶；超时未出招自动爆V；多人同回合阵亡（同时扣血）；友伤开关
