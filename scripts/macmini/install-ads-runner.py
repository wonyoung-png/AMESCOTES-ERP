"""Stage the reviewed runner using RSA-OAEP ciphertext. No token in argv/output/plist."""
import argparse
import json
import os
import pathlib
import plistlib
import stat
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--launch', action='store_true')
args = parser.parse_args()
os.umask(0o077)
home = pathlib.Path.home()
private = home / '.config' / 'ames-ads'
runtime = home / '.local' / 'share' / 'ames-ads'
plist = home / 'Library' / 'LaunchAgents' / 'kr.atlm.ads-runner.plist'

def private_path(p):
    info = p.lstat()
    if stat.S_ISLNK(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError('invalid_private_path')

try:
    private_path(private)
    if args.launch:
        private_path(private / 'runner.json')
        private_path(plist)
        subprocess.run(['launchctl', 'bootstrap', f'gui/{os.getuid()}', str(plist)], check=True, capture_output=True)
        print('RUNNER_REGISTERED=true')
    else:
        if plist.exists() or plist.is_symlink():
            raise RuntimeError('refuse_existing_launch_agent')
        source = pathlib.Path(__file__).resolve().parent
        key = private / 'pair-20261012.key'
        cipher = private / 'pair-20261012.enc'
        private_path(key)
        private_path(cipher)
        token = subprocess.run(['openssl', 'pkeyutl', '-decrypt', '-inkey', str(key), '-in', str(cipher),
                                '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256',
                                '-pkeyopt', 'rsa_mgf1_md:sha256'], check=True, capture_output=True).stdout.decode('ascii')
        if not 32 <= len(token) <= 128 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-' for c in token):
            raise RuntimeError('invalid_runner_token')
        config = private / 'runner.json'
        if config.exists():
            private_path(config)
            if json.loads(config.read_text())['token'] != token:
                raise RuntimeError('refuse_unrequested_token_rotation')
        else:
            with config.open('x') as out:
                json.dump({'token': token, 'apiUrl': 'https://erp.ameserp.kr', 'runnerId': 'macmini'}, out)
        runtime.mkdir(parents=True, exist_ok=True, mode=0o700)
        private_path(runtime)
        for name in ('ads-runner.sh', 'ads-runner-launch.mjs'):
            target = runtime / name
            if target.is_symlink():
                raise RuntimeError('invalid_runtime_path')
            # Git archives can retain CRLF from older tracked shell files.
            # POSIX sh -n accepts these but execution rejects `set -eu\r`.
            target.write_bytes((source / name).read_bytes().replace(b'\r\n', b'\n'))
            target.chmod(0o700)
        plist.parent.mkdir(parents=True, exist_ok=True)
        with plist.open('xb') as out:
            plistlib.dump({'Label': 'kr.atlm.ads-runner',
                          'ProgramArguments': ['/opt/homebrew/bin/node', str(runtime / 'ads-runner-launch.mjs')],
                          'EnvironmentVariables': {'PATH': f'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:{home}/.local/bin'},
                          'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 30, 'ProcessType': 'Background',
                          'StandardOutPath': '/dev/null', 'StandardErrorPath': '/dev/null'}, out)
        print('RUNNER_STAGED=true')
except Exception:
    print('RUNNER_SETUP_FAILED=true')
    raise SystemExit(1)
