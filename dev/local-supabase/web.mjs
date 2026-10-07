// Runs the Expo web app in cloud mode against the local harness (start.sh must be running).
//   node dev/local-supabase/web.mjs            # http://localhost:8082
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = Object.fromEntries(
  readFileSync(join(here, '.data/env'), 'utf8')
    .split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
);
const port = process.env.PORT ?? '8082';
const child = spawn('npx', ['expo', 'start', '--web', '--port', port], {
  cwd: join(here, '../../app'),
  stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: env.NUDGE_API_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY: env.NUDGE_ANON_KEY },
});
child.on('exit', (code) => process.exit(code ?? 0));
