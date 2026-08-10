# Build context is the REPOSITORY ROOT, not this directory — the build needs
# the workspace root package-lock.json and the packages/* this app depends on.
# Deployed with `fly deploy --config fly.control.toml` from the repository root.

FROM node:22-alpine AS builder
WORKDIR /app

# The whole workspace, so npm can resolve @contractor-platform/* links.
COPY . .
RUN npm ci
RUN npm run build --workspace @contractor-platform/control

FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
# Next binds 127.0.0.1 by default, which is unreachable from outside the
# container. Railway injects PORT; the server reads it.
ENV HOSTNAME=0.0.0.0

# Don't run as root.
RUN addgroup -g 1001 -S nodejs && adduser -S nextjs -u 1001

# `output: 'standalone'` emits a self-contained server plus only the
# node_modules it actually reached. For a monorepo the tree is rooted at the
# workspace, so server.js lands at apps/control/server.js.
COPY --from=builder --chown=nextjs:nodejs /app/apps/control/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/control/.next/static ./apps/control/.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "apps/control/server.js"]
