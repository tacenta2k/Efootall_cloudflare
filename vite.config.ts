import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { checkAuthEndpoint, supabaseConfig } from './src/lib/supabaseConfig';
export default defineConfig(async ({ command, mode }) => {
  if (command === 'build') {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    if (Object.keys(env).some((name) => /DATABASE|SERVICE_ROLE|SECRET/i.test(name)))
      throw new Error(
        'Private credentials must never use the VITE_ prefix. Remove them from browser build variables.',
      );
    const config = supabaseConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY);
    if (config.error) throw new Error(config.error);
    // Hosted builds must also catch well-formed but nonexistent project URLs.
    if (process.env.NETLIFY === 'true') await checkAuthEndpoint(config);
  }
  return {
    plugins: [react()],
    server: { port: 5173 },
    build: { target: 'es2022' },
  };
});
