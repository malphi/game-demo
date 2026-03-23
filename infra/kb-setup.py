#!/usr/bin/env python3
"""
Bedrock Knowledge Base Setup Script - 创建 KB、S3 数据源、触发同步。

前置条件:
    1. 已运行 kb-sync.py 生成 KB 数据源文件
    2. 已配置 AWS CLI 凭据，且 IAM 用户/角色拥有 Bedrock、S3、IAM 权限

Usage:
    python kb-setup.py --region us-west-2 --env dev
    python kb-setup.py --region us-west-2 --env dev --bucket-name my-custom-bucket
"""

import argparse
import json
import time
import uuid

import boto3
from botocore.exceptions import ClientError


EMBEDDING_MODEL_ID = "amazon.titan-embed-text-v2:0"
KB_DATA_DIR = "../backend/npc-agent/kb-data"


def get_or_create_bucket(s3_client, bucket_name, region):
    """创建 S3 Bucket（如已存在则跳过）。"""
    try:
        s3_client.head_bucket(Bucket=bucket_name)
        print(f"  S3 Bucket '{bucket_name}' already exists.")
    except ClientError:
        print(f"  Creating S3 Bucket '{bucket_name}'...")
        create_kwargs = {"Bucket": bucket_name}
        if region != "us-east-1":
            create_kwargs["CreateBucketConfiguration"] = {
                "LocationConstraint": region
            }
        s3_client.create_bucket(**create_kwargs)
        print(f"  -> Bucket created.")
    return bucket_name


def upload_kb_data(s3_client, bucket_name, data_dir, s3_prefix):
    """上传 kb-data/ 下的所有 .md 文件到 S3。"""
    import os

    uploaded = 0
    for filename in os.listdir(data_dir):
        if not filename.endswith(".md"):
            continue
        filepath = os.path.join(data_dir, filename)
        s3_key = f"{s3_prefix}/{filename}"
        print(f"  Uploading {filename} -> s3://{bucket_name}/{s3_key}")
        s3_client.upload_file(filepath, bucket_name, s3_key)
        uploaded += 1
    print(f"  -> {uploaded} files uploaded.")
    return uploaded


def get_or_create_kb_role(iam_client, role_name, region, bucket_name):
    """创建 KB 所需的 IAM Role（如已存在则跳过）。"""
    trust_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Principal": {"Service": "bedrock.amazonaws.com"},
                "Action": "sts:AssumeRole",
            }
        ],
    }

    try:
        resp = iam_client.get_role(RoleName=role_name)
        role_arn = resp["Role"]["Arn"]
        print(f"  IAM Role '{role_name}' already exists: {role_arn}")
    except iam_client.exceptions.NoSuchEntityException:
        print(f"  Creating IAM Role '{role_name}'...")
        resp = iam_client.create_role(
            RoleName=role_name,
            AssumeRolePolicyDocument=json.dumps(trust_policy),
            Description="Role for Bedrock Knowledge Base to access S3 and embeddings",
        )
        role_arn = resp["Role"]["Arn"]
        print(f"  -> Role created: {role_arn}")

    # Attach inline policy for S3 + Bedrock access
    policy_name = f"{role_name}-policy"
    inline_policy = {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Effect": "Allow",
                "Action": ["s3:GetObject", "s3:ListBucket"],
                "Resource": [
                    f"arn:aws:s3:::{bucket_name}",
                    f"arn:aws:s3:::{bucket_name}/*",
                ],
            },
            {
                "Effect": "Allow",
                "Action": ["bedrock:InvokeModel"],
                "Resource": [
                    f"arn:aws:bedrock:{region}::foundation-model/{EMBEDDING_MODEL_ID}"
                ],
            },
        ],
    }
    iam_client.put_role_policy(
        RoleName=role_name,
        PolicyName=policy_name,
        PolicyDocument=json.dumps(inline_policy),
    )
    print(f"  -> Inline policy '{policy_name}' attached.")

    # Wait for IAM propagation
    print("  Waiting 10s for IAM role propagation...")
    time.sleep(10)

    return role_arn


