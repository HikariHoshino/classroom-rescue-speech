# 3号模块 · 协作任务清单

> 给 1号 / 4号 / 5号 看的**待办清单**。你只需要看自己名字那几行，做完打个勾。
> 分支 `feat/ai` ｜ 负责人：3号（litchi-forest）｜ 更新：2026-10-25

---

## 一页看懂：谁要做什么

| # | 谁 | 任务 | 预计 | 卡不卡别人 | 完成标志 |
|---|---|---|---|---|---|
| 1 | **1号** | `shared/types.ts` 加 4 个类型 | 5 分钟 | **卡 4号** | `npm run check` 通过 |
| 2 | **1号** | `src/api.ts` 加 `postNoteSections` | 5 分钟 | **卡 4号** | 前端能拿到 `sections` |
| 3 | **1号** | `package.json` 加 `dev:ai` 脚本 | 2 分钟 | 不卡 | `npm run dev` 同时起 Python |
| 4 | **1号** | `.env.example`、`.gitignore` 各加一行 | 1 分钟 | 不卡 | — |
| 5 | **4号** | NotesPanel 加「按知识点整理」列表 + 勾选 | 20 分钟 | 依赖 1、2 | 能勾选知识点 |
| 6 | **4号** | 笔记本抽屉（新建 / 切换 / 导出 .md） | 25 分钟 | 依赖 5 | 能把勾选内容存起来 |
| 7 | **2号** | 无强制改动 | — | — | 只需保持 `sessionId` 一致 |
| 8 | **5号** | 验收 07、10 两条（无文本 / AI 不可用） | 10 分钟 | 依赖 1–4 | 写在 `docs/test-results.md` |

> **只做 3 件事的话**：先做 1、2、3——4号 的笔记本全卡在 1 和 2 上。

---

## 1号：四件小事（都是加代码，不改逻辑）

### ☐ 1.1 `shared/types.ts` 末尾追加（原样复制）

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

/** 笔记本（前端 localStorage 持久化，不进后端数据库） */
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

### ☐ 1.2 `src/api.ts` 追加一个函数

```ts
export async function postNoteSections(
  sessionId: string,
  segments: Segment[],
  externalSignal?: AbortSignal,
): Promise<SectionsResponse>;
// 实现沿用 postNotes：POST /api/notes/sections，20 秒超时、sessionId 校验、抛 ApiRequestError
```

### ☐ 1.3 `package.json`

```jsonc
"dev": "concurrently -n ai,client,server -c yellow,blue,green \"npm run dev:ai\" \"npm run dev:client\" \"npm run dev:server\"",
"dev:ai": "python server/ai/engine/server.py --port 8000",
```

### ☐ 1.4 两个配置文件

```dotenv
# .env.example 追加
AI_ENGINE_URL=http://127.0.0.1:8000
```

```
# .gitignore 追加（npm 会在仓库根落一个 60MB 缓存目录）
.npm-cache/
```

**1号 完成标志**：`npm run check` 通过、`npm run dev` 三个进程都起来。

---

## 4号：笔记本界面（两个组件）

> 数据从 `postNoteSections` 来，结构见上面 `NoteSection`。

### ☐ 4.1 NotesPanel 底部加「按知识点整理」

- 每节一行：勾选框 + `title` + 星级（★/★★/★★★）+ `examBasis` 小字灰 + `points` 前两条；
- 点标题可 `onLocate(segmentIds[0])` 跳回原文；
- **`examStars === 0` 显示「未收录于真题统计」，不要显示成 0 星或"不重要"**；
- 空状态：「停止记录后可整理成知识点」。

### ☐ 4.2 笔记本抽屉

- 新建 / 切换 / 重命名 / 删除笔记本；
- 「加入笔记本」把勾选的 section 转成 `NotebookEntry`，**通过回调交给 App，不要在组件里直接写 localStorage**；
- 导出 `.md`，文件名 `notebook-<名称>-<日期时间>.md`；
- 390px 宽度不横向溢出。

**4号 完成标志**：勾 2 个知识点 → 加入笔记本 → 刷新页面还在 → 能导出 md。

---

## 2号 / 5号

- **2号**：AI 侧不依赖语音模块，只需保证 `onSegment` 里的 `sessionId` 和 App 一致。**无需改动**。
- **5号**：验收两条——
  - **07** 窗口内没有文字 → 应显示「最近2分钟暂无转写」，不请求模型、不编内容；
  - **10** 关掉 Python 引擎（或删掉 `LLM_API_KEY`）→ 应显示「原文整理」并保留已有内容，不报错。

---

## 接口契约（4号 对照用）

`POST /api/notes/sections`

```jsonc
// 请求（与 /api/notes 相同）
{ "sessionId": "class-001", "segments": [{ "id": "seg-01", "startMs": 0, "endMs": 8000, "text": "..." }] }

// 响应 200
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

- 同一知识点的片段会合并成一节，按星级降序、其次按时间排序；
- 无文字 → 400 `no_transcript`；字段错 → 400 `invalid_request`；
- **`/api/notes` 原契约一个字没改**，4号 不接这个接口也不影响现有笔记功能。

---

## 数据来源与口径（评委可能会问）

- **语料**：408 统考真题 2009–2026 共 **18 份**，公开文字版，约 23.9 万字；
- **构建**：`python server/ai/kb/build_weights.py --input <真题txt目录>`，按题号切分后统计；
- **星级**：只按覆盖年份分档——**≥12 年 ★★★、6–11 年 ★★、1–5 年 ★**，未收录不标；
- **可核查**：每个知识点在 `exam-weights.json` 里都带 `samples`（年份+题号+原文），能翻到原题；
- **口径**：界面统一写「**疑似考点 · 参考频次**」，**不写"必考"**，也不预测今年考不考；
- **体积**：62MB 原始 PDF 不入库，仓库只放统计结果（13KB）与构建脚本。

---

## 现在卡在哪

| 事项 | 状态 | 影响 |
|---|---|---|
| LLM 密钥（`LLM_BASE_URL / LLM_API_KEY / LLM_MODEL`） | ⏳ 等配置 | 现在全部 `resultMode="extract"`，答辩会被问"AI 在哪" |
| 1号 加类型 + api | ⏳ | 4号 无法开工 |
| 笔记本 UI | ⏳ | 加分项，做不完退化为"导出 Markdown" |

有任何一项卡住，直接在群里 @ 我，或者在这个文件下面留言。
