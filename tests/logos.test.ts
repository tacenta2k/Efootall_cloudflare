import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  emojiCategories,
  emojis,
  logoPath,
  MAX_LOGO_INPUT,
  MAX_LOGO_OUTPUT,
  optimizeLogo,
  squareCrop,
  validateLogoFile,
} from '../src/lib/logos';
import { playerSchema } from '../src/lib/validation';
const id = '12345678-1234-4234-8234-123456789abc';
afterEach(() => vi.unstubAllGlobals());
it('preserves every original emoji and validates categorized and custom emojis', () => {
  const all = Object.values(emojiCategories).flat();
  expect(all.length).toBeGreaterThan(80);
  for (const avatar of [...emojis, ...all, '🏳️‍🌈']) {
    expect(playerSchema.safeParse({ id, name: 'Team', avatar }).success).toBe(true);
  }
  expect(emojis.every((emoji) => all.includes(emoji))).toBe(true);
});
it('accepts compact logo references but rejects arbitrary URLs and inline image data', () => {
  const reference = `logo:${id}/${id}.webp`;
  expect(logoPath(reference)).toBe(`${id}/${id}.webp`);
  expect(playerSchema.safeParse({ id, name: 'Team', avatar: reference }).success).toBe(true);
  for (const avatar of [
    'logo:bad',
    'https://evil.test/image.png',
    'data:image/png;base64,12345678',
    `logo:${id}/../image.svg`,
  ]) {
    expect(playerSchema.safeParse({ id, name: 'Team', avatar }).success).toBe(false);
  }
});
it('allows only supported input types and enforces the input size limit', () => {
  for (const type of ['image/jpeg', 'image/png', 'image/webp'])
    expect(() => validateLogoFile({ type, size: 100 })).not.toThrow();
  for (const type of ['image/svg+xml', 'image/gif', 'application/pdf', 'text/html', ''])
    expect(() => validateLogoFile({ type, size: 100 })).toThrow('JPG, PNG, or WebP');
  for (const size of [0, MAX_LOGO_INPUT + 1])
    expect(() => validateLogoFile({ type: 'image/png', size })).toThrow('10 MB');
});
it('center crops without distortion and never upscales a small image', () => {
  expect(squareCrop(1600, 800)).toEqual({ x: 400, y: 0, side: 800, size: 256 });
  expect(squareCrop(800, 1600)).toEqual({ x: 0, y: 400, side: 800, size: 256 });
  expect(squareCrop(64, 64)).toEqual({ x: 0, y: 0, side: 64, size: 64 });
});
describe('optimization', () => {
  function setup(output: Blob | null = new Blob(['image'], { type: 'image/webp' })) {
    const bitmap = { width: 1600, height: 800, close: vi.fn() };
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toBlob: vi.fn((done: (blob: Blob | null) => void) => done(output)),
    };
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
    vi.stubGlobal('document', { createElement: () => canvas });
    return { bitmap, drawImage, canvas };
  }
  const file = new File(['image'], 'logo.png', { type: 'image/png' });
  it('renders the centered square, compresses it and releases the source bitmap', async () => {
    const { bitmap, drawImage, canvas } = setup();
    expect((await optimizeLogo(file)).type).toBe('image/webp');
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(256);
    expect(drawImage).toHaveBeenCalledWith(bitmap, 400, 0, 800, 800, 0, 0, 256, 256);
    expect(canvas.toBlob).toHaveBeenCalledWith(expect.any(Function), 'image/webp', 0.82);
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
  it('accepts a PNG fallback from browsers without WebP encoding', async () => {
    setup(new Blob(['image'], { type: 'image/png' }));
    expect((await optimizeLogo(file)).type).toBe('image/png');
  });
  it.each([null, new Blob([new Uint8Array(MAX_LOGO_OUTPUT + 1)], { type: 'image/png' })])(
    'rejects failed or oversized output',
    async (output) => {
      const { bitmap } = setup(output);
      await expect(optimizeLogo(file)).rejects.toThrow('Unable to optimize');
      expect(bitmap.close).toHaveBeenCalledOnce();
    },
  );
  it('rejects corrupt images and oversized dimensions', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockRejectedValue(new Error('Invalid image')));
    await expect(optimizeLogo(file)).rejects.toThrow('could not be opened');
    const { bitmap } = setup();
    bitmap.width = bitmap.height = 10000;
    await expect(optimizeLogo(file)).rejects.toThrow('50 megapixels');
    expect(bitmap.close).toHaveBeenCalledOnce();
  });
});