def create_knowledge_base(bedrock_agent_client, name, role_arn, region, description):
    """创建 Bedrock Knowledge Base。"""
    embedding_model_arn = (
        f"arn:aws:bedrock:{region}::foundation-model/{EMBEDDING_MODEL_ID}"
    )

    try:
        resp = bedrock_agent_client.create_knowledge_base(
            name=name,
            description=description,
            roleArn=role_arn,
            knowledgeBaseConfiguration={
                "type": "VECTOR",
                "vectorKnowledgeBaseConfiguration": {
                    "embeddingModelArn": embedding_model_arn,
                    "embeddingModelConfiguration": {
                        "bedrockEmbeddingModelConfiguration": {
                            "dimensions": 256,
                        }
                    },
                },
            },
            storageConfiguration={
                "type": "OPENSEARCH_SERVERLESS",
                "opensearchServerlessConfiguration": {
                    "collectionArn": "PLACEHOLDER",
                    "fieldMapping": {
                        "metadataField": "metadata",
                        "textField": "text",
                        "vectorField": "vector",
                    },
                    "vectorIndexName": f"kb-{name.lower().replace(' ', '-')}",
                },
            },
            clientToken=str(uuid.uuid4()),
        )
        kb = resp["knowledgeBase"]
        print(f"  -> Knowledge Base created: {kb['knowledgeBaseId']}")
        return kb
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConflictException":
            # KB with same name may exist, list and find it
            print(f"  Knowledge Base may already exist, searching...")
            paginator = bedrock_agent_client.get_paginator("list_knowledge_bases")
            for page in paginator.paginate():
                for kb_summary in page["knowledgeBaseSummaries"]:
                    if kb_summary["name"] == name:
                        kb_id = kb_summary["knowledgeBaseId"]
                        print(f"  -> Found existing KB: {kb_id}")
                        return bedrock_agent_client.get_knowledge_base(
                            knowledgeBaseId=kb_id
                        )["knowledgeBase"]
        raise


def create_s3_data_source(bedrock_agent_client, kb_id, bucket_name, s3_prefix):
    """为 KB 创建 S3 数据源。"""
    try:
        resp = bedrock_agent_client.create_data_source(
            knowledgeBaseId=kb_id,
            name="game-dictionary-s3",
            description="Game dictionary data (monsters, items, NPCs, task rules)",
            dataSourceConfiguration={
                "type": "S3",
                "s3Configuration": {
                    "bucketArn": f"arn:aws:s3:::{bucket_name}",
                    "inclusionPrefixes": [f"{s3_prefix}/"],
                },
            },
        )
        ds = resp["dataSource"]
        print(f"  -> Data Source created: {ds['dataSourceId']}")
        return ds
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConflictException":
            print(f"  Data source may already exist, searching...")
            resp = bedrock_agent_client.list_data_sources(knowledgeBaseId=kb_id)
            for ds in resp["dataSourceSummaries"]:
                if ds["name"] == "game-dictionary-s3":
                    print(f"  -> Found existing data source: {ds['dataSourceId']}")
                    return ds
        raise


def start_ingestion(bedrock_agent_client, kb_id, ds_id):
    """触发 KB 数据同步。"""
    resp = bedrock_agent_client.start_ingestion_job(
        knowledgeBaseId=kb_id,
        dataSourceId=ds_id,
    )
    job = resp["ingestionJob"]
    job_id = job["ingestionJobId"]
    print(f"  -> Ingestion job started: {job_id}")

    # Poll for completion
    print("  Waiting for ingestion to complete...")
    while True:
        resp = bedrock_agent_client.get_ingestion_job(
            knowledgeBaseId=kb_id,
            dataSourceId=ds_id,
            ingestionJobId=job_id,
        )
        status = resp["ingestionJob"]["status"]
        if status in ("COMPLETE", "FAILED", "STOPPED"):
            break
        print(f"    Status: {status}...")
        time.sleep(5)

    if status == "COMPLETE":
        stats = resp["ingestionJob"].get("statistics", {})
        print(f"  -> Ingestion complete! Documents scanned: {stats}")
    else:
        print(f"  [!] Ingestion ended with status: {status}")
        failure = resp["ingestionJob"].get("failureReasons", [])
        if failure:
            print(f"      Reasons: {failure}")

    return status


