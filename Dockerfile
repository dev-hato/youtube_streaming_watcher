FROM node:14.19.0-buster AS base

WORKDIR /usr/app
COPY package*.json .
RUN npm install -g npm@7.21.0 \
    && npm install
COPY . .

FROM base AS notify

RUN npm run build:dev:notify
RUN rm -rf src/ tsconfig.json webpack*

CMD ["npm", "run", "start:notify"]

FROM base AS reply

RUN npm run build:dev:reply
RUN rm -rf src/ tsconfig.json webpack*

CMD ["npm", "run", "start:reply"]
