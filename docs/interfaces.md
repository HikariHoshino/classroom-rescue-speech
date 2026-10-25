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
- `NoteSection { id, title, points, startMs, segmentIds, examStars: 0|1|2|3, examBasis }`
- `NoteSectionsResponse { sessionId, resultMode, sections: NoteSection[] }`
- `ApiError { error: { code, message } }`

禁止：秒单位时间、`/api/recap`、旧方案结果字段。

## 2. HTTP 接口

| 接口 | 请求 | 响应 | 实现位置 |
| --- | --- | --- | --- |
| `GET /api/health` | — | `{ "ok": true }`，仅表示后端存活 | server/index.ts |
| `POST /api/rescue` | `RescueRequest` | `RescueResponse`；400 无有效文本/字段错误；502/504 整理失败/超时 | server/ai/index.ts（3号） |
| `POST /api/notes` | `{ sessionId, segments }`（停止后的整节课快照） | `NotesResponse`，状态码同上 | server/ai/index.ts（3号） |
| `POST /api/notes/sections` | `{ sessionId, segments }` | `NoteSectionsResponse`（按知识点分节 + 408 真题星级） | server/ai/index.ts（3号） |
| `WS /ws/asr` | 二进制 PCM（16k/16bit/单声道）+ `{"type":"end"}` | `ready` / `segment` / `done` / `error` | server/asr/index.ts（2号，已交付） |

窗口与上下文由 1号在 App.tsx 截取：窗口 `max(0, capturedAtMs − 120000) ~ capturedAtMs`，
`contextSegments` 为窗口前最多 30 秒。3号在服务端再次校验。

## 3. 后端注册函数（由 server/index.ts 挂载）

```ts
// 2号：server/asr/index.ts（已交付，签名以此为准）
registerAsrRoutes(server: http.Server): void
// 内部用 WebSocketServer({ noServer: true }) 监听 upgrade，仅处理 /ws/asr
// 内部消息协议：浏览器→后端 二进制=PCM，文本 {"type":"end"}；
//              后端→浏览器 {"type":"ready"} / {"segment",segment} / {"type":"done"} / {"type":"error",message}
// 密钥只在此读取 process.env（ASR_APP_ID / ASR_API_KEY / ASR_RESOURCE_ID / ASR_WS_URL）

// 3号：server/ai/index.ts
registerAiRoutes(app: Express): void
// 在内部挂载 POST /api/rescue、POST /api/notes、POST /api/notes/sections
// 适配层 → Python 引擎 127.0.0.1:8000（AI_ENGINE_URL 可改，AI_ENGINE_TIMEOUT_MS 默认 16000）
// 降级链：模型 → 引擎内原文整理 → extract.ts 本地原文整理，任一级失败都不返回 5xx 给页面
```

## 3.1 笔记分节预览（3号 → 4号）

`src/components/NotesSectionsPreview.tsx` 已可渲染，**尚未接入页面**。4号 接入方式见组件头部注释：

```tsx
<NotesSectionsPreview
  sections={sections}                 // 来自 postNoteSections(sessionId, segments)
  loading={sectionsLoading}
  onLocate={props.onLocate}           // 复用 App 的定位回调
  onToggle={(sectionId, checked) => {/* 交给 App 决定是否写入笔记本 */}}
/>
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
