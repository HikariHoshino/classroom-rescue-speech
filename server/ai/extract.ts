// 原文整理兜底（TS 版，唯一责任人：3号）
// 只在 Python 引擎未启动、超时或返回异常时使用，保证演示流程不会因为引擎挂了而黑屏。
// 注意：tsconfig.server.json 只包含 server 与 shared，所以这里不能 import src/radar；
// 下面的词表与否定窗口必须与 src/radar/index.ts、server/ai/engine/keywords.py 三处保持一致。
import type { RescueRequest, RescueResult, Segment } from "../../shared/types.js";

const EXAM_KEYWORDS = ["这个要考", "期末", "考试", "注意", "重点", "必考"] as const;
const EXAM_NEGATIONS = ["不会考", "不考", "不是重点", "无需注意"] as const;
const NEGATION_WINDOW = 6;

function findHit(text: string): string | null {
  for (const keyword of EXAM_KEYWORDS) {
    let index = text.indexOf(keyword);
    while (index !== -1) {
      const left = Math.max(0, index - NEGATION_WINDOW);
      const right = Math.min(text.length, index + keyword.length + NEGATION_WINDOW);
      const around = text.slice(left, right);
      if (!EXAM_NEGATIONS.some((neg) => around.includes(neg))) return keyword;
      index = text.indexOf(keyword, index + 1);
    }
  }
  return null;
}

export function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function clip(text: string, limit: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 1)}…`;
}

function joinTexts(texts: string[]): string {
  let merged = "";
  for (const text of texts) {
    if (!text) continue;
    if (!merged) merged = text;
    else if ("。！？；，、".includes(merged.slice(-1))) merged += text;
    else merged += `；${text}`;
  }
  return merged;
}

function tailText(segments: Segment[], limit: number): string {
  const picked: string[] = [];
  let total = 0;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const text = segments[i].text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (total + text.length > limit && picked.length > 0) break;
    picked.push(text);
    total += text.length;
    if (total >= limit) break;
  }
  picked.reverse();
  return clip(joinTexts(picked), limit);
}

function topicOf(segments: Segment[]): string {
  for (const segment of segments) {
    if (findHit(segment.text)) return clip(segment.text, 40);
  }
  return segments.length > 0 ? clip(segments[0].text, 40) : "现有转写不足以判断";
}

/** 生成 RescueResult 的原文整理版本；不推断、不补写。 */
export function extractRescue(request: RescueRequest): RescueResult {
  const window = request.segments;
  if (window.length === 0) {
    const fallback = request.contextSegments[request.contextSegments.length - 1];
    return {
      missed: "最近2分钟暂无转写，未生成回溯内容。",
      topic: "现有转写不足以判断",
      latest: fallback ? clip(fallback.text, 140) : "现有转写不足以判断",
      evidenceIds: fallback ? [fallback.id] : [],
    };
  }
  return {
    missed: tailText(window, 200),
    topic: topicOf(window),
    latest: clip(window[window.length - 1].text, 140),
    evidenceIds: window.slice(-3).map((segment) => segment.id),
  };
}

const TASK_WORDS = ["作业", "任务", "提交", "课后练习", "实验报告"];

/** 生成原文整理版 Markdown 笔记，小节顺序与引擎一致。 */
export function extractNotes(sessionId: string, segments: Segment[]): string {
  const startMs = segments.length > 0 ? segments[0].startMs : 0;
  const endMs = segments.length > 0 ? segments[segments.length - 1].endMs : 0;
  const lines: string[] = [
    "# 课堂笔记",
    "",
    `- 课堂标识：${sessionId}`,
    `- 记录范围：${mmss(startMs)} - ${mmss(endMs)}，共 ${segments.length} 段`,
    "- 整理方式：原文整理（未使用模型总结，以下内容可直接追溯到转写）",
    "",
    "## 课堂主题",
    "",
    topicOf(segments),
    "",
    "## 知识要点",
    "",
  ];

  for (const segment of segments.slice(0, 15)) {
    lines.push(`- [${mmss(segment.startMs)}] ${clip(segment.text, 100)}`);
  }
  lines.push("", "## 疑似考点（原文）", "");

  const hits = segments
    .map((segment) => ({ segment, keyword: findHit(segment.text) }))
    .filter((item) => item.keyword);
  if (hits.length === 0) {
    lines.push("- 本节未命中「这个要考 / 期末 / 考试 / 注意 / 重点 / 必考」，请以老师现场说明为准。");
  } else {
    for (const hit of hits.slice(0, 15)) {
      lines.push(`- [${mmss(hit.segment.startMs)}] 「${hit.keyword}」${clip(hit.segment.text, 100)}`);
    }
  }

  const tasks = segments.filter((segment) => TASK_WORDS.some((word) => segment.text.includes(word)));
  if (tasks.length > 0) {
    lines.push("", "## 作业与任务", "");
    for (const segment of tasks) lines.push(`- [${mmss(segment.startMs)}] ${clip(segment.text, 100)}`);
  }

  lines.push("", "## 待确认内容", "", "- 原文整理不做推断；识别不清或语义不完整的片段未补写，请对照录音确认。");
  lines.push("", `- 记录截止：${mmss(endMs)}`, "");
  return lines.join("\n");
}
