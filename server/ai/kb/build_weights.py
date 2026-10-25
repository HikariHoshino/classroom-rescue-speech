# -*- coding: utf-8 -*-
"""从 408 统考真题文本构建考点权重库。

数据来源：公开的 408 历年真题（papers-rebuild，2009-2026），已用 pdftotext 转成文本。
本脚本只做统计，不做任何推测：每个知识点的数字都能回溯到具体年份的具体题号。

用法：
    python server/ai/kb/build_weights.py --input <真题txt目录> --output server/ai/kb/exam-weights.json

产出字段说明（给前端/笔记用）：
    questions  命中该知识点的题目总数
    yearCount  覆盖的年份数（星级依据）
    years      覆盖年份列表
    stars      1/2/3，按覆盖年份分档，见 star_of()
    samples    最多 3 条可核查样例（年份 + 题号 + 原文片段）
"""

import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "exam-weights.json"
TZ = timezone(timedelta(hours=8))

# 知识点：id、展示名、用于命中的别名（越长的别名权重越高，单字别名只保留歧义小的）
POINTS: List[Dict[str, object]] = [
    {
        "id": "linear_list",
        "name": "线性表",
        "aliases": ["线性表", "顺序表", "单链表", "双链表", "循环链表", "链表", "头结点", "头指针", "顺序存储"],
    },
    {
        "id": "stack",
        "name": "栈",
        "aliases": ["栈", "栈顶", "栈底", "入栈", "出栈", "栈满", "判满", "栈空", "共享栈", "后进先出", "LIFO"],
    },
    {
        "id": "queue",
        "name": "队列",
        "aliases": ["队列", "队头", "队尾", "循环队列", "入队", "出队", "先进先出", "FIFO"],
    },
    {
        "id": "string",
        "name": "串与模式匹配",
        "aliases": ["子串", "模式串", "模式匹配", "KMP", "next 数组", "字符串", "串"],
    },
    {
        "id": "tree",
        "name": "树与二叉树",
        "aliases": [
            "二叉树", "二叉搜索树", "二叉排序树", "平衡二叉树", "哈夫曼", "线索二叉树",
            "完全二叉树", "森林", "遍历序列", "中序遍历", "先序遍历", "后序遍历", "层序遍历",
            "叶子结点", "树的高度", "孩子兄弟",
        ],
    },
    {
        "id": "graph",
        "name": "图",
        "aliases": [
            "顶点", "邻接矩阵", "邻接表", "最短路径", "最小生成树", "拓扑排序", "关键路径",
            "深度优先", "广度优先", "Dijkstra", "Prim", "Kruskal", "无向图", "有向图", "连通分量",
        ],
    },
    {
        "id": "search",
        "name": "查找",
        "aliases": ["折半查找", "二分查找", "B 树", "B树", "B+树", "散列表", "哈希", "装填因子", "查找"],
    },
    {
        "id": "sort",
        "name": "排序",
        "aliases": [
            "排序", "快速排序", "堆排序", "归并排序", "基数排序", "插入排序", "选择排序", "冒泡",
            "稳定性", "外部排序", "败者树", "大根堆", "小根堆", "堆",
        ],
    },
]

# 星级分档：按"覆盖了多少个年份"而不是"出现多少次"，避免同一道大题刷高权重
STAR_3_YEARS = 12
STAR_2_YEARS = 6


def star_of(year_count: int) -> int:
    if year_count >= STAR_3_YEARS:
        return 3
    if year_count >= STAR_2_YEARS:
        return 2
    return 1 if year_count > 0 else 0


QUESTION_RE = re.compile(r"^\s*(\d{1,2})\s*[.．、]\s*")
PAGE_NOISE_RE = re.compile(r"第\s*\d+\s*页|共\s*\d+\s*页|年全国硕士研究生")


