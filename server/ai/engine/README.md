# AI 引擎（3号 · 文字总结）

走神急救的「回溯」与「课后笔记」在这里生成。只用 Python 标准库，**不需要 pip install**，
演示电脑上能跑 `python` 就够。Express 适配层（`server/ai/index.ts`）是唯一调用方，浏览器不直连。

## 启动

```bash
# 仓库根目录
python server/ai/engine/server.py --port 8000

# 不调模型、用本地数据演练界面（响应头带 X-AI-Mock: 1）
python server/ai/engine/server.py --port 8000 --mock
```

自测：

```bash
python -m unittest discover -s server/ai/engine/tests -v
```

## 接口（内部）

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | `/health` | — | `{ok, engine, mock}`，只表示引擎活着 |
| POST | `/rescue` | `RescueRequest` | `{sessionId, resultMode, data:{missed,topic,latest,evidenceIds}}` |
| POST | `/notes` | `{sessionId, segments}` | `{sessionId, resultMode, markdown}` |

`resultMode` 为 `ai` 表示模型生成，`extract` 表示原文整理（模型超时 / 不可用 / 返回不合法）。
错误体固定为 `{"error":{"code","message"}}`，不含密钥与堆栈。

## 环境变量

写在仓库根目录 `.env`，由 1号 纳入 `.env.example`：

```
LLM_BASE_URL=https://your-endpoint/v1
LLM_API_KEY=只放后端
LLM_MODEL=该服务支持的模型名
LLM_TIMEOUT_SEC=15
AI_ENGINE_PORT=8000
```

`LLM_BASE_URL` 填到 `/v1` 或完整的 `/v1/chat/completions` 都可以，引擎会自动补齐。

## 降级链

1. 模型正常 → `ai`
2. 超时 / 网络失败 / 返回不是合法 JSON / 字段缺失 → 原文整理，仍 **200 + extract**
3. Python 没启动 → Express 适配层 `extract.ts` 兜底，仍 **200 + extract**
4. 完全没有文字 → **400 `EMPTY_TEXT`**

## 与前端的分工

`src/radar/detectExamHits.ts` 是同一套词表的 TS 纯函数，由 1号 在片段更新时同步调用；
本目录的 `keywords.py` 只服务于笔记的原文整理，两处规则必须一致，改动时一起改。
