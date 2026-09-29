export const LOGO_BUCKET = 'team-logos';
export const logoPattern = /^logo:([0-9a-f-]{36}\/([0-9a-f-]{36})\.(?:webp|png))$/;
export const logoPath = (value: string) => logoPattern.exec(value)?.[1] ?? null;
export const MAX_LOGO_INPUT = 10 * 1024 * 1024;
export const MAX_LOGO_OUTPUT = 128 * 1024;
export const emojiCategories = {
  'Football / Sports': ['⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🏉', '🏏', '🏒', '🏓', '🥊', '🏎️'],
  Animals: [
    '🐐',
    '🦁',
    '🐺',
    '🦅',
    '🐉',
    '🐯',
    '🐻',
    '🦊',
    '🦈',
    '🐍',
    '🦍',
    '🐘',
    '🦏',
    '🐆',
    '🦉',
    '🐎',
  ],
  'Fire / Power': ['🔥', '⚡', '💥', '🌋', '☄️', '🌪️', '💪', '🚀', '🧨', '🌊', '❄️', '☀️'],
  'Royal / Champions': ['👑', '🏆', '🥇', '🏅', '🎖️', '💎', '⚜️', '🛡️'],
  Objects: ['🎮', '🎯', '⚔️', '🗡️', '🔱', '⚓', '🔨', '🧲', '🛸', '🚁', '🏰', '🎸'],
  Symbols: [
    '⭐',
    '🌟',
    '✨',
    '💫',
    '❤️',
    '💚',
    '💙',
    '🖤',
    '♠️',
    '♣️',
    '♦️',
    '♟️',
    '🔴',
    '🔵',
    '🟢',
    '🟡',
  ],
  Faces: ['😎', '😈', '🤖', '👽', '👻', '💀', '🥷', '🤠', '🤩', '😤', '🥶', '🤯'],
  Other: ['🌍', '🌙', '🪐', '🌈', '🍀', '🌵', '🌴', '🍄', '🎃', '🎩', '🧿', '🎲'],
};
// Preserve the original order for default avatars.
export const emojis = ['⚽', '🔥', '⚡', '👑', '🐐', '🦁', '🎮', '🚀', '🐺', '💎', '🦅', '🐉'];
export function validateLogoFile(file: Pick<File, 'type' | 'size'>) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Choose a JPG, PNG, or WebP image.');
  if (!file.size || file.size > MAX_LOGO_INPUT)
    throw new Error('Choose an image smaller than 10 MB.');
}
export function squareCrop(width: number, height: number) {
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side, size: Math.min(256, side) };
}
export async function optimizeLogo(file: File): Promise<Blob> {
  validateLogoFile(file);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('This image could not be opened. Try another JPG, PNG, or WebP.');
  }
  try {
    if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 50_000_000)
      throw new Error('This image is too large to process. Choose an image under 50 megapixels.');
    const crop = squareCrop(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = crop.size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image processing is unavailable in this browser.');
    ctx.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, crop.size, crop.size);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', 0.82),
    );
    if (!blob || !['image/webp', 'image/png'].includes(blob.type) || blob.size > MAX_LOGO_OUTPUT)
      throw new Error('Unable to optimize this image. Please choose a simpler or smaller image.');
    return blob;
  } finally {
    bitmap.close();
  }
}
