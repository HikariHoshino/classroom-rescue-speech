# -*- coding: utf-8 -*-
"""运行时匹配：把一段课堂文字对到 408 真题里的知识点，给出星级与依据。

原则：
    * 只做「这个知识点在历年真题里出现得多不多」的统计，不预测今年考不考；
    * 匹配不到就返回 stars=0，不硬凑；
    * 依据字符串能直接展示给用户（含年份区间、覆盖年份数、命中题数）。
"""

import json
from pathlib import Path
from typing import Any, Dict, Optional

WEIGHTS_PATH = Path(__file__).resolve().parent / "exam-weights.json"
_cache: Optional[Dict[str, Any]] = None

MIN_SCORE = 1.0


def load() -> Dict[str, Any]:
    global _cache
    if _cache is None:
        try:
            _cache = json.loads(WEIGHTS_PATH.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _cache = {"meta": {}, "points": []}
    return _cache


def score_text(text: str) -> Optional[Dict[str, Any]]:
    """返回得分最高的知识点，得分按「别名长度^1.5 × 出现次数」累加。"""
    best: Optional[Dict[str, Any]] = None
    best_score = 0.0
    for point in load().get("points", []):
        score = 0.0
        for alias in point.get("aliases", []):
            count = text.count(alias)
            if count:
                score += count * (len(alias) ** 1.5)
        if score > best_score:
            best, best_score = point, score
    return best if best_score >= MIN_SCORE else None


def annotate(text: str) -> Dict[str, Any]:
    """给一段文字打上知识点与星级标签。"""
    if not text:
        return {"pointId": None, "pointName": None, "stars": 0, "basis": "无文字可匹配"}
    point = score_text(text)
    if point is None:
        return {
            "pointId": None,
            "pointName": None,
            "stars": 0,
            "basis": "未收录于 408 真题统计",
        }

    years = point.get("years") or []
    if not years:
        return {"pointId": point["id"], "pointName": point["name"], "stars": 0, "basis": "真题样本不足"}

    basis = "%d-%d 年 408 真题中 %d 年出现（%d 题）" % (
        min(years),
        max(years),
        point.get("yearCount", 0),
        point.get("questions", 0),
    )
    return {
        "pointId": point["id"],
        "pointName": point["name"],
        "stars": int(point.get("stars", 0)),
        "basis": basis,
    }


def meta() -> Dict[str, Any]:
    return dict(load().get("meta", {}))


def summary() -> Dict[str, Any]:
    """给 /api/exam/weights 用的精简视图。"""
    data = load()
    return {
        "meta": data.get("meta", {}),
        "points": [
            {
                "id": point["id"],
                "name": point["name"],
                "stars": point["stars"],
                "yearCount": point["yearCount"],
                "questions": point["questions"],
                "years": point["years"],
            }
            for point in data.get("points", [])
        ],
    }
