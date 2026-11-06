FROM oven/bun:1.3.14-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY src ./src
# The build context may come from a host with a restrictive umask; the runtime user only needs to read.
RUN chmod -R a+rX /app/src /app/package.json
USER bun
ENV PORT=3000
EXPOSE 3000
ENTRYPOINT ["bun", "src/index.ts"]
