# syntax=docker/dockerfile:1
# ─── 1) 전체 의존성 설치 (dev 포함 — vite/esbuild 빌드용) ───
FROM node:22-slim AS deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

# ─── 2) 빌드 ───
# VITE_* 는 빌드 타임에 클라이언트 번들에 박힘 → 반드시 build arg로 주입
FROM deps AS build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
COPY . .
# URL은 빈값 허용(빈값 → 런타임에 same-origin 사용). anon 키는 필수.
RUN test -n "$VITE_SUPABASE_ANON_KEY" || (echo "ERROR: VITE_SUPABASE_ANON_KEY build arg 누락" && exit 1)
RUN npm run build

# ─── 3) 프로덕션 의존성만 별도 설치 ───
FROM node:22-slim AS prod-deps
WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev --no-audit --no-fund

# ─── 4) 런타임 (non-root) ───
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
