FROM node:18.14.0-bullseye-slim AS base

RUN apt-get update \
    # hadolint ignore=DL3008
    && apt-get install -y --no-install-recommends curl \
    && npm install --location=global npm@8.19.2 \
    && find / -type f -perm /u+s -ignore_readdir_race -exec chmod u-s {} \; \
    && find / -type f -perm /g+s -ignore_readdir_race -exec chmod g-s {} \; \
    && rm -rf /root/.npm /tmp /var/lib/apt/lists

USER node

ARG AWS_ACCESS_KEY_ID=""
ENV AWS_ACCESS_KEY_ID ${AWS_ACCESS_KEY_ID}

ARG AWS_SECRET_ACCESS_KEY=""
ENV AWS_SECRET_ACCESS_KEY ${AWS_SECRET_ACCESS_KEY}

ARG DB_PORT=8000
ENV DB_PORT ${DB_PORT}

ARG DYNAMODB_ENDPOINT=http://db:${DB_PORT}
ENV DYNAMODB_ENDPOINT ${DYNAMODB_ENDPOINT}

ARG DYNAMODB_REGION=ap-northeast-1
ENV DYNAMODB_REGION ${DYNAMODB_REGION}

WORKDIR /usr/app
COPY .node-version .
COPY .npmignore .
COPY .npmrc .
COPY package*.json .
RUN npm ci \
    && rm -rf /home/node/.npm
COPY tsconfig.json .
COPY lib/default/props/ lib/default/props/
COPY src/common/ src/common/
COPY healthcheck.sh .

HEALTHCHECK --interval=5s --retries=20 CMD ["./healthcheck.sh"]

FROM base AS notify

COPY src/notify/ src/notify/

CMD ["npm", "run", "start:notify"]

FROM base AS reply

COPY src/reply/index.dev.ts src/reply/

CMD ["npm", "run", "start:reply"]
