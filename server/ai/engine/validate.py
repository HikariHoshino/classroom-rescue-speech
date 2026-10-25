# -*- coding: utf-8 -*-
"""入参校验与模型返回字段校验。

文档第六节要求「窗口和上下文由 1号 截取，3号 再次校验」，所以这里做四件事：
    1. 结构校验：缺字段、类型不对、时间倒挂 -> 400；
    2. 防御性归一：去重、按 startMs 排序、剔除空文本、endMs 不小于 startMs；
    3. 空文本判定：过滤后没有任何文字 -> 400 EMPTY_TEXT（不能返回编造的总结）；
    4. 模型输出校验：三个字段必须是非空字符串，evidenceIds 只能引用本次请求里的片段。
"""

import re
from typing import Any, Dict, Iterable, List, Sequence, Set

MAX_SEGMENTS = 2000
MAX_SESSION_ID = 128

# 每项正文的硬上限（汉字）。只作为模型跑偏时的保护，提示词要求三项合计不超过 110 字。
FIELD_LIMIT = {"missed": 140, "topic": 24, "latest": 40}


class BadRequest(Exception):
    """可以直接映射成 400/502 的业务异常。"""

    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status


def _as_number(value: Any, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise BadRequest("INVALID_REQUEST", f"{name} 必须是数字（毫秒）")
    if value < 0:
        raise BadRequest("INVALID_REQUEST", f"{name} 不能为负数")
    return int(round(value))


def _as_text(value: Any, name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise BadRequest("INVALID_REQUEST", f"{name} 必须是非空字符串")
    return value.strip()


def _clean_text(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    text = re.sub(r"\s+", " ", value).strip()
    return text


def parse_segments(items: Any, name: str) -> List[Dict[str, Any]]:
    """校验片段数组；坏片段丢弃而不是整单失败，保证有字就能演示。"""
    if items is None:
        return []
    if not isinstance(items, list):
        raise BadRequest("INVALID_REQUEST", f"{name} 必须是数组")
    if len(items) > MAX_SEGMENTS:
        raise BadRequest("INVALID_REQUEST", f"{name} 超过 {MAX_SEGMENTS} 段")

    by_id: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []
    for raw in items:
        if not isinstance(raw, dict):
            continue
        seg_id = _clean_text(raw.get("id"))
        text = _clean_text(raw.get("text"))
        if not seg_id or not text:
            continue
        try:
            start_ms = _as_number(raw.get("startMs"), "startMs")
            end_ms = _as_number(raw.get("endMs"), "endMs")
        except BadRequest:
            continue
        if end_ms < start_ms:
            end_ms = start_ms
        # 相同 id 覆盖更新，不追加重复文本（文档第四节）
        if seg_id not in by_id:
            order.append(seg_id)
        by_id[seg_id] = {
            "id": seg_id,
            "startMs": start_ms,
            "endMs": end_ms,
            "text": text,
        }

    segments = [by_id[seg_id] for seg_id in order]
    segments.sort(key=lambda item: (item["startMs"], item["id"]))
    return segments


def parse_rescue(body: Any) -> Dict[str, Any]:
    if not isinstance(body, dict):
        raise BadRequest("INVALID_REQUEST", "请求体必须是 JSON 对象")

    session_id = _as_text(body.get("sessionId"), "sessionId")
    if len(session_id) > MAX_SESSION_ID:
        raise BadRequest("INVALID_REQUEST", f"sessionId 超过 {MAX_SESSION_ID} 个字符")

    captured_at = _as_number(body.get("capturedAtMs"), "capturedAtMs")
    from_ms = _as_number(body.get("fromMs"), "fromMs")
    to_ms = _as_number(body.get("toMs"), "toMs")
    if from_ms > to_ms:
        raise BadRequest("INVALID_REQUEST", "fromMs 不能大于 toMs")

    segments = parse_segments(body.get("segments"), "segments")
    context = parse_segments(body.get("contextSegments"), "contextSegments")
    if not segments and not context:
        raise BadRequest("EMPTY_TEXT", "最近2分钟暂无转写，无法回溯")

    return {
        "sessionId": session_id,
        "capturedAtMs": captured_at,
        "fromMs": from_ms,
        "toMs": to_ms,
        "segments": segments,
        "contextSegments": context,
    }


def parse_notes(body: Any) -> Dict[str, Any]:
    if not isinstance(body, dict):
        raise BadRequest("INVALID_REQUEST", "请求体必须是 JSON 对象")

    session_id = _as_text(body.get("sessionId"), "sessionId")
    if len(session_id) > MAX_SESSION_ID:
        raise BadRequest("INVALID_REQUEST", f"sessionId 超过 {MAX_SESSION_ID} 个字符")

    segments = parse_segments(body.get("segments"), "segments")
    if not segments:
        raise BadRequest("EMPTY_TEXT", "本节没有可整理的转写内容")

    return {"sessionId": session_id, "segments": segments}


def _clip(text: str, limit: int) -> str:
    text = _clean_text(text)
    if len(text) <= limit:
        return text
    return text[: max(1, limit - 1)] + "…"


def _strip_label(text: str, key: str) -> str:
    """模型偶尔会带 "missed：" 这类前缀，去掉以免卡片上重复。"""
    return re.sub(r"^%s\s*[:：]\s*" % key, "", text.strip(), flags=re.IGNORECASE)


def normalize_result(raw: Any, allowed_ids: Iterable[str]) -> Dict[str, Any]:
    """校验并裁剪模型返回；字段缺失或全空时抛 BadRequest，由上层转原文整理。"""
    if not isinstance(raw, dict):
        raise BadRequest("BAD_MODEL_OUTPUT", "模型返回的不是 JSON 对象", 502)

    data: Dict[str, Any] = {}
    for key, limit in FIELD_LIMIT.items():
        value = raw.get(key)
        if not isinstance(value, str):
            raise BadRequest("BAD_MODEL_OUTPUT", f"模型返回缺少字段 {key}", 502)
        value = _clip(_strip_label(value, key), limit)
        if not value:
            raise BadRequest("BAD_MODEL_OUTPUT", f"模型返回字段 {key} 为空", 502)
        data[key] = value

    allowed: Set[str] = {item for item in allowed_ids if isinstance(item, str)}
    evidence: List[str] = []
    for item in raw.get("evidenceIds") or []:
        if isinstance(item, str) and item in allowed and item not in evidence:
            evidence.append(item)
        if len(evidence) >= 8:
            break
    data["evidenceIds"] = evidence
    return data


def segment_ids(groups: Sequence[Sequence[Dict[str, Any]]]) -> List[str]:
    seen: List[str] = []
    for group in groups:
        for segment in group:
            seg_id = segment.get("id")
            if isinstance(seg_id, str) and seg_id not in seen:
                seen.append(seg_id)
    return seen
