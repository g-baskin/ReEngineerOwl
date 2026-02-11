import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  AUTH_MODE: z.enum(['dev', 'jwt']).default('dev'),
  DATABASE_URL: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z.string().default('http://localhost:3000'),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().int().positive().default(50),
  LOG_LEVEL: z.string().default('info'),
  USE_MINIO: z.coerce.boolean().default(false),
  LOCAL_BLOB_DIR: z.string().default('.data/blobs'),
  MINIO_ENDPOINT: z.string().default('minio'),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_ACCESS_KEY: z.string().default('minioadmin'),
  MINIO_SECRET_KEY: z.string().default('minioadmin'),
  MINIO_BUCKET: z.string().default('reengineerowl'),
  MINIO_USE_SSL: z.coerce.boolean().default(false),
  USE_REDIS_QUEUE: z.coerce.boolean().default(false),
  REDIS_URL: z.string().default('redis://redis:6379')
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (parsed.data.NODE_ENV === 'production' && parsed.data.AUTH_MODE === 'dev') {
  console.error('Refusing to start: AUTH_MODE=dev is not allowed in production.');
  process.exit(1);
}

export const env = {
  ...parsed.data,
  corsAllowedOrigins: parsed.data.CORS_ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean),
  maxUploadSizeBytes: parsed.data.MAX_UPLOAD_SIZE_MB * 1024 * 1024
};
