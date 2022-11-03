#!/usr/bin/env bash

ROLE="arn:aws:iam::${AWS_ACCOUNT}"
ROLE+=":role/youtube_streaming_watcher_cdk_diff"
echo "ROLE=${ROLE}" >>"${GITHUB_ENV}"
