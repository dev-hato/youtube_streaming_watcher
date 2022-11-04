#!/usr/bin/env bash

for image_name in $(docker compose images | awk 'OFS=":" {print $2,$3}' | tail -n +2); do
  cmd="dockle --exit-code 1 --ak AWS_ACCESS_KEY_ID --ak AWS_SECRET_ACCESS_KEY "

  if [[ "${image_name}" =~ "db" ]]; then
    cmd+="-i CIS-DI-0009 "
  elif [[ "${image_name}" =~ "reply" ]] || [[ "${image_name}" =~ "notify" ]]; then
    cmd+="-i DKL-LI-0003 "
  fi

  cmd+="${image_name}"
  echo "> ${cmd}"
  eval "${cmd}"
done
