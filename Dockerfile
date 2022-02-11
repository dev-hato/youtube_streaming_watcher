FROM node:14.19.0-buster AS base

WORKDIR /usr/app
COPY .node-version .
COPY .npmignore .
COPY .npmrc .
COPY package*.json .
RUN npm install -g npm@7.21.0 \
    && npm install
COPY tsconfig.json .
COPY lib/dynamodb-table-props.ts lib/
COPY lib/events-rule-props.ts lib/
COPY src/common/ src/common/

FROM base AS notify

COPY src/notify/ src/notify/

CMD ["npm", "run", "start:notify"]

FROM base AS reply

COPY src/reply/index.dev.ts src/reply/

CMD ["npm", "run", "start:reply"]
