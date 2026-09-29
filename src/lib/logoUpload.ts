import { auth, request } from './api';
import { LOGO_BUCKET, logoPath } from './logos';
export async function uploadLogo(blob: Blob): Promise<string> {
  if (!auth) throw new Error('Sign in before uploading a team logo.');
  const { path } = await request<{ path: string }>('logos', 'POST', {
    extension: blob.type === 'image/webp' ? 'webp' : 'png',
  });
  const { error } = await auth.storage
    .from(LOGO_BUCKET)
    .upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '3600' });
  if (error) {
    void discardLogo('logo:' + path);
    throw new Error('Logo upload failed. Check your connection and try again.');
  }
  return 'logo:' + path;
}
export async function discardLogo(value: string) {
  const path = logoPath(value);
  if (path) await request('logos', 'DELETE', { path }).catch(() => undefined);
}
