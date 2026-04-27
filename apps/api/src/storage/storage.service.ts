import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { S3Client, HeadBucketCommand, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, CopyObjectCommand } from '@aws-sdk/client-s3';
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
      // R2 + AWS SDK v3 + virtual-hosted style + presigning has a known
      // mismatch: direct PUT/GET calls (where the SDK constructs and signs
      // the URL internally) work fine, but presigned URLs come out invalid
      // — R2 returns 'InvalidArgument: Authorization' even though the
      // signature looks well-formed. forcePathStyle removes the ambiguity
      // by routing everything through path-style URLs
      // (`{accountId}.r2.cloudflarestorage.com/{bucket}/{key}` instead of
      // `{bucket}.{accountId}.r2.cloudflarestorage.com/{key}`). Both forms
      // are supported by R2 for direct API calls; this just makes presigning
      // consistent.
      forcePathStyle: true,
      // R2 compatibility: AWS SDK v3 default WHEN_SUPPORTED auto-adds
      // x-amz-checksum-mode=ENABLED to GET requests — kept here as
      // defence-in-depth alongside the per-command middleware in
      // getPresignedUrl.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
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

  /** Server-side copy within the same bucket. Used by research retention to
   *  move a photo from its per-user `submissions/<user>/<id>.jpg` path to a
   *  flat `research/<id>.jpg` path before the caller deletes the source. */
  async copyObject(sourceKey: string, destKey: string): Promise<void> {
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destKey,
        // CopySource must be bucket-prefixed and URL-encoded per S3 contract.
        CopySource: `${this.bucket}/${encodeURIComponent(sourceKey)}`,
      }),
    );
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
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    // R2 rejects presigned URLs that contain `x-amz-checksum-mode=ENABLED`
    // (auto-added by AWS SDK v3 default response-checksum middleware) with
    // 'InvalidArgument: Authorization'. The S3Client config flags
    // `responseChecksumValidation: 'WHEN_REQUIRED'` are supposed to suppress
    // this, but in our SDK version (3.1014) the param still leaks into the
    // signed URL. Belt-and-braces: remove the header at build step before
    // SigV4 sees it, so it never appears in the URL or the signature.
    command.middlewareStack.add(
      (next) => async (args) => {
        if (args.request && typeof args.request === 'object' && 'headers' in args.request) {
          const headers = (args.request as { headers: Record<string, unknown> }).headers;
          delete headers['x-amz-checksum-mode'];
        }
        return next(args);
      },
      { step: 'build', name: 'r2-strip-checksum-mode' },
    );
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }
}
