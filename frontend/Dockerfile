# =============================================================================
#  Lead-to-Cash web application
#  Stage 1 builds the static files, stage 2 serves them with an unprivileged
#  nginx (never root, port 8080) that also forwards /api/ to the API.
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Exact versions from package-lock.json; install scripts of packages are not run
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

COPY index.html vite.config.ts tsconfig.json postcss.config.js tailwind.config.js ./
COPY public ./public
COPY src ./src

# The web app calls the API on its own address ("/api/v1"); see nginx.conf
ARG VITE_API_URL=/api/v1
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# -----------------------------------------------------------------------------
FROM nginxinc/nginx-unprivileged:stable-alpine

# Address of the API. No trailing slash. Kubernetes sets http://backend-service:8000
ENV BACKEND_UPSTREAM=http://backend:8000

# *.template files are rendered to /etc/nginx/conf.d/ when the container starts
# (only ${BACKEND_UPSTREAM} is replaced; nginx's own $variables are left alone)
COPY nginx.conf /etc/nginx/templates/default.conf.template
COPY nginx-security-headers.conf /etc/nginx/lc-security-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1
