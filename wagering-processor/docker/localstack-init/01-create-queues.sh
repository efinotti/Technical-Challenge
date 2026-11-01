#!/bin/bash
set -euo pipefail

# Use JSON files so nested RedrivePolicy values are passed to AWS CLI without
# relying on shell quoting/shorthand parsing.
cat >/tmp/wager-dlq-attributes.json <<'JSON'
{"FifoQueue":"true","ContentBasedDeduplication":"true","VisibilityTimeout":"60"}
JSON

awslocal sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes file:///tmp/wager-dlq-attributes.json >/dev/null

DLQ_URL="$(awslocal sqs get-queue-url --queue-name wager-transactions-dlq.fifo --query QueueUrl --output text)"
DLQ_ARN="$(awslocal sqs get-queue-attributes --queue-url "$DLQ_URL" --attribute-names QueueArn --query Attributes.QueueArn --output text)"

python3 - "$DLQ_ARN" >/tmp/wager-request-attributes.json <<'PY'
import json
import sys

dlq_arn = sys.argv[1]
print(json.dumps({
    "FifoQueue": "true",
    "ContentBasedDeduplication": "true",
    "VisibilityTimeout": "60",
    "RedrivePolicy": json.dumps({"deadLetterTargetArn": dlq_arn, "maxReceiveCount": "5"}),
}))
PY

awslocal sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes file:///tmp/wager-request-attributes.json >/dev/null

awslocal sqs create-queue --queue-name wager-events >/dev/null

echo 'LocalStack SQS queues created.'
