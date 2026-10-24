import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24.x for this project.');
if (process.env.NODE_ENV === 'production') throw new Error('Demo mode is local only; unset NODE_ENV=production.');
const commands = [
  { cwd: root, entry: 'platform/api/node_modules/tsx/dist/cli.mjs', args: ['demo/api.ts'] },
  { cwd: root, entry: 'node_modules/vite/bin/vite.js', args: ['--host', '127.0.0.1', '--port', '8112', '--strictPort'] },
  { cwd: path.join(root, 'admin-app'), entry: 'node_modules/vite/bin/vite.js', args: ['--host', '127.0.0.1', '--port', '4174', '--strictPort'] },
];
for (const cmd of commands) {
  try { await access(path.join(cmd.cwd, cmd.entry)); }
  catch { throw new Error('Install first: npm ci && npm ci --prefix platform/api && npm ci --prefix admin-app'); }
}
const apiPort = process.env.GRID_ATLAS_DEMO_API_PORT || '8788';
if (!/^\d{4,5}$/.test(apiPort) || Number(apiPort) > 65535) throw new Error('Invalid GRID_ATLAS_DEMO_API_PORT');
const env = { ...process.env, VITE_SYNTHETIC_DEMO: 'true', LOCAL_QA_API_TARGET: `http://127.0.0.1:${apiPort}`, VITE_DEV_API_PROXY: `http://127.0.0.1:${apiPort}` };
const children = commands.map(cmd => spawn(process.execPath, [path.join(cmd.cwd, cmd.entry), ...cmd.args], { cwd: cmd.cwd, env, stdio: 'inherit' }));
let stopping = false;
function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => { for (const child of children) child.kill('SIGKILL'); process.exit(code); }, 2000).unref();
  Promise.all(children.map(child => child.exitCode !== null ? Promise.resolve() : new Promise(resolve => child.once('exit', resolve)))).then(() => process.exit(code));
}
for (const child of children) {
  child.on('error', error => { console.error(error.message); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 1); });
}
process.once('SIGINT', () => stop(0)); process.once('SIGTERM', () => stop(0));
console.log('Frontend: http://127.0.0.1:8112/#/index?view=desktop');
console.log('Mobile:   http://127.0.0.1:8112/#/mobile');
console.log('Admin:    http://127.0.0.1:4174/');
