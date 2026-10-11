import type { IncomingMessage } from 'node:http';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { del, get, issueSignedToken, presignUrl, put } from '@vercel/blob';
import { handleUploadPresigned, type HandleUploadPresignedBody } from '@vercel/blob/client';
import type { Env } from '../config/env.ts';
import { ValidationError } from '../domain/errors.ts';

/** Size and first bytes of a stored object: enough to check the limit and the magic bytes. */
export type ObjectInfo = { size: number; head: Buffer };

/** Constraints for a browser-to-storage upload, set by the server. */
export type DirectUploadPolicy = {
  /** Throws to refuse the pathname the client asked for. */
  authorize: (pathname: string) => void;
  maxBytes: number;
  contentTypes: string[];
  ttlSeconds: number;
};

/** What the app needs from object storage. S3/Blob in production, an in-memory fake in tests. */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Short-lived URL the browser can GET directly. The bucket itself stays private. */
  presignGet(key: string, ttlSeconds: number): Promise<string>;
  /** null if the object does not exist. */
  inspect(key: string, headBytes: number): Promise<ObjectInfo | null>;
  remove(key: string): Promise<void>;
  /**
   * Present when the browser can upload straight to storage (bypassing the API's request-size limit).
   * Answers the client SDK's presign request.
   */
  directUpload?: (body: unknown, request: IncomingMessage, policy: DirectUploadPolicy) => Promise<unknown>;
}

async function firstBytes(
  stream: ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>,
  n: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
    total += chunk.length;
    if (total >= n) break; // leaving the loop cancels the rest of the download
  }
  return Buffer.concat(chunks).subarray(0, n);
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

  async inspect(key: string, headBytes: number): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: `bytes=0-${headBytes - 1}` }),
      );
      const total = Number(res.ContentRange?.split('/')[1] ?? res.ContentLength ?? 0);
      return { size: total, head: await firstBytes(res.Body as AsyncIterable<Uint8Array>, headBytes) };
    } catch (err) {
      if ((err as { name?: string }).name === 'NoSuchKey') return null;
      throw err;
    }
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
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

  async inspect(key: string, headBytes: number): Promise<ObjectInfo | null> {
    const o = this.objects.get(key);
    return o ? { size: o.body.length, head: o.body.subarray(0, headBytes) } : null;
  }

  async remove(key: string): Promise<void> {
    this.objects.delete(key);
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

  async inspect(key: string, headBytes: number): Promise<ObjectInfo | null> {
    const res = await get(key, { access: 'private', useCache: false });
    if (!res || res.statusCode !== 200) return null;
    return { size: res.blob.size, head: await firstBytes(res.stream, headBytes) };
  }

  async remove(key: string): Promise<void> {
    await del(key);
  }

  /** Browser uploads go straight to the private store with a short-lived presigned PUT scoped to one pathname. */
  directUpload = (body: unknown, request: IncomingMessage, policy: DirectUploadPolicy) => {
    // Only the presign handshake is served. We never ask Blob for completion callbacks (the client calls
    // /confirm instead), so an 'upload-completed' event here would be forged.
    if ((body as { type?: unknown } | null)?.type !== 'blob.generate-presigned-url') {
      throw new ValidationError(undefined, 'Unsupported upload event');
    }
    return handleUploadPresigned({
      body: body as HandleUploadPresignedBody,
      request,
      // Required by the SDK, used only to verify completion callbacks, which this route refuses above.
      webhookPublicKey: 'unused-no-callbacks',
      getSignedToken: async (pathname) => {
        policy.authorize(pathname);
        const validUntil = Date.now() + policy.ttlSeconds * 1000;
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          validUntil,
          allowedContentTypes: policy.contentTypes,
          maximumSizeInBytes: policy.maxBytes,
        });
        return {
          token,
          urlOptions: {
            validUntil,
            allowedContentTypes: policy.contentTypes,
            maximumSizeInBytes: policy.maxBytes,
            addRandomSuffix: false,
            allowOverwrite: false,
          },
        };
      },
    });
  };
}

export function createStorage(env: Env): ObjectStorage & { ensureBucket?: () => Promise<void> } {
  return env.STORAGE_DRIVER === 'blob' ? new BlobStorage() : new S3Storage(env);
}
