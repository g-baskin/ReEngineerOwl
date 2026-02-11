export type PutBlobInput = {
  key: string;
  content: Buffer;
  contentType?: string;
};

export type BlobObject = {
  key: string;
  content: Buffer;
  contentType?: string;
};

export interface StorageAdapter {
  putBlob(input: PutBlobInput): Promise<string>;
  getBlob(key: string): Promise<BlobObject | null>;
}
