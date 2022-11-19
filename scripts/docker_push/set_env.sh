#!/usr/bin/env bash

cp .env.example .env
cat .env >> "$GITHUB_ENV"
