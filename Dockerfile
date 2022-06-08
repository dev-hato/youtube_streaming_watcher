FROM node:14.19.3-bullseye-slim AS base

RUN npm install -g npm@8.5.1 \
    && chmod u-s /sbin/unix_chkpwd \
    && chmod g-s /sbin/unix_chkpwd \
    && chmod u-s /usr/bin/chfn \
    && chmod g-s /usr/bin/chfn \
    && chmod u-s /usr/bin/expiry \
    && chmod g-s /usr/bin/expiry \
    && chmod u-s /usr/bin/chage \
    && chmod g-s /usr/bin/chage \
    && chmod u-s /usr/bin/passwd \
    && chmod g-s /usr/bin/passwd \
    && chmod u-s /bin/mount \
    && chmod g-s /bin/mount \
    && chmod u-s /bin/su \
    && chmod g-s /bin/su \
    && chmod u-s /usr/bin/wall \
    && chmod g-s /usr/bin/wall \
    && chmod u-s /bin/umount \
    && chmod g-s /bin/umount \
    && chmod u-s /usr/bin/chsh \
    && chmod g-s /usr/bin/chsh \
    && chmod u-s /usr/bin/newgrp \
    && chmod g-s /usr/bin/newgrp \
    && chmod u-s /usr/bin/gpasswd \
    && chmod g-s /usr/bin/gpasswd \
    && rm -rf /root/.npm /tmp

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
COPY .node-version .
COPY .npmignore .
COPY .npmrc .
COPY package*.json .
RUN npm ci \
    && rm -rf /home/node/.npm
COPY tsconfig.json .
COPY lib/props/ lib/props/
COPY src/common/ src/common/

FROM base AS notify

COPY src/notify/ src/notify/

CMD ["npm", "run", "start:notify"]

FROM base AS reply

COPY src/reply/index.dev.ts src/reply/

CMD ["npm", "run", "start:reply"]
