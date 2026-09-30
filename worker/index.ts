import { handler } from '../server/api';
import { withCloudflareBindings, type CloudflareBindings } from '../server/config';
import { withRequestDatabase } from '../server/store';

export interface Env extends CloudflareBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const response = await withCloudflareBindings(env, () =>
      withRequestDatabase(() => handler(request)),
    );
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    return response;
  },
};
