import { z } from 'zod';

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    MONGO_URI: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_EXPIRES_IN_SECONDS: z.coerce.number().int().positive().default(86_400),
    COOKIE_SECURE: bool.default(false),
    S3_ENDPOINT: z.url().optional(),
    /** Endpoint the browser uses for presigned URLs, when it differs from the one the API uses. */
    S3_PUBLIC_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    /** `s3` for any S3-compatible store (SeaweedFS locally, R2/S3), `blob` for a private Vercel Blob store. */
    STORAGE_DRIVER: z.enum(['s3', 'blob']).default('s3'),
    S3_BUCKET: z.string().min(1).optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_FORCE_PATH_STYLE: bool.default(false),
    /** Create the bucket at boot if missing. Local Docker only. */
    S3_AUTO_CREATE_BUCKET: bool.default(false),
  })
  .refine((e) => e.STORAGE_DRIVER !== 's3' || (e.S3_BUCKET && e.S3_ACCESS_KEY_ID && e.S3_SECRET_ACCESS_KEY), {
    message: 'S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when STORAGE_DRIVER=s3',
  });

export type Env = z.infer<typeof EnvSchema>;

/** Parsed once at boot. A missing or malformed variable crashes the process before it serves traffic. */
export const env: Env = (() => {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
})();
