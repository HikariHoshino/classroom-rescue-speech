# -*- coding: utf-8 -*-
"""AI 引擎自测：规则、校验、原文整理、HTTP 契约。

运行：python -m unittest discover -s server/ai/engine/tests -v
"""

import json
import os
import sys
import threading
import unittest
from http.client import HTTPConnection
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parents[1]
AI_DIR = ENGINE_DIR.parent
for _path in (str(ENGINE_DIR), str(AI_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import extract  # noqa: E402
import keywords  # noqa: E402
import sections  # noqa: E402
import server  # noqa: E402
import validate  # noqa: E402

SAMPLE_SEGMENTS = [
    {
        "id": "seg-03",
        "startMs": 60000,
        "endMs": 72000,
        "text": "栈是先进后出的线性表，只允许在一端插入和删除。",
    },
    {
        "id": "seg-04",
        "startMs": 90000,
        "endMs": 101000,
        "text": "这个知识点期末会考，大家注意顺序栈的判满条件。",
    },
]

SAMPLE_REQUEST = {
    "sessionId": "class-001",
    "capturedAtMs": 130000,
    "fromMs": 10000,
    "toMs": 130000,
    "segments": SAMPLE_SEGMENTS,
    "contextSegments": [
        {"id": "seg-02", "startMs": 40000, "endMs": 52000, "text": "上节课我们讲了线性表。"}
    ],
}


class KeywordRuleTest(unittest.TestCase):
    def test_positive_hit(self):
        self.assertEqual(keywords.find_hit("这个知识点期末会考")[0], "期末")

    def test_negation_blocks_hit(self):
        self.assertIsNone(keywords.find_hit("这个知识点不会考"))

    def test_negation_before_keyword(self):
        self.assertIsNone(keywords.find_hit("这部分不是重点"))

    def test_wordlist_order_wins(self):
        self.assertEqual(keywords.find_hit("这个要考，期末重点都在这")[0], "这个要考")

    def test_plain_sentence_has_no_hit(self):
        self.assertIsNone(keywords.find_hit("我们来看一下栈的基本结构"))

    def test_one_hit_per_segment(self):
        hits = keywords.detect_hits(SAMPLE_SEGMENTS)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]["segmentId"], "seg-04")


class ValidateTest(unittest.TestCase):
    def test_parse_rescue_ok(self):
        parsed = validate.parse_rescue(SAMPLE_REQUEST)
        self.assertEqual(len(parsed["segments"]), 2)
        self.assertEqual(parsed["segments"][0]["id"], "seg-03")

    def test_empty_segments_rejected(self):
        body = dict(SAMPLE_REQUEST, segments=[], contextSegments=[])
        with self.assertRaises(validate.BadRequest) as ctx:
            validate.parse_rescue(body)
        self.assertEqual(ctx.exception.code, "EMPTY_TEXT")

    def test_duplicate_id_overwrites_and_sorts(self):
        body = dict(
            SAMPLE_REQUEST,
            segments=[
                {"id": "seg-09", "startMs": 9000, "endMs": 9500, "text": "后到但更早"},
                {"id": "seg-01", "startMs": 1000, "endMs": 2000, "text": "第一段"},
                {"id": "seg-01", "startMs": 1000, "endMs": 2100, "text": "第一段修正"},
            ],
        )
        parsed = validate.parse_rescue(body)
        self.assertEqual([seg["id"] for seg in parsed["segments"]], ["seg-01", "seg-09"])
        self.assertEqual(parsed["segments"][0]["text"], "第一段修正")

    def test_reversed_window_rejected(self):
        body = dict(SAMPLE_REQUEST, fromMs=200000, toMs=100000)
        with self.assertRaises(validate.BadRequest):
            validate.parse_rescue(body)

    def test_result_keeps_only_known_evidence(self):
        raw = {
            "missed": "missed：老师讲了栈的判满",
            "topic": "顺序栈",
            "latest": "讲到栈满不能入栈",
            "evidenceIds": ["seg-03", "seg-999", "seg-04", "seg-03"],
        }
        data = validate.normalize_result(raw, ["seg-03", "seg-04"])
        self.assertEqual(data["evidenceIds"], ["seg-03", "seg-04"])
        self.assertFalse(data["missed"].startswith("missed"))

    def test_result_missing_field_is_error(self):
        with self.assertRaises(validate.BadRequest) as ctx:
            validate.normalize_result({"missed": "只有一段"}, ["seg-01"])
        self.assertEqual(ctx.exception.status, 502)


