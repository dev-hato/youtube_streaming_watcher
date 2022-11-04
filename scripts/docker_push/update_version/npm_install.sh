#!/usr/bin/env bash

npm install --prefer-offline --location=global "npm@${DEPENDABOT_NPM_VERSION}"
npm install
