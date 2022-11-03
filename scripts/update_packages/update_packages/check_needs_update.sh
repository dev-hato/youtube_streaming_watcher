#!/usr/bin/env bash

if [[ "$(jq -r '.dependencies.express' package.json)" =~ ${TYPES_EXPRESS_VERSION} ]]; then
  echo "needs_update=false" >>"${GITHUB_OUTPUT}"
else
  echo "needs_update=true" >>"${GITHUB_OUTPUT}"
fi
