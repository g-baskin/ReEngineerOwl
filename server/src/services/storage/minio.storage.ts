import { Client } from 'minio';
import type { BlobObject, PutBlobInput, StorageAdapter } from './storage.interface.js';

type MinioConfig = {
  endPoint: string;
  port: number;
  useSSL: boolean;
  accessKey: string;
  secretKey: string;
  bucket: string;
};

export class MinioStorageAdapter implements StorageAdapter {
  private readonly client: Client;

  constructor(private readonly config: MinioConfig) {
    this.client = new Client({
      endPoint: config.endPoint,
      port: config.port,
      useSSL: config.useSSL,
      accessKey: config.accessKey,
      secretKey: config.secretKey
    });
  }

  async ensureBucket(): Promise<void> {
    const exists = await this.client.bucketExists(this.config.bucket);
    if (!exists) {
      await this.client.makeBucket(this.config.bucket);
    }
  }

  async putBlob(input: PutBlobInput): Promise<string> {
    await this.ensureBucket();
    await this.client.putObject(this.config.bucket, input.key, input.content, input.content.length, {
      'Content-Type': input.contentType ?? 'application/octet-stream'
    });
    return input.key;
  }

  async getBlob(key: string): Promise<BlobObject | null> {
    try {
      await this.ensureBucket();
      const stream = await this.client.getObject(this.config.bucket, key);
      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('end', () => resolve());
        stream.on('error', (error) => reject(error));
      });

      return {
        key,
        content: Buffer.concat(chunks),
        contentType: undefined
      };
    } catch {
      return null;
    }
  }
}
