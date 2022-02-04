FROM node:14.19.0-buster

WORKDIR /usr/app
COPY . .
RUN npm install -g npm@7.21.0 \
    && npm install
RUN npm run build

CMD ["npm", "start"]
