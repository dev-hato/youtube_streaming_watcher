#!/usr/bin/env bash

cat .env.example >> "$GITHUB_ENV"

dockle_version="$(cat .dockle-version)"
curl -L -o dockle.deb "https://github.com/goodwithtech/dockle/releases/download/v${dockle_version}/dockle_${dockle_version}_Linux-64bit.deb"
sudo dpkg -i dockle.deb

docker compose pull
docker compose up -d

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
