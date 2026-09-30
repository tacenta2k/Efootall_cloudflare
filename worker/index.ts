import { handler } from '../server/api';
import { withCloudflareBindings, type CloudflareBindings } from '../server/config';
import { withRequestDatabase } from '../server/store';

export interface Env extends CloudflareBindings {
  ASSETS: { fetch(request: Request): Promise<Response> };
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx?: { waitUntil(task: Promise<unknown>): void },
  ): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const defer = ctx
      ? (task: () => Promise<void>) => {
          // Deferred maintenance owns a separate client and closes it inside
          // waitUntil; response cleanup must not close its in-flight connection.
          ctx.waitUntil(
            withCloudflareBindings(env, () => withRequestDatabase(task)).catch(() => {
              console.warn('Team logo cleanup deferred; retry on next authenticated action.');
            }),
          );
        }
      : undefined;
    const response = await withCloudflareBindings(env, () =>
      withRequestDatabase(() => handler(request, defer)),
    );
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.headers.set('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    return response;
  },
};
