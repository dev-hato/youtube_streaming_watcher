FROM node:14.19.3-bullseye-slim AS build

WORKDIR /usr/app
COPY .node-version .
COPY .npmignore .
COPY .npmrc .
COPY package*.json .
RUN npm install -g npm@8.5.1 \
    && npm ci

USER node

FROM gcr.io/distroless/nodejs:14 AS base

COPY --from=build /etc/group /etc/group
COPY --from=build /etc/passwd /etc/passwd
COPY --from=build /etc/shadow /etc/shadow
COPY --from=build /etc/master.passwd /etc/master.passwd
USER node

ARG AWS_ACCESS_KEY_ID=""
ENV AWS_ACCESS_KEY_ID ${AWS_ACCESS_KEY_ID}

ARG AWS_SECRET_ACCESS_KEY=""
ENV AWS_SECRET_ACCESS_KEY ${AWS_SECRET_ACCESS_KEY}

ARG DYNAMODB_ENDPOINT=http://db:8000
ENV DYNAMODB_ENDPOINT ${DYNAMODB_ENDPOINT}

ARG DYNAMODB_REGION=ap-northeast-1
ENV DYNAMODB_REGION ${DYNAMODB_REGION}

WORKDIR /usr/app
COPY --from=build /usr/app .
COPY tsconfig.json .
COPY lib/props/ lib/props/
COPY src/common/ src/common/

FROM base AS notify

COPY src/notify/ src/notify/

CMD ["npm", "run", "start:notify"]

FROM base AS reply

COPY src/reply/index.dev.ts src/reply/

CMD ["npm", "run", "start:reply"]
