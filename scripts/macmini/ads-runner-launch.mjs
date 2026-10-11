// Persistent private configuration; never source shell text or put credentials in argv/plist.
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstat, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

try {
  if (process.argv.slice(2).some(arg => arg !== '--once')) throw Error();
  const path = join(homedir(), '.config', 'ames-ads', 'runner.json');
  for (const target of [dirname(path), path]) {
    const info = await lstat(target);
    if (info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077)) throw Error();
  }
  const config = JSON.parse(await readFile(path, 'utf8'));
  if (config.apiUrl !== 'https://erp.ameserp.kr' || config.runnerId !== 'macmini' ||
      typeof config.token !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(config.token)) throw Error();
  const env = Object.fromEntries(['PATH', 'HOME', 'USER', 'LOGNAME', 'TMPDIR'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  Object.assign(env, { ADS_API_URL: config.apiUrl, ADS_RUNNER_ID: config.runnerId, ADS_RUNNER_TOKEN: config.token });
  const child = spawn('/bin/sh', [join(dirname(fileURLToPath(import.meta.url)), 'ads-runner.sh'), ...process.argv.slice(2)], { env, stdio: 'inherit' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('ads-launch: runner unavailable'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch {
  console.error('ads-launch: private configuration unavailable');
  process.exitCode = 1;
}
