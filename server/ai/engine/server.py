#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""3号 · 走神急救 AI 引擎（仅标准库，Python 3.8+）。

只监听回环地址，由 1号 的 Express 适配层调用，浏览器不直接访问：

    GET  /health   存活探针（不代表模型可用）
    POST /rescue   RescueRequest  -> RescueResponse
    POST /notes    {sessionId,segments} -> NotesResponse

启动：
    python server/ai/engine/server.py --port 8000
    python server/ai/engine/server.py --mock      # 不调模型，走本地演练数据

环境变量来自仓库根目录的 .env（不覆盖已有的系统环境变量）：
    LLM_BASE_URL / LLM_API_KEY / LLM_MODEL / LLM_TIMEOUT_SEC / AI_ENGINE_PORT
"""

import argparse
import json
import os
import socket
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

ENGINE_DIR = Path(__file__).resolve().parent
AI_DIR = ENGINE_DIR.parent
REPO_ROOT = ENGINE_DIR.parents[2]
for _path in (str(ENGINE_DIR), str(AI_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import extract  # noqa: E402
import llm  # noqa: E402
import prompts  # noqa: E402
import sections  # noqa: E402
import validate  # noqa: E402

MAX_BODY_BYTES = 2 * 1024 * 1024


def load_env() -> Optional[Path]:
    """从引擎目录向上找 .env，只补齐缺失项，不覆盖已存在的环境变量。"""
    for directory in (ENGINE_DIR, ENGINE_DIR.parent, ENGINE_DIR.parents[1], REPO_ROOT):
        candidate = Path(directory) / ".env"
        if not candidate.is_file():
            continue
        try:
            lines = candidate.read_text(encoding="utf-8").splitlines()
        except OSError:
            continue
        for line in lines:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value
        return candidate
    return None


def _is_mock() -> bool:
    return os.environ.get("LLM_MOCK", "").strip() == "1"


class EngineHandler(BaseHTTPRequestHandler):
    server_version = "RescueAIEngine/1.0"
    protocol_version = "HTTP/1.1"
    timeout = 30

    # ---------- 基础工具 ----------

    def log_message(self, fmt: str, *args: Any) -> None:  # 关掉 http.server 默认访问日志
        return

    def _send(self, status: int, payload: Dict[str, Any], extra: Optional[Dict[str, str]] = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _error(self, status: int, code: str, message: str) -> None:
        self._send(status, {"error": {"code": code, "message": message}})

    def _read_json(self) -> Any:
        raw_length = self.headers.get("Content-Length") or "0"
        try:
            length = int(raw_length)
        except ValueError:
            raise validate.BadRequest("INVALID_REQUEST", "Content-Length 不合法")
        if length <= 0:
            raise validate.BadRequest("INVALID_REQUEST", "请求体为空")
        if length > MAX_BODY_BYTES:
            raise validate.BadRequest("INVALID_REQUEST", "请求体过大")
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, ValueError):
            raise validate.BadRequest("INVALID_REQUEST", "请求体不是合法的 UTF-8 JSON")

    def _log(self, route: str, started: float, status: int, mode: str, detail: str = "") -> None:
        elapsed = int((time.monotonic() - started) * 1000)
        print(
            "[ai] %s status=%s mode=%s %dms%s"
            % (route, status, mode or "-", elapsed, (" " + detail) if detail else ""),
            flush=True,
        )

    # ---------- 路由 ----------

    def do_OPTIONS(self) -> None:  # 便于 4号 直接本地调试
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        path = self.path.split("?")[0]
        if path == "/health":
            self._send(200, {"ok": True, "engine": "rescue-ai", "mock": _is_mock()})
            return
        if path == "/weights":
            # 考点权重库摘要：前端「知识库」面板直接展示，含来源与免责说明
            self._send(200, sections.weights_summary())
            return
        self._error(404, "NOT_FOUND", "未知路径")

    def do_POST(self) -> None:
        path = self.path.split("?")[0]
        if path == "/rescue":
            self._handle_rescue()
        elif path == "/notes":
            self._handle_notes()
        elif path == "/sections":
            self._handle_sections()
        else:
            self._error(404, "NOT_FOUND", "未知路径")

    # ---------- 业务 ----------

    def _handle_rescue(self) -> None:
        started = time.monotonic()
        try:
            request = validate.parse_rescue(self._read_json())
        except validate.BadRequest as exc:
            self._log("/rescue", started, exc.status, "", exc.code)
            self._error(exc.status, exc.code, exc.message)
            return

        allowed = validate.segment_ids([request["segments"], request["contextSegments"]])
        mode = "extract"
        result: Optional[Dict[str, Any]] = None
        note = ""

        if _is_mock():
            result = extract.rescue_extract(request)
            mode = "ai"
            note = "mock"
        else:
            try:
                raw = llm.chat_json(prompts.RESCUE_SYSTEM, prompts.build_rescue_prompt(request))
                result = validate.normalize_result(raw, allowed)
                mode = "ai"
            except (llm.LLMTimeout, llm.LLMUnavailable, llm.LLMFormatError, validate.BadRequest) as exc:
                note = "fallback:%s" % exc.__class__.__name__

        if result is None:
            try:
                result = extract.rescue_extract(request)
            except Exception as exc:  # 原文整理也失败才 502
                self._log("/rescue", started, 502, "", "extract_failed")
                self._error(502, "AI_UNAVAILABLE", "回溯生成失败：%s" % exc.__class__.__name__)
                return

        payload = {"sessionId": request["sessionId"], "resultMode": mode, "data": result}
        self._log("/rescue", started, 200, mode, "segs=%d %s" % (len(request["segments"]), note))
        self._send(200, payload, {"X-AI-Engine": "python", "X-AI-Mock": "1"} if _is_mock() else {"X-AI-Engine": "python"})

    def _handle_notes(self) -> None:
        started = time.monotonic()
        try:
            request = validate.parse_notes(self._read_json())
        except validate.BadRequest as exc:
            self._log("/notes", started, exc.status, "", exc.code)
            self._error(exc.status, exc.code, exc.message)
            return

        mode = "extract"
        markdown = ""
        note = ""

        if _is_mock():
            # 演练模式：内容仍来自原文整理，但标成 ai 以便 4号 预览「AI 生成」的展示分支
            markdown = extract.notes_markdown(request["sessionId"], request["segments"])
            mode = "ai"
            note = "mock"
        else:
            try:
                markdown = llm.chat_text(
                    prompts.NOTES_SYSTEM,
                    prompts.build_notes_prompt(request["sessionId"], request["segments"]),
                    timeout=float(os.environ.get("LLM_TIMEOUT_NOTES_SEC", "18")),
                )
                # 考点小节由本地关键词函数生成，不交给模型，避免编造或漏标
                markdown = extract.finalize_notes(markdown, request["segments"])
                mode = "ai"
            except (llm.LLMTimeout, llm.LLMUnavailable, llm.LLMFormatError) as exc:
                note = "fallback:%s" % exc.__class__.__name__

        if not markdown:
            try:
                markdown = extract.notes_markdown(request["sessionId"], request["segments"])
            except Exception as exc:
                self._log("/notes", started, 502, "", "extract_failed")
                self._error(502, "AI_UNAVAILABLE", "笔记生成失败：%s" % exc.__class__.__name__)
                return

        payload = {"sessionId": request["sessionId"], "resultMode": mode, "markdown": markdown}
        self._log("/notes", started, 200, mode, "segs=%d %s" % (len(request["segments"]), note))
        headers = {"X-AI-Engine": "python"}
        if _is_mock():
            headers["X-AI-Mock"] = "1"
        self._send(200, payload, headers)

    def _handle_sections(self) -> None:
        """按知识点分节，供前端勾选进笔记本。规则版，resultMode 固定 extract。"""
        started = time.monotonic()
        try:
            request = validate.parse_notes(self._read_json())
        except validate.BadRequest as exc:
            self._log("/sections", started, exc.status, "", exc.code)
            self._error(exc.status, exc.code, exc.message)
            return

        try:
            items = sections.build_sections(request["sessionId"], request["segments"])
        except Exception as exc:
            self._log("/sections", started, 502, "", "section_failed")
            self._error(502, "AI_UNAVAILABLE", "笔记分节失败：%s" % exc.__class__.__name__)
            return

        payload = {"sessionId": request["sessionId"], "resultMode": "extract", "sections": items}
        self._log("/sections", started, 200, "extract", "sections=%d" % len(items))
        headers = {"X-AI-Engine": "python"}
        if _is_mock():
            headers["X-AI-Mock"] = "1"
        self._send(200, payload, headers)


def make_server(host: str = "127.0.0.1", port: int = 8000) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), EngineHandler)
    server.daemon_threads = True
    return server


def _use_utf8_when_redirected() -> None:
    """日志被重定向到文件时统一用 UTF-8，避免中文变成乱码；控制台保持原编码。"""
    for stream in (sys.stdout, sys.stderr):
        try:
            if not stream.isatty():
                stream.reconfigure(encoding="utf-8")
        except (AttributeError, ValueError):
            pass


def main(argv: Optional[list] = None) -> int:
    _use_utf8_when_redirected()
    env_file = load_env()
    parser = argparse.ArgumentParser(description="走神急救 · AI 引擎（3号）")
    parser.add_argument("--host", default=os.environ.get("AI_ENGINE_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("AI_ENGINE_PORT", "8000")))
    parser.add_argument("--mock", action="store_true", help="不调用模型，用本地数据演练（标 X-AI-Mock: 1）")
    args = parser.parse_args(argv)

    if args.mock:
        os.environ["LLM_MOCK"] = "1"

    try:
        server = make_server(args.host, args.port)
    except OSError as exc:
        print("[ai] 无法监听 %s:%s -> %s" % (args.host, args.port, exc), file=sys.stderr)
        return 1

    url = "http://%s:%d" % (args.host, server.server_address[1])
    print("[ai] 引擎已启动 %s  mock=%s  env=%s" % (url, "1" if _is_mock() else "0", env_file or "未找到 .env"))
    if not _is_mock() and not os.environ.get("LLM_API_KEY"):
        print("[ai] 警告：没有 LLM_API_KEY，回溯与笔记都会走原文整理", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[ai] 已停止")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
