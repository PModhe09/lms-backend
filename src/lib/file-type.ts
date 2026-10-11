export type SlipMime = 'application/pdf' | 'image/jpeg' | 'image/png';

const SIGNATURES: { mime: SlipMime; ext: string; bytes: number[] }[] = [
  { mime: 'application/pdf', ext: 'pdf', bytes: [0x25, 0x50, 0x44, 0x46] }, // %PDF
  { mime: 'image/jpeg', ext: 'jpg', bytes: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: 'png', bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
];

/** Real type from the first bytes. The file name and the browser's Content-Type are not trusted. */
export function sniffSlipType(buffer: Buffer): { mime: SlipMime; ext: string } | null {
  const match = SIGNATURES.find((s) => s.bytes.every((b, i) => buffer[i] === b));
  return match ? { mime: match.mime, ext: match.ext } : null;
}
