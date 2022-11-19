#!/usr/bin/env bash

yq -i -o json ".dependencies.express|=\"~${EXPRESS_VERSION}\"" package.json
npm install
