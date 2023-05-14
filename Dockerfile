FROM node:lts

RUN mkdir /app
WORKDIR /app

ADD package.json /app/package.json
ADD yarn.lock /app/yarn.lock

RUN yarn install

COPY ./ /app/

ENV NODE_URL=http://node:8545

ENTRYPOINT [ "yarn", "deploy:ganache" ]