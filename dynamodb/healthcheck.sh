#!/bin/sh

aws dynamodb list-tables --endpoint-url "http://localhost:${DB_PORT}"
