FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json bun.lock* ./

RUN bun install --frozen-lockfile

COPY . .

RUN bun run type-check

# Запускаем приложение
CMD ["bun", "run", "start"] 