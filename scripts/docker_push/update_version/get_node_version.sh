#!/usr/bin/env bash

DOCKER_CMD="node --version"
mapfile -t result < <(docker compose run notify sh -c "${DOCKER_CMD}")
node_version="${result[0]//v/}"
echo "Node.js version:" "${node_version}"
echo "node_version=${node_version}" >>"${GITHUB_OUTPUT}"
