FROM node:14.19.0-buster AS base

WORKDIR /usr/app
RUN npm install -g npm@7.21.0

FROM base AS cdk

COPY package*.json .
RUN npm install
COPY . .

# DynamoDBのスキーマ定義をsrc/schema/schema.jsonへ出力
RUN npm run build \
    && npm run export

FROM base AS src

COPY --from=cdk /usr/app/src/ /usr/app/
RUN npm install

FROM src AS notify

RUN npm run build:dev:notify \
    && rm -rf src/ tsconfig.json webpack*

CMD ["npm", "run", "start:notify"]

FROM src AS reply

RUN npm run build:dev:reply \
    && rm -rf src/ tsconfig.json webpack*

CMD ["npm", "run", "start:reply"]
