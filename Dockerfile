FROM node:22.23.3-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --offline
COPY . .

ENTRYPOINT ["node", "bin/behavior-diff.mjs"]
