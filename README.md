# 走神急救按钮

课堂回溯工具：实时/演示转写、走神急救回溯、考点雷达、课后笔记。
依据《走神急救按钮_开发对齐说明》V1.0 搭建，当前为**可启动公共骨架**。

## 环境

- Node.js **v24.21.0**（已实际验证），npm 11.19.0；全组统一使用该大版本
- 包管理器统一 npm，锁文件为根目录 `package-lock.json`

## 启动

```bash
npm ci                      # 首次拉取；锁文件未生成时由 1号执行 npm install
cp .env.example .env        # 填入本人 ASR / LLM 配置（密钥仅放后端）
npm run dev                 # 同时启动前端(5173)与后端(3001)
```

- 前端 http://localhost:5173 ，后端 http://localhost:3001
- Vite 代理：`/api` → 后端 HTTP，`/ws` → 后端 WebSocket（已启用 ws 代理）

## 检查

```bash
npm run check   # 前后端类型检查（tsc client + server）
npm run build   # 前端构建检查（tsc client + vite build）
```

## 目录与负责人（只改自己负责的文件）

| 路径 | 负责人 | 用途 |
| --- | --- | --- |
| `shared/types.ts` | 1号 | 公共类型与接口字段（唯一来源） |
| `src/App.tsx` `src/api.ts` | 1号 | 唯一课堂状态、模块连接、HTTP 封装 |
| `src/speech/` `server/asr/` | 2号 | 音频采集、ASR 适配、回放、语音路由 |
| `server/ai/` `src/radar/` | 3号 | AI 路由与整理函数、纯关键词检测 |
| `src/components/` `src/styles/` | 4号 | 展示组件与页面样式 |
| `demo/` `public/demo/` `docs/` | 5号为主 | 讲稿、音频、操作说明、问题清单 |
| `src/speech/demo-data.ts` | 2号 | 将 5号讲稿转为带时间戳的回放数据 |
| `server/index.ts` 工程配置 README | 1号 | 启动入口、路由挂载、依赖、代理 |

## 分支

- `main` 保持可运行，仅由 1号合入
- 1号 `feat/integration`；2号 `feat/speech`；3号 `feat/ai`；4号 `feat/ui`；5号 `docs/demo`

## 当前完成口径（重要）

- 演示模式播放的是 `src/speech/demo-data.ts` 中**手工编写的示例数据**，**不是真实 ASR 结果**
- 实时模式（live）**尚未接入**，点击开始会明确提示"实时语音尚未接入"
- `/api/rescue` 与 `/api/notes` 当前返回 `resultMode: "extract"` 的**原文整理占位结果**，**未调用真实模型**
- 公共类型、状态机、回溯窗口截取、考点检测、组件连接已可用
