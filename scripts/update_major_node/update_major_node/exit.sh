#!/usr/bin/env bash

if grep "^${LAMBDA_VERSION}" .node-version; then
  exit 0
fi
