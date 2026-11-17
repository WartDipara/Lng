import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

if (!existsSync('mobile/assets/registry.ts')) {
  console.error('Offline assets are missing. Run npm run prepare:mobile once, then npm run dev.');
  process.exit(1);
}
const child = spawn(
  process.execPath,
  [
    'node_modules/expo/bin/cli',
    'start',
    '--web',
    '--localhost',
    '--port',
    '8081',
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit', env: { ...process.env, EXPO_NO_TYPESCRIPT_SETUP: '1' } },
);
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 0;
});
