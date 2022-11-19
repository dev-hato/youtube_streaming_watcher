#!/usr/bin/env bash

bash "${GITHUB_WORKSPACE}/scripts/npm_ci.sh"
node_version="$(node --version | sed -e 's/v//g')"
sed -i -e "s/\(FROM node:\)[0-9.]*\(-.*\)/\1${node_version}\2/g" Dockerfile
