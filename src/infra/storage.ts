import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { issueSignedToken, presignUrl, put } from '@vercel/blob';
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

  private readonly bucket: string;

  constructor(env: Env) {
    this.bucket = env.S3_BUCKET!;
    const base = {
      region: env.S3_REGION,
      forcePathStyle: env.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
    };
    this.client = new S3Client({ ...base, endpoint: env.S3_ENDPOINT });
    this.signer = new S3Client({ ...base, endpoint: env.S3_PUBLIC_ENDPOINT ?? env.S3_ENDPOINT });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  presignGet(key: string, ttlSeconds: number): Promise<string> {
    return getSignedUrl(this.signer, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  /** Local/dev convenience. Production buckets are created out of band. */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
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

/**
 * Private Vercel Blob store (used on Vercel). Credentials come from the platform (OIDC / BLOB_STORE_ID)
 * or BLOB_READ_WRITE_TOKEN. Reads go through short-lived presigned URLs, like S3.
 */
export class BlobStorage implements ObjectStorage {
  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await put(key, body, { access: 'private', contentType, addRandomSuffix: false, allowOverwrite: false });
  }

  async presignGet(key: string, ttlSeconds: number): Promise<string> {
    const validUntil = Date.now() + ttlSeconds * 1000;
    const token = await issueSignedToken({ pathname: key, operations: ['get'], validUntil });
    const { presignedUrl } = await presignUrl(token, {
      operation: 'get',
      pathname: key,
      access: 'private',
      validUntil,
    });
    return presignedUrl;
  }
}

export function createStorage(env: Env): ObjectStorage & { ensureBucket?: () => Promise<void> } {
  return env.STORAGE_DRIVER === 'blob' ? new BlobStorage() : new S3Storage(env);
}
