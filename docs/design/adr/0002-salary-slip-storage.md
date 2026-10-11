# ADR 0002 — Salary slip storage: API uploads to object storage

Status: Accepted · 2026-10-10 (revised same day: switched from option 4 to option 3 for simplicity)

## Context
Borrowers upload one PDF/JPG/PNG up to 5 MB. Sanction execs view it. Files must be private.
The API must stay stateless, so files cannot live on the API server's disk.

## Options
1. **Multer to API local disk.** Simplest. Breaks with more than one API instance (file is on one box),
   and Render/Railway disks are wiped on redeploy.
2. **Store in MongoDB (GridFS or Buffer field).** Survives redeploys. Bloats the DB and backups,
   and every download streams through the API.
3. **API receives the file in memory and uploads it to object storage (chosen).** One endpoint, one request.
4. **Presigned POST: browser uploads directly to object storage.** Bytes never touch the API.
   Needs two endpoints (presign + confirm), bucket CORS, a signed policy, a confirm step that reads the
   object back for magic bytes, and cleanup of uploads that are never confirmed.

## Decision
Option 3, with an S3-compatible API everywhere: SeaweedFS in Docker, R2 or S3 live.
- `POST /api/borrower/salary-slip`, `multipart/form-data`.
- Multer `memoryStorage()` with `limits: { fileSize: 5 * 1024 * 1024, files: 1 }`. Over the limit → 422.
- Real type from magic bytes (`%PDF`, `FF D8 FF`, `89 50 4E 47`), not the extension or browser `Content-Type`.
- `PutObject` to key `salary-slips/{userId}/{uuid}.{ext}`, private bucket. Save `{key, mime, size, uploadedAt}` on the user.
- Viewing: API returns a presigned GET valid 5 minutes, only after RBAC + ownership checks.
- Code depends on a `FileStorage` interface (Adapter pattern), one `S3FileStorage` implementation.

## Why 3 over 4
At this scale (one 5 MB file per borrower) the cost of 4 buys nothing we need. Option 3 keeps the API stateless,
which was the real goal. Moving to 4 later only changes the upload endpoint and the `ObjectStorage` adapter.
The rest of the system (loan snapshot, view URLs, RBAC) stays the same.

## Risks and how we check them
- **Memory:** each upload holds up to 5 MB in RAM for one request. Fine for this load.
  At hundreds of concurrent uploads, switch to option 4.
- **Vercel proxy body limit:** uploads go through the Next.js `/api` rewrite (ADR 0001). Vercel Functions cap request
  bodies at 4.5 MB. Vercel's docs do not say whether the same cap applies to rewrites to an external origin.
  **Deploy check:** upload a 4.9 MB PDF through the live URL.
  If it gets 413, fall back in this order: (a) deploy the web container on Render next to the API instead of Vercel
  (no proxy limit), or (b) move to option 4 for this one endpoint.
  Local Docker has no such limit.

## Consequences
- One request, no orphan files, no bucket CORS setup.
- Local storage does not need to be reachable from the browser for uploads, only for viewing via presigned GET
  (exposed on `localhost:8333` in Docker).

## Amendment 2026-10-11: SeaweedFS instead of MinIO locally
MinIO stopped publishing free container images (`minio/minio` and `quay.io/minio/minio` no longer pull).
Local Docker now uses SeaweedFS (`chrislusf/seaweedfs`, Apache-2.0) with its S3 gateway.
The API code is unchanged: it talks to any S3-compatible endpoint through `@aws-sdk/client-s3`.

## Amendment 2026-10-11: live storage and the deploy check
- **Live storage is a private Vercel Blob store** (`STORAGE_DRIVER=blob`), behind the same `ObjectStorage` port as
  S3/SeaweedFS. Staff still get 5-minute presigned GET URLs; an unsigned URL returns 403 (verified live).
- **Deploy check result:** a 4.4 MB upload through the live rewrite got **413**: Vercel caps function request bodies
  at 4.5 MB, and multipart overhead takes the usable file size to about 4.3 MB. The spec allows 5 MB, so the fallback
  in "Risks" was taken: **option 4 for the live store only.** The browser asks `POST /borrower/salary-slip/presign`
  for a 5-minute presigned PUT scoped to one UUID-named path in its own folder, with the 5 MB cap and PDF/JPG/PNG
  types enforced by the storage service; then `POST /borrower/salary-slip/confirm` makes the API read the stored
  object's size and magic bytes, delete it if it fails, and record it if it passes. `upload-options` tells the client
  which path to use, so local Docker and S3 keep option 3 unchanged.
- Verified live: 4.9 MB uploads and can be viewed by staff; 5 MB + 10 bytes is refused by storage even with a valid
  URL; a renamed executable is deleted on confirm; other users' folders and non-UUID names are refused.
