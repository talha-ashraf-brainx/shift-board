/** Image attachments: what we accept and how they are referenced from markdown. */

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export type ImageContentType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

export interface DetectedImage {
  contentType: ImageContentType;
  ext: 'png' | 'jpg' | 'gif' | 'webp';
  /** null when the header is truncated or unusual; dimensions are informational only. */
  width: number | null;
  height: number | null;
}

const ascii = (buf: Buffer, start: number, text: string): boolean =>
  buf.length >= start + text.length && buf.toString('latin1', start, start + text.length) === text;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Identifies an image by its magic bytes (the client's mime header is not trusted).
 * Returns null for anything that is not a PNG, JPEG, GIF or WebP.
 */
export function detectImage(buf: Buffer): DetectedImage | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    // IHDR is always the first chunk: width and height are big-endian at 16 and 20.
    const ok = buf.length >= 24 && ascii(buf, 12, 'IHDR');
    return {
      contentType: 'image/png',
      ext: 'png',
      width: ok ? buf.readUInt32BE(16) : null,
      height: ok ? buf.readUInt32BE(20) : null,
    };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { contentType: 'image/jpeg', ext: 'jpg', ...jpegSize(buf) };
  }
  if (ascii(buf, 0, 'GIF87a') || ascii(buf, 0, 'GIF89a')) {
    const ok = buf.length >= 10;
    return {
      contentType: 'image/gif',
      ext: 'gif',
      width: ok ? buf.readUInt16LE(6) : null,
      height: ok ? buf.readUInt16LE(8) : null,
    };
  }
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP')) {
    return { contentType: 'image/webp', ext: 'webp', ...webpSize(buf) };
  }
  return null;
}

const NO_SIZE = { width: null, height: null };

/** Walks the JPEG markers up to the first start-of-frame (SOF0..SOF15 except DHT/JPG/DAC). */
function jpegSize(buf: Buffer): { width: number | null; height: number | null } {
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) return NO_SIZE;
    const marker = buf[i + 1]!;
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // markers without a length
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    }
    i += 2 + len;
  }
  return NO_SIZE;
}

function webpSize(buf: Buffer): { width: number | null; height: number | null } {
  if (ascii(buf, 12, 'VP8X') && buf.length >= 30) {
    return { width: 1 + buf.readUIntLE(24, 3), height: 1 + buf.readUIntLE(27, 3) };
  }
  if (ascii(buf, 12, 'VP8 ') && buf.length >= 30) {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  if (ascii(buf, 12, 'VP8L') && buf.length >= 25) {
    const bits = buf.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  return NO_SIZE;
}

const ATTACHMENT_REF = /\/api\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/gi;

/**
 * Attachment ids referenced from markdown (`![name](/api/attachments/<id>)`, or the bare or
 * absolute URL), in order of first appearance, deduplicated and lower-cased.
 */
export function extractAttachmentIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(ATTACHMENT_REF)) ids.add(m[1]!.toLowerCase());
  return [...ids];
}

export const attachmentUrl = (id: string): string => `/api/attachments/${id}`;

/**
 * A safe display filename: no directories or control characters, at most 255 characters.
 * Busboy decodes multipart filenames as latin1, so UTF-8 names are re-decoded when that is lossless.
 */
export function cleanFilename(raw: string | undefined, ext: string): string {
  let name = raw ?? '';
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  if (!utf8.includes('�')) name = utf8;
  name = name
    .split(/[\\/]/)
    .pop()!
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!name) name = `image.${ext}`;
  return name.slice(0, 255);
}
