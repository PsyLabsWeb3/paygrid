FROM node:22-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV MCP_HTTP_PORT=3002

CMD ["npm", "run", "start:http"]
