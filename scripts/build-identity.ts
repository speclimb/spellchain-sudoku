import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Source fingerprint also identifies uncommitted previews and source archives. */
export function buildIdentity(root: string, command: 'serve' | 'build') {
  const paths = ['src', 'public', 'scripts/build-identity.ts', 'index.html', 'package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json'];
  const hash = createHash('sha256');
  const visit = (path: string) => {
    const full = join(root, path);
    try {
      if (statSync(full).isDirectory()) for (const child of readdirSync(full).sort()) visit(join(path, child));
      else { hash.update(relative(root, full)); hash.update('\0'); hash.update(readFileSync(full)); }
    } catch { /* Optional public directory or lockfile may be absent. */ }
  };
  paths.forEach(visit);
  const fingerprint = hash.digest('hex').slice(0, 12);
  const version: string = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  let commit = 'source', clean = false;
  try {
    commit = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    clean = !execFileSync('git', ['status', '--porcelain', '--', ...paths], { cwd: root, encoding: 'utf8' }).trim();
  } catch { /* Source-only builds remain explicitly marked as previews. */ }
  const channel = command === 'serve' ? 'dev' : clean ? 'release' : 'preview';
  return { id: `${version}+${commit}.${fingerprint}.${channel}`, version, commit, fingerprint, channel,
    label: `v${version} · ${commit}${channel === 'dev' ? ' · 開発版' : channel === 'preview' ? ' · 確認版' : ''}` };
}
