# -*- coding: utf-8 -*-
"""把一节课的转写切成「可按知识点勾选」的笔记小节。

当前实现是规则版：按转写的先后顺序分组，每组对到 408 真题知识库里最接近的知识点，
因此 resultMode 老实标 "extract"——它的内容是原文归类，不是模型总结。
接入模型后可以换成模型分节 + 同样的星级标注，resultMode 再标 "ai"。
"""

import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

AI_DIR = Path(__file__).resolve().parents[1]
if str(AI_DIR) not in sys.path:
    sys.path.insert(0, str(AI_DIR))

from kb import match as kb_match  # noqa: E402

MAX_SECTIONS = 10
POINT_LIMIT = 100
OTHER_TITLE = "其他内容"


def _clip(text: str, limit: int = POINT_LIMIT) -> str:
    normalized = " ".join(str(text).split())
    if len(normalized) <= limit:
        return normalized
    return normalized[: max(1, limit - 1)] + "…"


def _merge_tail(groups: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """超过上限时把尾部合并，避免前端列表无限长。"""
    if len(groups) <= MAX_SECTIONS:
        return groups
    merged: Dict[str, Any] = {
        "key": "mixed",
        "info": {"pointId": None, "pointName": None, "stars": 0, "basis": "多个知识点合并"},
        "segments": [],
    }
    for group in groups[MAX_SECTIONS - 1 :]:
        merged["segments"].extend(group["segments"])
    return groups[: MAX_SECTIONS - 1] + [merged]


def build_sections(session_id: str, segments: Sequence[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """返回 NoteSection[]：id / title / points / startMs / segmentIds / examStars / examBasis。

    同一个知识点的片段会合并成一小节（不按出现位置切断），这样用户在笔记本里
    勾选的是「栈」「树与二叉树」这样的知识点，而不是一堆零碎段落。
    """
    groups: Dict[str, Dict[str, Any]] = {}
    for segment in segments:
        info = kb_match.annotate(str(segment.get("text") or ""))
        key = info["pointId"] or "other"
        if key not in groups:
            groups[key] = {"key": key, "info": info, "segments": []}
        groups[key]["segments"].append(segment)

    ordered = _merge_tail(list(groups.values()))
    sections: List[Dict[str, Any]] = []
    for index, group in enumerate(ordered):
        items: List[Dict[str, Any]] = group["segments"]
        info: Dict[str, Any] = group["info"]
        sections.append(
            {
                "id": "sec-%02d" % (index + 1),
                "title": info["pointName"] or OTHER_TITLE,
                "points": [_clip(str(item.get("text") or "")) for item in items],
                "startMs": int(items[0].get("startMs") or 0),
                "segmentIds": [str(item.get("id")) for item in items],
                "examStars": int(info["stars"]),
                "examBasis": str(info["basis"]),
            }
        )
    # 有星级的知识点排前面，未收录的「其他内容」沉底
    sections.sort(key=lambda item: (-item["examStars"], item["startMs"]))
    return sections


def stars_of(text: str) -> Dict[str, Any]:
    """供 /rescue 之外的场景复用（例如给某个知识点单独查星级）。"""
    return kb_match.annotate(text)


def weights_summary() -> Dict[str, Any]:
    return kb_match.summary()
