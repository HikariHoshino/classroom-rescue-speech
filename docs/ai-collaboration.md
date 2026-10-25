# 3号模块协作说明（AI / 文字总结）

> 分支 `feat/ai`，负责人：3号（litchi-forest）。本文只写**别人要配合的事**和**接口契约**，实现细节在代码里。
> 最后更新：2026-10-25

---

## 1. 当前完成度

| 能力 | 状态 | 位置 |
| --- | --- | --- |
| `POST /api/rescue` 回溯 | ✅ 已接入，三级降级 | `server/ai/index.ts` + `server/ai/engine/` |
| `POST /api/notes` 笔记 | ✅ 已接入 | 同上 |
| `POST /api/notes/sections` 按知识点分节 | ✅ 新增，供笔记本使用 | 同上 |
| 408 真题考点权重库 | ✅ 18 份真题统计完成 | `server/ai/kb/` |
| 考点星级（★~★★★） | ✅ 随分节返回 | `server/ai/kb/match.py` |
| 真实大模型调用 | ⏸ 缺 `LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`，现在全部走原文整理 | — |

自测：`python -m unittest discover -s server/ai/engine/tests -v`（26 passed）、`npm run check`（0 error）。

---

## 2. 新接口：`POST /api/notes/sections`

给 4号 的"按知识点勾选 → 存进笔记本"用。**和 `/api/notes` 并存，原有契约一个字没动。**

请求（与 `/api/notes` 相同）：

```json
{ "sessionId": "class-001", "segments": [ { "id": "seg-01", "startMs": 0, "endMs": 8000, "text": "..." } ] }
```

响应 200：

```json
{
  "sessionId": "class-001",
  "resultMode": "extract",
  "sections": [
    {
      "id": "sec-01",
      "title": "栈",
      "points": ["栈是先进后出的线性表，只允许在一端插入和删除。"],
      "startMs": 60000,
      "segmentIds": ["seg-03", "seg-04"],
      "examStars": 2,
      "examBasis": "2010-2026 年 408 真题中 11 年出现（11 题）"
    }
  ]
}
```

- 同一个知识点的片段会**合并**成一节，按星级降序、其次按时间排序；
- `resultMode` 目前固定 `extract`（规则归类，不是模型总结），接模型后才会出现 `ai`；
- 没有文字 → 400 `no_transcript`；字段错 → 400 `invalid_request`。

---

## 3. 需要 1号 配合（4 件小事）

### 3.1 `shared/types.ts` 追加类型（原样粘贴）

```ts
/** 按知识点切分的一节笔记（3号） */
export interface NoteSection {
  id: string;
  title: string;
  points: string[];
  startMs: number;
  segmentIds: string[];
  /** 只表示该知识点在历年 408 真题中的出现频率，不代表今年一定考 */
  examStars: 0 | 1 | 2 | 3;
  examBasis: string;
}

export interface SectionsResponse {
  sessionId: string;
  resultMode: "ai" | "extract";
  sections: NoteSection[];
}

/** 笔记本（前端 localStorage 持久化，不入后端数据库） */
export interface NotebookEntry {
  id: string;
  sectionId: string;
  sessionId: string;
  title: string;
  points: string[];
  examStars: 0 | 1 | 2 | 3;
  examBasis: string;
  createdAtMs: number;
}

export interface Notebook {
  id: string;
  name: string;
  createdAtMs: number;
  updatedAtMs: number;
  entries: NotebookEntry[];
}
```

### 3.2 `src/api.ts` 追加一个函数

```ts
export async function postNoteSections(
  sessionId: string,
  segments: Segment[],
  externalSignal?: AbortSignal,
): Promise<SectionsResponse>;
```

内部沿用现有 20 秒超时 + `sessionId` 校验 + `ApiRequestError` 的写法即可。

### 3.3 `package.json` 增加 Python 引擎启动

```jsonc
"dev": "concurrently -n ai,client,server -c yellow,blue,green \"npm run dev:ai\" \"npm run dev:client\" \"npm run dev:server\"",
"dev:ai": "python server/ai/engine/server.py --port 8000",
```

> 引擎是**零第三方依赖**的标准库服务，`python` 在就能跑；即使忘了启动，`/api/rescue`、`/api/notes`、`/api/notes/sections` 仍会返回 200，只是走 TS 本地兜底（`resultMode="extract"`）。

### 3.4 环境变量与忽略项

```dotenv
# .env.example 追加
AI_ENGINE_URL=http://127.0.0.1:8000
```

```
# .gitignore 追加（npm 会在仓库根落一个缓存目录）
.npm-cache/
```

---

## 4. 需要 4号 配合（笔记本 UI）

> 前提：1号 已在 `App.tsx` 里接好 `postNoteSections` 与笔记本状态，组件只负责展示与回调。

1. **NotesPanel 下方新增「按知识点整理」列表**：每节一行 checkbox，显示 `title`、`examStars`（★/★★/★★★）、`examBasis`（小字灰）、`points` 前两条；
2. **「加入笔记本」按钮**：把勾选的 section 转成 `NotebookEntry` 抛给上层回调，不要在组件里直接写 localStorage；
3. **笔记本抽屉**：新建、切换、重命名、删除、`entries` 列表、导出 `.md`（文件名 `notebook-<名称>-<日期时间>.md`）；
4. **空状态**：没有分节时显示「停止记录后可整理成知识点」；`examStars === 0` 的节显示「未收录于真题统计」，**不要显示成 0 星或"不重要"**；
5. 390px 宽度下不横向溢出，星级与依据允许换行。

---

## 5. 数据来源、算法与边界（评委可能会问）

- **语料**：全国硕士研究生招生考试 **408 计算机学科专业基础综合**历年真题，2009–2026 共 **18 份**，公开发布、已重排为文字版；转文本后约 **23.9 万字**；
- **构建**：`python server/ai/kb/build_weights.py --input <真题txt目录>`，按题号切分后用语料统计每个知识点的覆盖年份与命中题数；
- **星级**：只按"覆盖了多少个年份"分档——**≥12 年 ★★★、6–11 年 ★★、1–5 年 ★**，未收录不标；
- **样例可核查**：`exam-weights.json` 里每个知识点都带 `samples`（年份 + 题号 + 原文片段），评委可以随手翻到那道题；
- **口径**：界面文案统一写「**疑似考点 · 参考频次 ★★☆**」，**不写"必考"**，也不预测今年考不考；
- **体积**：原始 PDF 约 62MB **不入库**（`.gitignore`），仓库里只提交统计结果 `exam-weights.json`（13KB）与构建脚本，任何人可复现；
- 为什么不"现场联网搜题库"：985/211 期末题库没有合法公开的批量来源，运行时联网会拖慢急救按钮且断网即废；联网采集放到赛前离线做，演示当天纯本地。

---

## 6. 已知风险

| 风险 | 影响 | 处置 |
| --- | --- | --- |
| 没有 LLM 密钥 | 全程 `extract`，答辩时"AI 在哪" | 15:45 前必须拿到密钥，否则按原文整理演示并如实说明 |
| Python 没装/端口占用 | 自动降级到 TS 兜底 | 不需要额外操作，日志会打印 `引擎不可达` |
| 笔记本 UI 来不及 | 加分项缺失 | 主流程不受影响，可退化为"导出 Markdown" |
| 408 语料偏考研、不完全等同校内期末 | 星级参考性有限 | 文案已写"参考频次"，并附来源与题号 |
