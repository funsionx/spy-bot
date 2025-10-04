FROM oven/bun:1.2-alpine

WORKDIR /app

COPY package.json ./

RUN bun install

COPY . .

RUN bun run type-check

# Запускаем приложение
CMD ["bun", "run", "start"] 