class ExtractTest(unittest.TestCase):
    def test_rescue_extract_is_traceable(self):
        data = extract.rescue_extract(validate.parse_rescue(SAMPLE_REQUEST))
        self.assertIn("先进后出", data["missed"])
        self.assertTrue(data["evidenceIds"])
        self.assertTrue(data["latest"])

    def test_rescue_extract_without_window_text(self):
        body = dict(SAMPLE_REQUEST, segments=[])
        data = extract.rescue_extract(validate.parse_rescue(body))
        self.assertIn("暂无转写", data["missed"])

    def test_notes_markdown_sections(self):
        markdown = extract.notes_markdown("class-001", validate.parse_rescue(SAMPLE_REQUEST)["segments"])
        for heading in ("# 课堂笔记", "## 课堂主题", "## 知识要点", "## 疑似考点（原文）", "## 待确认内容"):
            self.assertIn(heading, markdown)
        self.assertIn("原文整理", markdown)
        self.assertNotIn("## 作业与任务", markdown)

    def test_notes_markdown_adds_task_section(self):
        segments = validate.parse_rescue(
            dict(
                SAMPLE_REQUEST,
                segments=[
                    {"id": "seg-01", "startMs": 0, "endMs": 1000, "text": "今天的作业是手写一个顺序栈。"}
                ],
            )
        )["segments"]
        markdown = extract.notes_markdown("class-001", segments)
        self.assertIn("## 作业与任务", markdown)


class SectionsTest(unittest.TestCase):
    def _segments(self):
        segments = validate.parse_rescue(SAMPLE_REQUEST)["segments"]
        segments.append(
            {
                "id": "seg-05",
                "startMs": 130000,
                "endMs": 140000,
                "text": "接下来看二叉树的中序遍历，以及完全二叉树的存储方式。",
            }
        )
        return segments

    def test_sections_group_by_knowledge_point(self):
        items = sections.build_sections("class-001", self._segments())
        self.assertTrue(items)
        titles = [item["title"] for item in items]
        self.assertIn("栈", titles)
        self.assertIn("树与二叉树", titles)
        for item in items:
            self.assertTrue(item["id"].startswith("sec-"))

    def test_section_carries_stars_and_basis(self):
        items = sections.build_sections("class-001", self._segments())
        stack = next(item for item in items if item["title"] == "栈")
        self.assertIn(stack["examStars"], (1, 2, 3))
        self.assertIn("408", stack["examBasis"])
        self.assertTrue(stack["segmentIds"])

    def test_unmatched_text_gets_other_section(self):
        items = sections.build_sections(
            "class-001", [{"id": "s1", "startMs": 0, "endMs": 1000, "text": "今天先点个名，然后我们继续上课。"}]
        )
        self.assertEqual(items[0]["title"], "其他内容")
        self.assertEqual(items[0]["examStars"], 0)


class HttpContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        os.environ["LLM_MOCK"] = "1"
        cls.httpd = server.make_server("127.0.0.1", 0)
        cls.port = cls.httpd.server_address[1]
        cls.thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()
        cls.thread.join(timeout=5)
        os.environ.pop("LLM_MOCK", None)

    def _post(self, path, payload):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        conn.request("POST", path, body=body, headers={"Content-Type": "application/json"})
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        conn.close()
        return response.status, data

    def _get(self, path):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=10)
        conn.request("GET", path)
        response = conn.getresponse()
        data = json.loads(response.read().decode("utf-8"))
        conn.close()
        return response.status, data

    def test_health(self):
        status, data = self._get("/health")
        self.assertEqual(status, 200)
        self.assertTrue(data["ok"])

    def test_rescue_shape(self):
        status, data = self._post("/rescue", SAMPLE_REQUEST)
        self.assertEqual(status, 200)
        self.assertEqual(data["sessionId"], "class-001")
        self.assertIn(data["resultMode"], ("ai", "extract"))
        for key in ("missed", "topic", "latest", "evidenceIds"):
            self.assertIn(key, data["data"])

    def test_rescue_empty_text_returns_400(self):
        status, data = self._post("/rescue", dict(SAMPLE_REQUEST, segments=[], contextSegments=[]))
        self.assertEqual(status, 400)
        self.assertEqual(data["error"]["code"], "EMPTY_TEXT")

    def test_notes_shape(self):
        status, data = self._post(
            "/notes", {"sessionId": "class-001", "segments": SAMPLE_SEGMENTS}
        )
        self.assertEqual(status, 200)
        self.assertIn("# 课堂笔记", data["markdown"])

    def test_unknown_route_404(self):
        status, data = self._post("/nope", {})
        self.assertEqual(status, 404)

    def test_sections_shape(self):
        status, data = self._post(
            "/sections", {"sessionId": "class-001", "segments": SAMPLE_SEGMENTS}
        )
        self.assertEqual(status, 200)
        self.assertEqual(data["sessionId"], "class-001")
        self.assertTrue(data["sections"])
        first = data["sections"][0]
        for key in ("id", "title", "points", "startMs", "segmentIds", "examStars", "examBasis"):
            self.assertIn(key, first)

    def test_weights_summary(self):
        status, data = self._get("/weights")
        self.assertEqual(status, 200)
        self.assertTrue(data["points"])
        self.assertIn("paperCount", data["meta"])


if __name__ == "__main__":
    unittest.main(verbosity=2)
