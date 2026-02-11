import fs from 'node:fs/promises';
import path from 'node:path';
import mime from 'mime-types';
import type { BlobObject, PutBlobInput, StorageAdapter } from './storage.interface.js';

export class FsStorageAdapter implements StorageAdapter {
  constructor(private readonly rootDir: string) {}

  async putBlob(input: PutBlobInput): Promise<string> {
    const filePath = this.toAbsolute(input.key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, input.content);
    return input.key;
  }

  async getBlob(key: string): Promise<BlobObject | null> {
    const filePath = this.toAbsolute(key);
    try {
      const content = await fs.readFile(filePath);
      const contentType = mime.lookup(key);
      if (typeof contentType === 'string') {
        return { key, content, contentType };
      }
      return { key, content };
    } catch {
      return null;
    }
  }

  private toAbsolute(key: string): string {
    const cleaned = key.replace(/^\/+/, '');
    return path.resolve(this.rootDir, cleaned);
  }
}
