#!/usr/bin/env bash

bash "${GITHUB_WORKSPACE}/scripts/npm_ci.sh"
npx cdk deploy --require-approval never
