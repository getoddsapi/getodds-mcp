# Runs the stdio MCP server. Keyless tools work with no env; set GETODDS_API_KEY for the rest.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json LICENSE ./
RUN npm ci --omit=dev --ignore-scripts
COPY server.mjs tools.mjs ./
USER node
ENTRYPOINT ["node", "server.mjs"]
