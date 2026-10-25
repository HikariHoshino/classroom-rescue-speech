# 走神急救按钮

课堂回溯工具：实时/演示转写、走神急救回溯、考点雷达、课后笔记。
依据《走神急救按钮_开发对齐说明》V1.0 搭建。

## 环境

- Node.js **v24.21.0**（本项目实际验证），npm 11.19.0；全组统一使用该大版本
- 2号语音模块作者在 v22.18.0 上验证过同一套测试，v22/v24 均可
- 包管理器统一 npm，锁文件为根目录 `package-lock.json`

## 启动

```bash
npm ci                      # 首次拉取；锁文件未生成时由 1号执行 npm install
cp .env.example .env        # 填入本人 ASR / LLM 配置（密钥仅放后端）
npm run dev                 # 同时启动前端(5173)与后端(3001)
```

- 前端 http://localhost:5173 ，后端 http://localhost:3001
- Vite 代理：`/api` → 后端 HTTP，`/ws` → 后端 WebSocket（已启用 ws 代理）

### ASR 联调（可选）

没有火山引擎密钥时，用本地模拟服务验证 `/ws/asr` 通道（不做真实识别）：

```bash
npx tsx server/asr/tools/mock-volc.ts          # 监听 ws://localhost:3101
# .env 中设置 ASR_WS_URL=ws://localhost:3101 与 ASR_API_KEY=任意值
npm run dev
```

用真实录音重新生成演示时间轴：

```bash
npx tsx server/asr/tools/transcribe-file.ts public/demo/lecture.wav
# 确认结果后再加 --write 覆盖 src/speech/demo-data.ts
```

## 检查

```bash
npm run check   # 前后端 + 测试文件类型检查
npm run test    # 语音模块与 ASR 路由的 8 项回归/集成测试
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

- **语音（2号）已接入**：`src/speech/` 与 `server/asr/` 为 2号交付模块，含麦克风 16k PCM 采集、
  `/ws/asr` 转发、火山引擎流式识别适配、演示音频回放与文本兜底；8 项测试在本项目通过
- **演示模式**播放 `public/demo/lecture.wav`（占位 TTS 录音），字幕来自 `src/speech/demo-data.ts`
  预置时间轴；音频加载失败时自动降级为纯文本回放，并在状态提示中标明来源
- **实时模式**需在 `.env` 配置 `ASR_API_KEY`（及可选的 `ASR_APP_ID`）；未配置时开始会明确报错
  "后端未配置识别服务密钥"，不会伪装成正常记录
- 真实识别准确率、真实麦克风浏览器测试、5号最终录音 **尚未验证**
- `/api/rescue` 与 `/api/notes` 仍返回 `resultMode: "extract"` 的**原文整理占位结果**，**未调用真实模型**
