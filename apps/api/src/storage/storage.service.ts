import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private client!: S3Client;
  private bucket!: string;

  constructor(private config: ConfigService) {}

  async onModuleInit() {
    const accountId = this.config.getOrThrow<string>('R2_ACCOUNT_ID');
    this.bucket = this.config.getOrThrow<string>('R2_BUCKET_NAME');
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: this.config.getOrThrow('R2_ACCESS_KEY_ID'),
        secretAccessKey: this.config.getOrThrow('R2_SECRET_ACCESS_KEY'),
      },
    });
    await this.testConnection();
  }

  async testConnection() {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.logger.log('R2 bucket connection OK');
    } catch (err) {
      this.logger.error('R2 bucket connection FAILED', err);
    }
  }

  async uploadBuffer(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  // 10 MB default — photos should never exceed 5 MB in practice; guard against OOM (Story 3.9 D1)
  static readonly MAX_OBJECT_BYTES = 10 * 1024 * 1024;

  async getObjectBuffer(key: string, maxBytes = StorageService.MAX_OBJECT_BYTES): Promise<Buffer> {
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) throw new Error(`R2 object body is empty for key: ${key}`);
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        throw new Error(
          `R2 object ${key} exceeds size limit of ${maxBytes} bytes (got ${totalBytes}+)`,
        );
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }

  async getPresignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: expiresInSeconds },
    );
  }
}
