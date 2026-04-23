# Build stage: transpile ES modules with Babel
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Production stage: only prod deps + compiled dist/
FROM node:22-alpine AS production
WORKDIR /app

RUN apk add --no-cache wget

COPY package*.json ./
RUN npm ci --omit=dev

RUN addgroup -S app && adduser -S app -G app

COPY --chown=app:app --from=builder /app/dist ./dist

USER app

ENV NODE_ENV=production
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:5000/health || exit 1

CMD ["node", "dist/app.js"]
