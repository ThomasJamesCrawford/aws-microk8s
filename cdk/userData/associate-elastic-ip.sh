#!/bin/bash

set -e

apt-get update
apt-get install -y awscli

export AWS_DEFAULT_REGION=ap-southeast-2

ALLOCATION_ID=${ELASTIC_IP_ALLOCATION_ID}

TOKEN=$(curl -H "X-aws-ec2-metadata-token-ttl-seconds: 600" -X PUT -sS http://169.254.169.254/latest/api/token)
INSTANCE_ID=$(curl -H "X-aws-ec2-metadata-token: $TOKEN" -sS http://169.254.169.254/latest/meta-data/instance-id)

aws ec2 associate-address --instance-id "$INSTANCE_ID" --allocation-id=$ALLOCATION_ID --allow-reassociation
