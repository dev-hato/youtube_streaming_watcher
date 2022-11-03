#!/usr/bin/env bash

set +e

result=$(npx cdk diff 2>&1)
exit_code=${?}
echo -e "${result}"
result="${result//'%'/'%25'}"
result="${result//$'\n'/'%0A'}"
result="${result//$'\r'/'%0D'}"
echo "result=${result}" >>"${GITHUB_OUTPUT}"
exit ${exit_code}
