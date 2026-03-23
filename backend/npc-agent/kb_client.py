"""
Bedrock Knowledge Base 查询客户端。

封装 bedrock-agent-runtime Retrieve API，供 MCP tools 调用。
"""

import logging
import os

import boto3

logger = logging.getLogger(__name__)

BEDROCK_KB_ID = os.environ.get("BEDROCK_KB_ID", "")
BEDROCK_REGION = os.environ.get("BEDROCK_REGION", "us-west-2")

# 延迟初始化客户端（连接复用）
_client = None

# Call log collector — reset before each agent invocation, read after
_call_log: list[dict] = []


def reset_call_log():
    """Clear the KB call log (call before each agent invocation)."""
    _call_log.clear()


def get_call_log() -> list[dict]:
    """Return a copy of the KB call log entries."""
    return list(_call_log)


def _get_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-agent-runtime",
            region_name=BEDROCK_REGION,
        )
    return _client


def query_knowledge_base(
    query: str,
    kb_id: str | None = None,
    max_results: int = 10,
) -> list[str]:
    """查询 Bedrock Knowledge Base，返回检索到的文本内容列表。

    Args:
        query: 查询文本（自然语言）
        kb_id: Knowledge Base ID，默认从环境变量 BEDROCK_KB_ID 读取
        max_results: 最大返回结果数

    Returns:
        检索到的文本内容列表，按相关性排序
    """
    import time as _time

    kb_id = kb_id or BEDROCK_KB_ID
    if not kb_id:
        logger.warning("BEDROCK_KB_ID not set, cannot query Knowledge Base")
        _call_log.append({
            "type": "kb_query",
            "query": query[:80],
            "status": "skipped",
            "reason": "BEDROCK_KB_ID not set",
            "results": 0,
            "ms": 0,
        })
        return []

    start = _time.time()
    try:
        client = _get_client()
        response = client.retrieve(
            knowledgeBaseId=kb_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": max_results,
                }
            },
        )

        results = []
        for item in response.get("retrievalResults", []):
            content = item.get("content", {})
            text = content.get("text", "")
            if text:
                results.append(text)

        ms = round((_time.time() - start) * 1000)
        logger.info(
            "KB query returned %d results for: %s", len(results), query[:50]
        )
        _call_log.append({
            "type": "kb_query",
            "query": query[:80],
            "status": "ok",
            "results": len(results),
            "ms": ms,
        })
        return results

    except Exception as e:
        ms = round((_time.time() - start) * 1000)
        logger.error("KB query failed: %s", e)
        _call_log.append({
            "type": "kb_query",
            "query": query[:80],
            "status": "error",
            "reason": str(e)[:100],
            "results": 0,
            "ms": ms,
        })
        return []
