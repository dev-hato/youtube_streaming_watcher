#!/usr/bin/env bash

echo "${NODE_VERSION}" >.node-version

NODE_PATTERN="s/\"node\": \".*\"/\"node\": \"^${DEPENDABOT_NODE_VERSION}"

if [ "${DEPENDABOT_NODE_VERSION}" != "${NODE_VERSION}" ]; then
  NODE_PATTERN+=" || ^${NODE_VERSION}"
fi

NODE_PATTERN+="\"/g"
sed -i -e "${NODE_PATTERN}" package.json

NPM_PATTERN_PACKAGE="s/\"npm\": \".*\"/\"npm\": \"^${DEPENDABOT_NPM_VERSION}\"/g"
sed -i -e "${NPM_PATTERN_PACKAGE}" package.json

NPM_PATTERN_DOCKER="s/npm@[0-9.]*/npm@${DEPENDABOT_NPM_VERSION}/g"
sed -i -e "${NPM_PATTERN_DOCKER}" Dockerfile
