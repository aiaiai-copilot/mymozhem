#!/bin/sh
set -e
# Deterministic migration on deploy (REQ-OPS-002). No-op until phase 1 adds models.
pnpm exec prisma migrate deploy
exec node apps/server/dist/main.js
