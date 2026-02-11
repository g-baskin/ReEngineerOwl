import path from 'node:path';
import { env } from '../../config/env.js';
import { FsStorageAdapter } from './fs.storage.js';
import { MinioStorageAdapter } from './minio.storage.js';
import type { StorageAdapter } from './storage.interface.js';

let storageAdapter: StorageAdapter | null = null;

export const getStorageAdapter = (): StorageAdapter => {
  if (storageAdapter) {
    return storageAdapter;
  }

  if (env.USE_MINIO) {
    storageAdapter = new MinioStorageAdapter({
      endPoint: env.MINIO_ENDPOINT,
      port: env.MINIO_PORT,
      useSSL: env.MINIO_USE_SSL,
      accessKey: env.MINIO_ACCESS_KEY,
      secretKey: env.MINIO_SECRET_KEY,
      bucket: env.MINIO_BUCKET
    });
  } else {
    storageAdapter = new FsStorageAdapter(path.resolve(process.cwd(), env.LOCAL_BLOB_DIR));
  }

  return storageAdapter;
};
