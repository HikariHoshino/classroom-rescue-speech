# -*- coding: utf-8 -*-
"""模型调用：OpenAI 兼容的 /chat/completions，只用标准库。

设计取舍：
    * 不引入 openai / httpx / requests，保证演示电脑 `python xxx.py` 就能跑；
    * 连接与读取共用 15 秒硬上限（文档第五节「3号给模型调用设置15秒上限」）；
    * 任何异常都收敛成三类，交给上层决定是原文整理还是报错。

环境变量：
    LLM_BASE_URL   例如 https://api.openai.com/v1 或 https://xxx/v1/chat/completions
    LLM_API_KEY    只从环境变量读取，绝不落日志、不进响应体
    LLM_MODEL      模型名
    LLM_TIMEOUT_SEC 可选，默认 15
"""

import json
import os
import re
import socket
import urllib.error
import urllib.request
from typing import Any, Dict

DEFAULT_TIMEOUT = 15.0


class LLMTimeout(RuntimeError):
    """调用超时（应触发原文整理，而不是把错误抛给前端）。"""


class LLMUnavailable(RuntimeError):
    """网络失败、鉴权失败、服务端 5xx 等。"""


class LLMFormatError(RuntimeError):
    """返回内容不是可解析的 JSON 对象。"""


def _endpoint(base: str) -> str:
    """把用户填的 base 补成完整的 chat/completions 地址。

    兼容三种写法：
        https://open.bigmodel.cn/api/paas/v4      -> +/chat/completions
        https://api.deepseek.com/v1               -> +/chat/completions
        https://xxx/v1/chat/completions           -> 原样使用
        https://api.deepseek.com                  -> +/v1/chat/completions
    """
    url = (base or "").strip().rstrip("/")
    if not url:
        raise LLMUnavailable("缺少 LLM_BASE_URL")
    if url.endswith("/chat/completions"):
        return url
    # 已经带了版本段（/v1、/v4、/api/paas/v4 等），只需补最后一段
    if re.search(r"/(?:api/[a-z]+/)?v\d+$", url, flags=re.IGNORECASE):
        return url + "/chat/completions"
    return url + "/v1/chat/completions"


def _timeout() -> float:
    raw = os.environ.get("LLM_TIMEOUT_SEC", "").strip()
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_TIMEOUT
    return value if 1.0 <= value <= 60.0 else DEFAULT_TIMEOUT


def _extract_json_object(text: str) -> Dict[str, Any]:
    """模型可能包 ```json 围栏或加寒暄，这里只取第一个 { 到最后一个 } 之间。"""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.lower().startswith("json"):
            cleaned = cleaned[4:]
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start == -1 or end <= start:
        raise LLMFormatError("模型返回中没有 JSON 对象")
    try:
        parsed = json.loads(cleaned[start : end + 1])
    except ValueError as exc:
        raise LLMFormatError("模型返回的 JSON 无法解析：%s" % exc)
    if not isinstance(parsed, dict):
        raise LLMFormatError("模型返回的 JSON 不是对象")
    return parsed


def chat_json(system_prompt: str, user_prompt: str, timeout: float = None) -> Dict[str, Any]:
    """调用模型并返回解析后的 JSON 对象；失败按三类异常抛出。"""
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    model = os.environ.get("LLM_MODEL", "").strip()
    if not api_key or not model:
        raise LLMUnavailable("缺少 LLM_API_KEY 或 LLM_MODEL")

    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": int(os.environ.get("LLM_MAX_TOKENS", "400")),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    if os.environ.get("LLM_JSON_MODE", "").strip() == "1":
        # 部分兼容服务不支持该参数，默认关闭，仅用提示词约束
        payload["response_format"] = {"type": "json_object"}

    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        _endpoint(os.environ.get("LLM_BASE_URL", "")),
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer %s" % api_key,
            "Accept": "application/json",
        },
    )

    limit = _timeout() if timeout is None else min(float(timeout), 60.0)
    try:
        with urllib.request.urlopen(request, timeout=limit) as response:
            raw = response.read().decode("utf-8", "replace")
    except socket.timeout:
        raise LLMTimeout("模型调用超过 %d 秒" % int(limit))
    except urllib.error.HTTPError as exc:
        # 不回显响应体，避免把密钥或内部信息带进日志
        raise LLMUnavailable("模型服务返回 HTTP %s" % exc.code)
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, socket.timeout):
            raise LLMTimeout("模型调用超过 %d 秒" % int(limit))
        raise LLMUnavailable("无法连接模型服务：%s" % exc.reason)
    except OSError as exc:  # 连接被重置等
        raise LLMUnavailable("模型调用失败：%s" % exc)

    try:
        envelope = json.loads(raw)
        content = envelope["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise LLMFormatError("模型响应结构不符合 chat/completions 约定")

    if not isinstance(content, str):
        raise LLMFormatError("模型返回 content 不是字符串")
    return _extract_json_object(content)


def chat_text(system_prompt: str, user_prompt: str, timeout: float = None) -> str:
    """笔记用：返回 Markdown 文本，不做 JSON 解析。"""
    api_key = os.environ.get("LLM_API_KEY", "").strip()
    model = os.environ.get("LLM_MODEL", "").strip()
    if not api_key or not model:
        raise LLMUnavailable("缺少 LLM_API_KEY 或 LLM_MODEL")

    payload = {
        "model": model,
        "temperature": 0.3,
        "max_tokens": int(os.environ.get("LLM_MAX_TOKENS_NOTES", "1200")),
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    }
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        _endpoint(os.environ.get("LLM_BASE_URL", "")),
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer %s" % api_key,
            "Accept": "application/json",
        },
    )

    limit = _timeout() if timeout is None else min(float(timeout), 60.0)
    try:
        with urllib.request.urlopen(request, timeout=limit) as response:
            raw = response.read().decode("utf-8", "replace")
    except socket.timeout:
        raise LLMTimeout("模型调用超过 %d 秒" % int(limit))
    except urllib.error.HTTPError as exc:
        raise LLMUnavailable("模型服务返回 HTTP %s" % exc.code)
    except urllib.error.URLError as exc:
        if isinstance(exc.reason, socket.timeout):
            raise LLMTimeout("模型调用超过 %d 秒" % int(limit))
        raise LLMUnavailable("无法连接模型服务：%s" % exc.reason)
    except OSError as exc:
        raise LLMUnavailable("模型调用失败：%s" % exc)

    try:
        content = json.loads(raw)["choices"][0]["message"]["content"]
    except (ValueError, KeyError, IndexError, TypeError):
        raise LLMFormatError("模型响应结构不符合 chat/completions 约定")

    if not isinstance(content, str) or not content.strip():
        raise LLMFormatError("模型返回的 Markdown 为空")
    return content.strip()
