FROM node:14.19.0-buster AS base

WORKDIR /usr/app
RUN npm install -g npm@7.21.0

FROM base AS cdk

COPY package*.json .
RUN npm install
COPY . .

# CDKの設定をsrc/config/内に出力
RUN npm run export

FROM base AS src

COPY --from=cdk /usr/app/src/ /usr/app/
RUN npm install

FROM src AS notify

CMD ["npm", "run", "start:notify"]

FROM src AS reply

CMD ["npm", "run", "start:reply"]
