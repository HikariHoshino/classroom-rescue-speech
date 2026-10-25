# -*- coding: utf-8 -*-
"""3号 · 走神急救 AI 引擎（Python 内核，零第三方依赖）。

模块划分：
    server.py     仅依赖标准库的 HTTP 入口（Express 适配层作为唯一调用方）
    prompts.py    提示词与请求拼装
    llm.py        OpenAI 兼容接口调用 + 15 秒硬超时 + JSON 抽取
    validate.py   入参结构化校验、模型返回字段校验
    extract.py    原文整理兜底（不使用任何预先写好的总结）
    keywords.py   疑似考点词表与否定判定（与 src/radar/detectExamHits.ts 对齐）
"""
