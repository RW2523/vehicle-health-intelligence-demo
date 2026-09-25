# VehicleSense AI - web apps (Next.js). Multi-arch (linux/arm64 for the DGX Spark, or x86-64).
# Build context is app/web:  docker build -t vhi-web app/web
FROM node:22-bookworm-slim AS build
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
# Rewrites (/api, /media, /ws -> API) are fixed at build time; inside compose the API is reachable as http://api:8000
ARG VHI_API_INTERNAL=http://api:8000
ENV VHI_API_INTERNAL=$VHI_API_INTERNAL NEXT_STANDALONE=1 NEXT_TELEMETRY_DISABLED=1
RUN npx next build

FROM node:22-bookworm-slim
WORKDIR /web
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
COPY --from=build /web/.next/standalone ./
COPY --from=build /web/.next/static ./.next/static
COPY --from=build /web/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
