import { cleanFilename, detectImage, extractAttachmentIds } from './image-files';

/** Minimal headers for each supported format (enough for detection and dimensions). */
function pngHeader(width = 640, height = 480): Buffer {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

function jpegHeader(width: number, height: number): Buffer {
  const app0 = [0xff, 0xe0, 0x00, 0x10, ...Buffer.from('JFIF\0'), 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof0 = [0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, ...Array(9).fill(0)];
  return Buffer.from([0xff, 0xd8, ...app0, ...sof0]);
}

function webpHeader(chunk: 'VP8X' | 'VP8L', width: number, height: number): Buffer {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1');
  b.writeUInt32LE(22, 4);
  b.write('WEBP', 8, 'latin1');
  b.write(chunk, 12, 'latin1');
  if (chunk === 'VP8X') {
    b.writeUIntLE(width - 1, 24, 3);
    b.writeUIntLE(height - 1, 27, 3);
  } else {
    b[20] = 0x2f;
    b.writeUInt32LE((width - 1) | ((height - 1) << 14), 21);
  }
  return b;
}

describe('detectImage', () => {
  it('recognises PNG, JPEG, GIF and WebP by magic bytes and reads their size', () => {
    expect(detectImage(pngHeader(640, 480))).toEqual({ contentType: 'image/png', ext: 'png', width: 640, height: 480 });
    expect(detectImage(jpegHeader(1024, 768))).toEqual({
      contentType: 'image/jpeg',
      ext: 'jpg',
      width: 1024,
      height: 768,
    });
    const gif = Buffer.from('GIF89a\x20\x00\x10\x00rest', 'latin1');
    expect(detectImage(gif)).toEqual({ contentType: 'image/gif', ext: 'gif', width: 32, height: 16 });
    expect(detectImage(webpHeader('VP8X', 300, 200))).toMatchObject({ contentType: 'image/webp', width: 300, height: 200 });
    expect(detectImage(webpHeader('VP8L', 50, 70))).toMatchObject({ contentType: 'image/webp', width: 50, height: 70 });
  });

  it('rejects anything else, whatever it claims to be', () => {
    expect(detectImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(detectImage(Buffer.from('%PDF-1.7'))).toBeNull();
    expect(detectImage(Buffer.from('RIFF....WAVE'))).toBeNull();
    expect(detectImage(Buffer.from([0x89, 0x50, 0x4e]))).toBeNull();
    expect(detectImage(Buffer.alloc(0))).toBeNull();
  });

  it('accepts a truncated header without dimensions', () => {
    expect(detectImage(pngHeader().subarray(0, 8))).toEqual({
      contentType: 'image/png',
      ext: 'png',
      width: null,
      height: null,
    });
    expect(detectImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toMatchObject({ contentType: 'image/jpeg', width: null });
  });
});

describe('extractAttachmentIds', () => {
  const a = '0f8fad5b-d9cb-469f-a165-70867728950e';
  const b = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

  it('finds markdown image references in order, deduplicated', () => {
    const md = `Bug:\n![screen shot.png](/api/attachments/${a})\nand ![b](http://localhost:5173/api/attachments/${b.toUpperCase()}) [link](/api/attachments/${a})`;
    expect(extractAttachmentIds(md)).toEqual([a, b]);
  });

  it('ignores other urls and malformed ids', () => {
    expect(extractAttachmentIds('![x](/api/attachments/not-a-uuid) ![y](/api/tickets/' + a + ')')).toEqual([]);
    expect(extractAttachmentIds('')).toEqual([]);
  });
});

describe('cleanFilename', () => {
  it('strips directories and control characters, re-decodes UTF-8 and falls back to image.<ext>', () => {
    expect(cleanFilename('C:\\Users\\me\\shot.png', 'png')).toBe('shot.png');
    expect(cleanFilename('../../etc/a\u0000b.png', 'png')).toBe('ab.png');
    expect(cleanFilename(Buffer.from('größe.png', 'utf8').toString('latin1'), 'png')).toBe('größe.png');
    expect(cleanFilename('   ', 'gif')).toBe('image.gif');
    expect(cleanFilename(undefined, 'jpg')).toBe('image.jpg');
  });
});
