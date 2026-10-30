# Listen Up

一个纯 Web 的 3D AI 协作解谜游戏。玩家控制 Dash，模型控制 Echo（你的浮岛搭子）；你用中文一步步指挥 Echo：往哪走、推哪个箱子、什么时候等。Echo 的能力和玩家同粒度——只会朝方位或朝目标直线走、跳、推箱、拉杆，不认识路也不懂机关联动，需要你带它。

项目目前是可玩的垂直切片：三关、完整 AI 循环、设置、对白、规则板和行动轨迹。

![首屏：你说一句，Echo 去做](docs/screenshots/title.jpg)

![第一次进入：先试一句，不用 key](docs/screenshots/prologue.jpg)

![第一关：垫脚箱](docs/screenshots/level-1.png)

![第二关：等我过桥](docs/screenshots/level-2.png)

![第三关：红地板](docs/screenshots/level-3.png)

## 运行

要求 Node.js >= 24.9 和 pnpm 11。

```sh
pnpm install
pnpm dev
```

打开 http://127.0.0.1:5173 。首次进入可以先点“试一句”看 30 秒演示，不需要 key；要玩完整关卡，再到“连接模型”里填一个支持 Chat Completions 或 Responses、并且支持 tool calling 的接口。

```sh
pnpm build      # 静态产物在 apps/web/dist
pnpm check      # 格式、lint、类型、单元/集成测试
pnpm test:e2e   # Playwright 烟雾测试
```

## 模型接口

![连接 Echo 的大脑](docs/screenshots/connect.jpg)

- 支持两种接口，二选一：

  | 接口             | 请求                              | 默认             |
  | ---------------- | --------------------------------- | ---------------- |
  | Chat Completions | `POST {baseUrl}/chat/completions` | DeepSeek、Ollama |
  | Responses        | `POST {baseUrl}/responses`        | OpenAI           |

- 两种接口都使用 `stream: true` 和 function tools；模型必须支持 tool calling。
- Base URL 可以填到 `/v1`，也可以直接贴完整的 `/v1/chat/completions` 或 `/v1/responses`。在“设置 → 自定义接口与高级设置 → 接口类型”里切换；OpenAI 预设默认走 Responses。
- Responses 模式固定 `store: false`，不让 OpenAI 保存可检索的 response；服务商自身的安全日志仍以其政策为准。为了支持无状态工具循环，当前轮的加密 reasoning 会随下一次请求带回，更早轮次只保留文字对话。
- API Key 只保存在本机 localStorage，只会发往你填写的接口地址；没有遥测和后端。
- 浏览器直连受服务商 CORS 策略影响。如果接口不允许跨域，游戏会显示连接错误；本项目按约定不内置代理。OpenAI 的 `/v1/responses` 预检已验证允许浏览器直连。
- 本地 Ollama 可以把 `OLLAMA_ORIGINS` 设为允许的页面来源；OpenAI、DeepSeek 等端点是否能从浏览器直连取决于其 CORS 配置。

## 操作

| 键       | 行为                      |
| -------- | ------------------------- |
| W A S D  | 相对镜头移动 Dash         |
| Space    | 跳跃                      |
| E        | 操作附近的拉杆            |
| 鼠标拖动 | 环绕镜头                  |
| 滚轮     | 缩放                      |
| 按住 Q   | 看向 Echo                 |
| Enter    | 打开/发送给 Echo 的指令   |
| Tab      | 打开/关闭 Echo 的行动记录 |
| H        | 打开帮助与键位            |
| P / Esc  | 暂停 / 关闭输入           |

每关开场会按当前窗口比例自动取景，先把整张地图装进画面；拖动环绕时会重新计算距离，滚轮可在全景和近景之间缩放。

右上角的“键位”入口常驻，打开后包含完整键位和本关提示；也可以按 H。

输入框默认不暂停世界：你打字时 Dash 停下，Echo 继续执行。设置里可以打开“输入时暂停世界”。发送指令后输入框会失焦，方便继续操作 Dash。

## 三关

1. **垫脚箱**：指挥 Echo 把木箱从平台推下去，Dash 踩着木箱跳上高台。高台上的拉杆连着什么，要试了才知道。
2. **等我过桥**：两岛之间只有一道缺口。谁踩机关、谁先走，靠你口头协调 Echo。
3. **红地板**：Echo 替你开门时会站在会喷发的红地板上——预警时记得叫它躲开。

三关默认全部解锁。每一关都有一个脚本解，放在测试里用于验证可解性。

### 信息与能力对齐

Echo 看到的世界和玩家镜头一样：所有物体的位置、方位、距离和表面状态（门开/关、地板发红）。但它**不知道**：

- 机关联动关系（哪个拉杆开哪座桥）——要么玩家告诉它，要么它踩上去观察后果；
- 可达性（哪里走得通）——它只会直线走，被挡或到边缘会停下问你；
- 危险倒计时——只看得到红地板"正在发红"，不知道还剩几秒。

相应地，它的工具也是玩家粒度：`walk`（朝方位走几秒）、`walk_to`（朝看得见的目标直走）、`jump`、`push_box`（朝方位推）、`use`（拉杆）、`wait` / `wait_until`（等可观察的条件，如"玩家站上机关"）。

## 结构

```text
apps/web/          React + R3F 客户端、HUD、设置、对白、轨迹抽屉
packages/sim/      确定性 World、AABB 角色控制、导航、机关、关卡
packages/agent/    Chat Completions 与 Responses 流式客户端、agent loop、工具协议
packages/game/     工具执行器、观察格式化、提示词、GameSession
packages/harness/  预留给无头场景 / 真实模型 eval
apps/web/e2e/      Playwright 烟雾测试
```

设计取舍：

- 3D 使用 three.js 与 React Three Fiber；场景声明式组织，模拟层完全独立于 React。
- 角色运动、碰撞是自研固定步长实现，不依赖物理引擎；这让 Echo 的动作、关卡解和测试都可复现。
- Echo 与玩家同粒度：感知只有方位/距离/表面状态（不泄露机关联动与解法），行动只有直线行走/跳/推/拉杆（不自动寻路绕路）。被挡或到边缘会停下并报告原因，玩家据此继续指挥。
- LLM 决定走哪、推哪、何时等；引擎只执行直线运动与碰撞。Echo 的全部行为来自工具调用，没有写死的关卡行动脚本。
- 场景与角色使用 Kenney Platformer Kit 4.1（CC0），toon 材质与低多边形浮岛。

## 已知限制

- 只支持桌面键盘鼠标，不做触屏、手柄、语音输入。
- 角色之间不做碰撞；Echo 用工具推箱，玩家直接朝木箱走就能推（箱子落地后玩家也可以继续推着走，把它挪到想要的位置）。
- Echo 只会直线走：绕路需要玩家分段指挥（"先朝北，再朝西"）。方向推箱时 Echo 会自动绕到箱子背面（这一小段由内部导航完成）。
- 没有后端、账号、云存档或代理；密钥和进度都在本机。
- 没有音频、关卡编辑器、怪物或钥匙搬运。
- 真实模型的规划质量取决于模型和接口；失败会以工具结果回到模型，重复失败会停下来让玩家介入。
- Responses 模式只覆盖 OpenAI 的 HTTP/SSE 与 function tools，不支持 WebSocket、内置工具或 `previous_response_id`。
- 代码许可证暂未指定。

## 素材与许可

模型：[Kenney Platformer Kit 4.1](https://kenney.nl/assets/platformer-kit)，CC0。原始 License.txt 位于 `apps/web/public/models/kenney/License.txt`。完整第三方清单见 [CREDITS.md](CREDITS.md)。
