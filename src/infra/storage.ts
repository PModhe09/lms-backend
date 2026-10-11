import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Env } from '../config/env.ts';

/** What the app needs from object storage. S3 in production, an in-memory fake in tests. */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Short-lived URL the browser can GET directly. The bucket itself stays private. */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
}

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  /** Signs URLs with the host the browser can reach (in Docker the API reaches storage by an internal name). */
  private readonly signer: S3Client;

  constructor(private readonly env: Env) {
    const base = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY },
    };
    this.client = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }),
    );
  }

  presignGet(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  /** Local/dev convenience. Production buckets are created out of band. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.env.S3_BUCKET }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.env.S3_BUCKET }));
    }
  }
}

export class InMemoryStorage implements ObjectStorage {
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body, contentType });
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    return `memory://${key}?expires=${ttlSeconds}`;
  }
}
