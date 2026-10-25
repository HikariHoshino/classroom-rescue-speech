# -*- coding: utf-8 -*-
"""原文整理兜底。

原则（文档第七节）：
    * 不生成"看起来像总结"的假内容，只做可追溯的原文拼接与归类；
    * missed 只取回溯窗口内的文字；
    * 疑似考点复用 keywords 的同一套规则，并保留原句与时间；
    * 识别不清的部分不补写，统一放进"待确认内容"。

这一层在三种情况下被调用：模型超时、模型不可用、模型返回结构不合法。
"""

from typing import Dict, List, Sequence

import keywords
from prompts import mmss

MISSED_LIMIT = 200
TOPIC_LIMIT = 40
LATEST_LIMIT = 140
MAX_POINTS = 15

TASK_WORDS = ("作业", "任务", "提交", "课后练习", "实验报告")


def _clip(text: str, limit: int) -> str:
    text = " ".join(str(text).split())
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)] + "…"


def _join(texts: Sequence[str]) -> str:
    """按中文习惯拼接：上一句已带标点就不再加分隔符，避免出现「。；」。"""
    merged = ""
    for text in texts:
        if not text:
            continue
        if not merged:
            merged = text
        elif merged[-1] in "。！？；，、":
            merged += text
        else:
            merged += "；" + text
    return merged


def _tail_text(segments: Sequence[Dict[str, object]], limit: int) -> str:
    """从最新一段往前取，拼到接近 limit 字为止，保持时间顺序。"""
    picked: List[str] = []
    total = 0
    for segment in reversed(segments):
        text = " ".join(str(segment.get("text") or "").split())
        if not text:
            continue
        if total + len(text) > limit and picked:
            break
        picked.append(text)
        total += len(text)
        if total >= limit:
            break
    picked.reverse()
    return _clip(_join(picked), limit)


def _topic_of(segments: Sequence[Dict[str, object]]) -> str:
    """优先用命中考点的句子当主题线索，否则退回第一段；都拿不到就说不判断。"""
    hits = keywords.detect_hits(segments)
    if hits:
        hit_ids = {hit.get("segmentId") for hit in hits}
        for segment in segments:
            if segment.get("id") in hit_ids:
                return _clip(str(segment.get("text")), TOPIC_LIMIT)
    if segments:
        return _clip(str(segments[0].get("text")), TOPIC_LIMIT)
    return "现有转写不足以判断"


def rescue_extract(request: Dict[str, object]) -> Dict[str, object]:
    """生成 RescueResult 的原文整理版本。"""
    window: Sequence[Dict[str, object]] = request.get("segments") or []
    context: Sequence[Dict[str, object]] = request.get("contextSegments") or []

    if not window:
        # 窗口内没有文字时宁可说没有，也不拿上下文冒充"刚才错过的内容"
        fallback = context[-1] if context else None
        return {
            "missed": "最近2分钟暂无转写，未生成回溯内容。",
            "topic": "现有转写不足以判断",
            "latest": _clip(str(fallback.get("text")), LATEST_LIMIT) if fallback else "现有转写不足以判断",
            "evidenceIds": [str(fallback.get("id"))] if fallback and fallback.get("id") else [],
        }

    latest_segment = window[-1]
    evidence = [str(segment.get("id")) for segment in window[-3:] if segment.get("id")]
    return {
        "missed": _tail_text(window, MISSED_LIMIT),
        "topic": _topic_of(window),
        "latest": _clip(str(latest_segment.get("text")), LATEST_LIMIT),
        "evidenceIds": evidence,
    }


def notes_markdown(session_id: str, segments: Sequence[Dict[str, object]]) -> str:
    """原文整理版笔记，小节顺序与模型版保持一致。"""
    start_ms = int(segments[0].get("startMs") or 0) if segments else 0
    end_ms = int(segments[-1].get("endMs") or 0) if segments else 0
    hits = keywords.detect_hits(segments)
    by_id = {str(segment.get("id")): segment for segment in segments}

    lines: List[str] = [
        "# 课堂笔记",
        "",
        "- 课堂标识：%s" % session_id,
        "- 记录范围：%s - %s，共 %d 段" % (mmss(start_ms), mmss(end_ms), len(segments)),
        "- 整理方式：原文整理（未使用模型总结，以下内容可直接追溯到转写）",
        "",
        "## 课堂主题",
        "",
        _topic_of(segments),
        "",
        "## 知识要点",
        "",
    ]

    for segment in segments[:MAX_POINTS]:
        lines.append("- [%s] %s" % (mmss(int(segment.get("startMs") or 0)), _clip(str(segment.get("text")), 100)))
    if len(segments) > MAX_POINTS:
        lines.append("- ……其余 %d 段请查看完整转写" % (len(segments) - MAX_POINTS))
    lines.append("")

    lines.append("## 疑似考点（原文）")
    lines.append("")
    if hits:
        for hit in hits[:MAX_POINTS]:
            segment = by_id.get(str(hit.get("segmentId")))
            if segment is None:
                continue
            lines.append(
                "- [%s] 「%s」%s"
                % (
                    mmss(int(segment.get("startMs") or 0)),
                    hit.get("keyword"),
                    _clip(str(segment.get("text")), 100),
                )
            )
    else:
        lines.append("- 本节未命中「这个要考 / 期末 / 考试 / 注意 / 重点 / 必考」，请以老师现场说明为准。")
    lines.append("")

    task_lines = [
        "- [%s] %s" % (mmss(int(segment.get("startMs") or 0)), _clip(str(segment.get("text")), 100))
        for segment in segments
        if any(word in str(segment.get("text") or "") for word in TASK_WORDS)
    ]
    if task_lines:
        lines.append("## 作业与任务")
        lines.append("")
        lines.extend(task_lines)
        lines.append("")

    lines.extend(
        [
            "## 待确认内容",
            "",
            "- 原文整理不做推断；识别不清或语义不完整的片段未补写，请对照录音确认。",
            "",
            "- 记录截止：%s" % mmss(end_ms),
            "",
        ]
    )
    return "\n".join(lines)
