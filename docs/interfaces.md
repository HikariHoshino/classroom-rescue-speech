# 接口说明（docs/interfaces.md）

供 2/3/4号 接入时查阅。公共类型以 `shared/types.ts` 为准，本文件只做索引与调用关系说明。

## 1. 公共类型（shared/types.ts，1号维护）

- `InputMode = "live" | "demo"`
- `SpeechStatus = idle | starting | recording | stopping | stopped | error`
- `Segment { id, startMs, endMs, text }` —— 时间为**本节课开始的毫秒数**，界面统一转 mm:ss
- `SpeechEvent { sessionId, status, message? }`
- `RescueRequest { sessionId, capturedAtMs, fromMs, toMs, segments, contextSegments }`
- `RescueResult { missed, topic, latest, evidenceIds }`
- `RescueResponse { sessionId, resultMode: "ai" | "extract", data }`
- `NotesResponse { sessionId, resultMode, markdown }`
- `ExamHit { segmentId, keyword }`
- `ApiError { error: { code, message } }`

禁止：秒单位时间、`/api/recap`、旧方案结果字段。

## 2. HTTP 接口

| 接口 | 请求 | 响应 | 实现位置 |
| --- | --- | --- | --- |
| `GET /api/health` | — | `{ "ok": true }`，仅表示后端存活 | server/index.ts |
| `POST /api/rescue` | `RescueRequest` | `RescueResponse`；400 无有效文本/字段错误；502/504 整理失败/超时 | server/ai/index.ts（3号） |
| `POST /api/notes` | `{ sessionId, segments }`（停止后的整节课快照） | `NotesResponse`，状态码同上 | server/ai/index.ts（3号） |
| `GET /api/asr/status` | — | ASR 接入状态占位 | server/asr/index.ts（2号） |
| `WS /ws/asr` | 2号自定义内部协议 | 浏览器音频上行 | server/asr/index.ts（2号） |

窗口与上下文由 1号在 App.tsx 截取：窗口 `max(0, capturedAtMs − 120000) ~ capturedAtMs`，
`contextSegments` 为窗口前最多 30 秒。3号在服务端再次校验。

## 3. 后端注册函数（由 server/index.ts 挂载）

```ts
// 2号：server/asr/index.ts
registerAsrRoutes(app: Express, server: http.Server): void
// 在内部挂载 /ws/asr WebSocket 与所需 /api 路由

// 3号：server/ai/index.ts
registerAiRoutes(app: Express): void
// 在内部挂载 POST /api/rescue 与 POST /api/notes
```

## 4. 前端模块函数

```ts
// 2号：src/speech/index.ts（固定导出，签名不可改）
startSpeech(options: {
  sessionId: string;
  mode: InputMode;
  onSegment: (sessionId: string, item: Segment) => void; // 只发已确认片段
  onStatus: (event: SpeechEvent) => void;
}): Promise<void>;
stopSpeech(): Promise<void>; // 可重复调用且安全返回

// 3号：src/radar/index.ts（纯函数）
detectExamHits(items: Segment[]): ExamHit[];
// 词表：这个要考 / 期末 / 考试 / 注意 / 重点 / 必考（顺序即优先级，每片段只取首个命中）
// 否定表述（不会考 / 不考 / 不是重点 / 无需注意）不标星

// 1号：src/api.ts
postRescue(request: RescueRequest, externalSignal?: AbortSignal): Promise<RescueResponse>
postNotes(sessionId: string, segments: Segment[], externalSignal?: AbortSignal): Promise<NotesResponse>
// 内置 20 秒超时、外部取消、响应 sessionId 校验；错误抛 ApiRequestError
```

## 5. 组件 props（1号固定，4号完善内部，签名保持稳定）

| 组件 | 关键 props |
| --- | --- |
| `TopBar` | `mode, status, elapsedMs, canStart, canStop, canSelectMode`；回调 `onSelectMode / onStart / onStop / onNewSession` |
| `TranscriptPanel` | `segments, highlightSegmentId, status` |
| `RescuePanel` | `canRescue, loading, result: RescueResult \| null, resultMode, error, windowRange`；回调 `onRescue / onRetry` |
| `ExamRadar` | `hits: ResolvedExamHit[]（含 segmentId/keyword/startMs/text）`；回调 `onLocate(segmentId)` |
| `NotesPanel` | `canGenerate, loading, markdown, resultMode, recordedAtMs, error`；回调 `onGenerate / onRetry` |

按钮操作全部通过回调交给 `App.tsx`；组件不直接连 ASR、不读模型密钥。

## 6. 调用关系

```
2号 startSpeech ──onSegment/onStatus──▶ App.tsx（唯一 segments 状态）
                                        │ 相同 id 覆盖 + startMs 排序 + sessionId 隔离
                                        ├─▶ TranscriptPanel / ExamRadar（detectExamHits 重算）
                                        ├─点击急救 ─▶ 截取窗口+上下文 ─▶ src/api.ts postRescue
                                        │             ─▶ 3号 /api/rescue ─▶ RescuePanel
                                        └─停止后点击笔记 ─▶ postNotes ─▶ 3号 /api/notes ─▶ NotesPanel
```

- 新建课堂 / 切换模式：App 取消未完成请求并校验 sessionId，旧响应直接丢弃
- 临时识别预览不进入 segments（如需实现，2号加独立回调并通知 1号同步类型）