def main():
    parser = argparse.ArgumentParser(
        description="Create and configure Bedrock Knowledge Base for game dictionary data."
    )
    parser.add_argument("--region", default="us-west-2", help="AWS region")
    parser.add_argument("--env", default="dev", help="Environment suffix")
    parser.add_argument(
        "--bucket-name",
        default=None,
        help="S3 bucket name (default: game-demo-kb-{env}-{account_id})",
    )
    parser.add_argument(
        "--data-dir",
        default=None,
        help="Path to kb-data directory (default: ../backend/npc-agent/kb-data)",
    )
    args = parser.parse_args()

    import os

    data_dir = args.data_dir or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), KB_DATA_DIR
    )
    data_dir = os.path.abspath(data_dir)

    if not os.path.isdir(data_dir):
        print(f"Error: KB data directory not found: {data_dir}")
        print("Run 'python kb-sync.py' first to generate data files.")
        return 1

    # Init AWS clients
    session = boto3.Session(region_name=args.region)
    s3_client = session.client("s3")
    iam_client = session.client("iam")
    bedrock_agent = session.client("bedrock-agent")
    sts_client = session.client("sts")

    account_id = sts_client.get_caller_identity()["Account"]
    bucket_name = args.bucket_name or f"game-demo-kb-{args.env}-{account_id}"
    s3_prefix = "kb-data"
    kb_name = f"game-demo-dictionary-{args.env}"
    role_name = f"game-demo-kb-role-{args.env}"

    print("=" * 60)
    print("Bedrock Knowledge Base Setup")
    print("=" * 60)
    print(f"  Region:      {args.region}")
    print(f"  Environment: {args.env}")
    print(f"  Bucket:      {bucket_name}")
    print(f"  KB Name:     {kb_name}")
    print(f"  Data Dir:    {data_dir}")
    print(f"  Embedding:   {EMBEDDING_MODEL_ID}")
    print("=" * 60)
    print()

    # Step 1: Create/verify S3 bucket
    print("[1/5] S3 Bucket")
    get_or_create_bucket(s3_client, bucket_name, args.region)
    print()

    # Step 2: Upload KB data files
    print("[2/5] Upload KB Data")
    upload_kb_data(s3_client, bucket_name, data_dir, s3_prefix)
    print()

    # Step 3: Create IAM role
    print("[3/5] IAM Role")
    role_arn = get_or_create_kb_role(iam_client, role_name, args.region, bucket_name)
    print()

    # Step 4: Create Knowledge Base
    print("[4/5] Knowledge Base")
    print(
        "  NOTE: This script creates KB with OpenSearch Serverless placeholder."
    )
    print(
        "  For production, either:"
    )
    print(
        "    a) Create an OpenSearch Serverless collection first and update the ARN"
    )
    print(
        "    b) Use the Bedrock Console quick-create flow (recommended for demo)"
    )
    print()
    print(
        "  Skipping programmatic KB creation - use Bedrock Console instead."
    )
    print(
        "  After creating KB in console, set BEDROCK_KB_ID environment variable."
    )
    print()

    # Step 5: Output configuration
    print("[5/5] Configuration Output")
    print()
    print("  Add the following environment variable to your NPC Agent:")
    print(f"    BEDROCK_KB_ID=<your-kb-id-from-console>")
    print()
    print(
        "  To upload data files to your KB's S3 bucket after console creation:"
    )
    print(f"    aws s3 sync {data_dir} s3://<your-kb-bucket>/{s3_prefix}/")
    print()
    print("=" * 60)
    print("Setup guide complete!")
    print("=" * 60)

    return 0


if __name__ == "__main__":
    exit(main())