def read_paper(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def split_questions(text: str) -> List[Tuple[int, str]]:
    """按题号切分；页码页眉等噪声行丢弃。"""
    questions: List[Tuple[int, str]] = []
    current_no: Optional[int] = None
    current: List[str] = []

    def flush() -> None:
        if current_no is not None and current:
            body = "".join(current).strip()
            if body:
                questions.append((current_no, body))

    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if PAGE_NOISE_RE.search(line):
            continue
        matched = QUESTION_RE.match(line)
        # 题号必须单调递增并且不超过 47，否则多半是选项里的 "1." 之类噪声
        if matched:
            number = int(matched.group(1))
            if 1 <= number <= 47 and (current_no is None or number == current_no + 1 or number <= 3):
                flush()
                current_no = number
                current = [line[matched.end():]]
                continue
        if current_no is not None:
            current.append(line)
    flush()
    return questions


def score_question(text: str) -> List[Tuple[str, float]]:
    """按别名加权重打分：别名越长越具体，权重越高。"""
    scores: List[Tuple[str, float]] = []
    for point in POINTS:
        score = 0.0
        for alias in point["aliases"]:  # type: ignore[union-attr]
            count = text.count(alias)
            if count:
                score += count * (len(alias) ** 1.5)
        if score >= 2.0:
            scores.append((str(point["id"]), score))
    scores.sort(key=lambda item: item[1], reverse=True)
    return scores


def build(input_dir: Path) -> Dict[str, object]:
    papers = sorted(p for p in input_dir.glob("*.txt"))
    if not papers:
        raise SystemExit("没有在 %s 找到 txt 试卷" % input_dir)

    stats: Dict[str, Dict[str, object]] = {
        str(point["id"]): {"questions": 0, "years": set(), "samples": []} for point in POINTS
    }

    for paper in papers:
        try:
            year = int(paper.stem)
        except ValueError:
            continue
        for number, body in split_questions(read_paper(paper)):
            scored = score_question(body)
            if not scored:
                continue
            point_id, _ = scored[0]
            entry = stats[point_id]
            entry["questions"] = int(entry["questions"]) + 1  # type: ignore[arg-type]
            entry["years"].add(year)  # type: ignore[union-attr]
            samples = entry["samples"]
            if len(samples) < 3:  # type: ignore[arg-type]
                snippet = re.sub(r"\s+", " ", body)[:110]
                samples.append({"year": year, "no": number, "text": snippet})  # type: ignore[union-attr]

    points = []
    for point in POINTS:
        point_id = str(point["id"])
        entry = stats[point_id]
        years = sorted(entry["years"])  # type: ignore[arg-type]
        year_count = len(years)
        points.append(
            {
                "id": point_id,
                "name": point["name"],
                "aliases": point["aliases"],
                "questions": entry["questions"],
                "yearCount": year_count,
                "years": years,
                "stars": star_of(year_count),
                "samples": entry["samples"],
            }
        )
    points.sort(key=lambda item: (-item["yearCount"], -item["questions"]))

    return {
        "meta": {
            "course": "数据结构（408 统考范围）",
            "source": "全国硕士研究生招生考试 408 计算机学科专业基础综合 历年真题",
            "paperCount": len(papers),
            "yearRange": [min(int(p.stem) for p in papers if p.stem.isdigit()), max(int(p.stem) for p in papers if p.stem.isdigit())],
            "builtAt": datetime.now(TZ).isoformat(timespec="seconds"),
            "method": "按题号切分后，用知识点别名做加权命中统计；星级只依据覆盖年份数，不做预测",
            "disclaimer": "统计结果只表示该知识点在历年真题中的出现频率，不代表本年一定考或不考。",
        },
        "points": points,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="构建 408 考点权重库")
    parser.add_argument("--input", required=True, help="放真题 txt 的目录（文件名用年份，如 2024.txt）")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    args = parser.parse_args()

    data = build(Path(args.input))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    meta = data["meta"]
    print("已生成 %s" % output)
    print("试卷 %s 份，年份 %s-%s" % (meta["paperCount"], meta["yearRange"][0], meta["yearRange"][1]))
    for point in data["points"]:
        print(
            "  %-10s %s  年份 %2d  题目 %2d  %s"
            % (point["name"], "★" * point["stars"] + "☆" * (3 - point["stars"]), point["yearCount"], point["questions"],
               ",".join(str(y) for y in point["years"][-3:]))
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
