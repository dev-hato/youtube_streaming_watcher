#!/usr/bin/env bash

yq -i -o json '.dependencies.express|="~${{ steps.get_types_express_version.outputs.result }}"' package.json
npm install
