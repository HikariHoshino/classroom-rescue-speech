# -*- coding: utf-8 -*-
"""疑似考点词表与命中判定。

与前端 src/radar/detectExamHits.ts 保持同一规则（两份实现、一份规则）：
    1. 词表顺序即优先级，每个片段只取第一个命中项，避免一张卡片被多个词刷屏；
    2. 命中词前后 NEGATION_WINDOW 个字符内出现否定表述时，该次命中不算数；
    3. 只做「词语提醒」，命中不等于确定考点，界面统一写「疑似考点」。

本文件只服务于原文整理（notes 的 extract 分支）需要复用的命中结果；
页面上的实时标星由前端 TS 纯函数完成，不走网络。
"""

from typing import Dict, List, Optional, Sequence, Tuple

EXAM_KEYWORDS: Tuple[str, ...] = ("这个要考", "期末", "考试", "注意", "重点", "必考")

# 明显否定：出现时该次命中不标星（对应文档「不会考、不考、不是重点、无需注意」）
NEGATIONS: Tuple[str, ...] = ("不会考", "不考", "不是重点", "无需注意")

# 命中点前后各看多少字符。"不会考" 三个字需要完整落进窗口，故不小于 3。
NEGATION_WINDOW: int = 6


def _negated(text: str, index: int, keyword: str) -> bool:
    """判断 index 处的命中是否被附近的否定表述否定。"""
    left = max(0, index - NEGATION_WINDOW)
    right = min(len(text), index + len(keyword) + NEGATION_WINDOW)
    around = text[left:right]
    return any(neg in around for neg in NEGATIONS)


def find_hit(text: str) -> Optional[Tuple[str, int]]:
    """按词表顺序返回第一个未被否定的命中 (keyword, index)；没有则返回 None。"""
    if not text:
        return None
    for keyword in EXAM_KEYWORDS:
        index = text.find(keyword)
        while index != -1:
            if not _negated(text, index, keyword):
                return keyword, index
            index = text.find(keyword, index + 1)
    return None


def detect_hits(segments: Sequence[Dict[str, object]]) -> List[Dict[str, object]]:
    """逐段检测，每段最多一条。返回 [{'segmentId', 'keyword', 'startMs'}]。"""
    hits: List[Dict[str, object]] = []
    for segment in segments:
        text = segment.get("text")
        if not isinstance(text, str):
            continue
        found = find_hit(text)
        if found is None:
            continue
        keyword, _ = found
        hits.append(
            {
                "segmentId": segment.get("id"),
                "keyword": keyword,
                "startMs": segment.get("startMs"),
            }
        )
    return hits
