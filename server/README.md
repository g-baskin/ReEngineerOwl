# ReEngineerOwl Local-First Server Skeleton

This folder contains a local-first backend skeleton that can run fully on your machine with Docker.

## Features

- TypeScript + strict typing (`strict: true`)
- PostgreSQL persistence via Prisma
- REST API for org/project/capture management
- Upload + artifact storage using:
  - local filesystem by default (`.data/blobs`)
  - optional MinIO (S3-compatible) when `USE_MINIO=true`
- Optional Redis/BullMQ background queue when `USE_REDIS_QUEUE=true`
- Auth mode switching:
  - `AUTH_MODE=dev` uses `X-User-Email` and auto-provisions users (non-production only)
  - `AUTH_MODE=jwt` uses a bearer-token validation stub
- Built-in export artifacts:
  - `GET /exports/openapi.json`
  - `GET /exports/postman.json`
- Architecture report generation from uploaded `bundle` JSON

## Quick Start (Docker)

```bash
cd server
cp .env.example .env
docker compose up --build
```

Enable optional services:

```bash
# Redis queue
USE_REDIS_QUEUE=true docker compose --profile queue up --build

# MinIO storage
USE_MINIO=true docker compose --profile minio up --build

# Both
USE_MINIO=true USE_REDIS_QUEUE=true docker compose --profile minio --profile queue up --build
```

## Local Development (without Docker)

```bash
cd server
cp .env.example .env
npm install
npm run prisma:generate
npm run dev
```

> For first-time DB setup: `npx prisma migrate dev --name init`

## Authentication Modes

- `AUTH_MODE=dev`
  - Requires header `X-User-Email`
  - User is auto-created if missing
  - Startup is blocked if `NODE_ENV=production`
- `AUTH_MODE=jwt`
  - Requires bearer token
  - Current implementation is a validation stub

## API Endpoints

- `POST /orgs`
- `GET /orgs`
- `POST /orgs/:orgId/projects`
- `GET /orgs/:orgId/projects`
- `POST /orgs/:orgId/projects/:projectId/captures` (multipart)
- `GET /orgs/:orgId/projects/:projectId/captures`
- `GET /orgs/:orgId/projects/:projectId/captures/:captureId`
- `GET /orgs/:orgId/projects/:projectId/captures/:captureId/download/:artifact`
- `GET /exports/openapi.json`
- `GET /exports/postman.json`

Where `artifact ∈ bundle|schema|openapi|postman|arch`.

## Example Usage

```bash
# Create org
curl -X POST http://localhost:4000/orgs \
  -H 'Content-Type: application/json' \
  -H 'X-User-Email: dev@example.com' \
  -d '{"name":"Acme"}'

# List orgs
curl http://localhost:4000/orgs \
  -H 'X-User-Email: dev@example.com'

# Create project
curl -X POST http://localhost:4000/orgs/<ORG_ID>/projects \
  -H 'Content-Type: application/json' \
  -H 'X-User-Email: dev@example.com' \
  -d '{"name":"Website","description":"Primary app"}'

# Upload capture bundle + optional artifacts
curl -X POST http://localhost:4000/orgs/<ORG_ID>/projects/<PROJECT_ID>/captures \
  -H 'X-User-Email: dev@example.com' \
  -F 'title=Capture 1' \
  -F 'notes=Initial import' \
  -F 'bundle=@./sample.bundle.json;type=application/json' \
  -F 'schema=@./schema.json;type=application/json' \
  -F 'openapi=@./openapi.json;type=application/json' \
  -F 'postman=@./collection.json;type=application/json'
```

## Environment Variables

See `.env.example` for complete keys.

Core keys:

- `NODE_ENV`
- `PORT`
- `AUTH_MODE`
- `DATABASE_URL`
- `CORS_ALLOWED_ORIGINS`
- `MAX_UPLOAD_SIZE_MB`
- `USE_MINIO`
- `LOCAL_BLOB_DIR`
- `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `MINIO_BUCKET`, `MINIO_USE_SSL`
- `USE_REDIS_QUEUE`
- `REDIS_URL`

## Notes

- Request body logging is intentionally minimized.
- CORS is restricted to configured origins.
- Upload size is globally constrained by `MAX_UPLOAD_SIZE_MB`.
