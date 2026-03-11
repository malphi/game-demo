"""
Shared DynamoDB configuration.

Reads environment variables:
  - ENV: table name suffix (e.g. "dev" -> "Players-dev"). Default: empty (no suffix).
  - DYNAMODB_ENDPOINT: custom endpoint URL for local DynamoDB. Default: None (use AWS).
"""

import os
import boto3

_ENV = os.environ.get("ENV", "")
_ENDPOINT = os.environ.get("DYNAMODB_ENDPOINT", "")

_REGION = os.environ.get("AWS_REGION", os.environ.get("AWS_DEFAULT_REGION", None))

_kwargs = {}
if _ENDPOINT:
    _kwargs["endpoint_url"] = _ENDPOINT
if _REGION:
    _kwargs["region_name"] = _REGION

dynamodb = boto3.resource("dynamodb", **_kwargs)


def table_name(base: str) -> str:
    """Return the full table name with optional environment suffix."""
    return f"{base}-{_ENV}" if _ENV else base
