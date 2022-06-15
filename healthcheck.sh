#!/bin/sh

curl -s -S -o /dev/null "http://localhost:${LAMBDA_PORT}/ping"
