FROM node:14.19.0-bullseye-slim AS base

ARG AWS_ACCESS_KEY_ID=""
ENV AWS_ACCESS_KEY_ID ${AWS_ACCESS_KEY_ID}

ARG AWS_SECRET_ACCESS_KEY=""
ENV AWS_SECRET_ACCESS_KEY ${AWS_SECRET_ACCESS_KEY}

ARG DYNAMODB_ENDPOINT=http://db:8000
ENV DYNAMODB_ENDPOINT ${DYNAMODB_ENDPOINT}

ARG DYNAMODB_REGION=ap-northeast-1
ENV DYNAMODB_REGION ${DYNAMODB_REGION}

WORKDIR /usr/app
COPY .node-version .
COPY .npmignore .
COPY .npmrc .
COPY package*.json .
RUN npm install -g npm@8.5.1 \
    && npm install
COPY tsconfig.json .
COPY lib/props/ lib/props/
COPY src/common/ src/common/

FROM base AS notify

COPY src/notify/ src/notify/

CMD ["npm", "run", "start:notify"]

FROM base AS reply

COPY src/reply/index.dev.ts src/reply/

CMD ["npm", "run", "start:reply"]
