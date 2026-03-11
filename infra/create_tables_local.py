#!/usr/bin/env python3
"""
Helper script to create DynamoDB tables on a local DynamoDB instance for development.

Prerequisites:
    - DynamoDB Local running (e.g., via Docker):
      docker run -p 8000:8000 amazon/dynamodb-local

Usage:
    # Create tables with default endpoint (http://localhost:8000)
    python create_tables_local.py

    # Create tables with a custom endpoint
    python create_tables_local.py --endpoint-url http://localhost:8001

    # Create tables with a specific environment suffix
    python create_tables_local.py --env dev
"""

import argparse
import sys

import boto3
from botocore.exceptions import ClientError


# =============================================================================
# Table Definitions
# Mirrors the CloudFormation template (infra/template.yaml)
# =============================================================================

def get_table_definitions(env):
    """
    Return a list of table definitions matching the CloudFormation template.
    Each entry is a dict of kwargs for dynamodb.create_table().
    """
    return [
        # Players table: PK = player_id (String)
        {
            "TableName": f"Players-{env}",
            "KeySchema": [
                {"AttributeName": "player_id", "KeyType": "HASH"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "player_id", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
        # Monsters table: PK = monster_id (String)
        {
            "TableName": f"Monsters-{env}",
            "KeySchema": [
                {"AttributeName": "monster_id", "KeyType": "HASH"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "monster_id", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
        # NPCs table: PK = npc_id (String)
        {
            "TableName": f"NPCs-{env}",
            "KeySchema": [
                {"AttributeName": "npc_id", "KeyType": "HASH"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "npc_id", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
        # Items table: PK = item_id (String)
        {
            "TableName": f"Items-{env}",
            "KeySchema": [
                {"AttributeName": "item_id", "KeyType": "HASH"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "item_id", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
        # Tasks table: PK = task_id (String), GSI: player_id-index (PK=player_id, SK=status)
        {
            "TableName": f"Tasks-{env}",
            "KeySchema": [
                {"AttributeName": "task_id", "KeyType": "HASH"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "task_id", "AttributeType": "S"},
                {"AttributeName": "player_id", "AttributeType": "S"},
                {"AttributeName": "status", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
            "GlobalSecondaryIndexes": [
                {
                    "IndexName": "player_id-index",
                    "KeySchema": [
                        {"AttributeName": "player_id", "KeyType": "HASH"},
                        {"AttributeName": "status", "KeyType": "RANGE"},
                    ],
                    "Projection": {
                        "ProjectionType": "ALL",
                    },
                },
            ],
        },
        # PlayerEventSummary table: PK = player_id (String), SK = event_id (String)
        {
            "TableName": f"PlayerEventSummary-{env}",
            "KeySchema": [
                {"AttributeName": "player_id", "KeyType": "HASH"},
                {"AttributeName": "event_id", "KeyType": "RANGE"},
            ],
            "AttributeDefinitions": [
                {"AttributeName": "player_id", "AttributeType": "S"},
                {"AttributeName": "event_id", "AttributeType": "S"},
            ],
            "BillingMode": "PAY_PER_REQUEST",
        },
    ]


# =============================================================================
# Table Creation Logic
# =============================================================================

def create_table(dynamodb_client, table_def):
    """
    Create a single DynamoDB table. Handles 'table already exists' gracefully.
    Returns True if created, False if already exists.
    """
    table_name = table_def["TableName"]
    try:
        dynamodb_client.create_table(**table_def)
        # Wait for the table to become active
        waiter = dynamodb_client.get_waiter("table_exists")
        waiter.wait(
            TableName=table_name,
            WaiterConfig={"Delay": 1, "MaxAttempts": 30},
        )
        return True
    except ClientError as e:
        if e.response["Error"]["Code"] == "ResourceInUseException":
            return False
        else:
            raise


def main():
    parser = argparse.ArgumentParser(
        description="Create DynamoDB tables on a local DynamoDB instance."
    )
    parser.add_argument(
        "--endpoint-url",
        default="http://localhost:8000",
        help="DynamoDB Local endpoint URL (default: http://localhost:8000)",
    )
    parser.add_argument(
        "--region",
        default="us-west-2",
        help="AWS region for the client (default: us-west-2)",
    )
    parser.add_argument(
        "--env",
        default="dev",
        choices=["dev", "staging", "prod"],
        help="Environment suffix for table names (default: dev)",
    )
    args = parser.parse_args()

    print("=" * 60)
    print("Game Demo - Local DynamoDB Table Creator")
    print("=" * 60)
    print(f"  Endpoint: {args.endpoint_url}")
    print(f"  Region:   {args.region}")
    print(f"  Env:      {args.env}")
    print("=" * 60)
    print()

    dynamodb_client = boto3.client(
        "dynamodb",
        endpoint_url=args.endpoint_url,
        region_name=args.region,
        aws_access_key_id="fakeAccessKey",
        aws_secret_access_key="fakeSecretKey",
    )

    table_definitions = get_table_definitions(args.env)
    created_count = 0
    skipped_count = 0

    for table_def in table_definitions:
        table_name = table_def["TableName"]
        print(f"  Creating table '{table_name}'...", end=" ")

        try:
            was_created = create_table(dynamodb_client, table_def)
            if was_created:
                print("CREATED")
                created_count += 1
            else:
                print("ALREADY EXISTS (skipped)")
                skipped_count += 1
        except ClientError as e:
            print(f"ERROR: {e.response['Error']['Message']}")
            sys.exit(1)
        except Exception as e:
            print(f"ERROR: {e}")
            print(
                "\n  Make sure DynamoDB Local is running at "
                f"{args.endpoint_url}"
            )
            print(
                "  Start it with: docker run -p 8000:8000 amazon/dynamodb-local"
            )
            sys.exit(1)

    print()
    print("=" * 60)
    print(f"Done! Created: {created_count}, Already existed: {skipped_count}")
    print(f"Total tables: {len(table_definitions)}")
    print("=" * 60)

    # List all tables to verify
    print()
    print("Tables in local DynamoDB:")
    try:
        response = dynamodb_client.list_tables()
        for name in response.get("TableNames", []):
            print(f"  - {name}")
    except Exception as e:
        print(f"  Could not list tables: {e}")


if __name__ == "__main__":
    main()
