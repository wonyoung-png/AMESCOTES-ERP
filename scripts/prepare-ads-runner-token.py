"""Create/reuse a host-only runner credential and export RSA-OAEP ciphertext only."""
import base64
import os
import pathlib
import re
import secrets
import shutil
import stat
import subprocess

os.umask(0o077)
app = pathlib.Path('/opt/app')
folder = app / 'backups' / 'ads-setup-20261012'
env = app / '.env'
try:
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.is_symlink() or folder.stat().st_mode & 0o077 or env.is_symlink():
        raise RuntimeError()
    public = folder / 'macmini.pub'
    text = env.read_text()
    matches = re.findall(r'^ADS_RUNNER_TOKEN=(.*)$', text, re.M)
    if len(matches) > 1:
        raise RuntimeError()
    token = matches[0].strip().strip('"\'') if matches else ''
    if token and not re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token):
        raise RuntimeError()
    had_token = bool(token)
    token = token or secrets.token_urlsafe(48)
    encrypted = subprocess.run(['openssl', 'pkeyutl', '-encrypt', '-pubin', '-inkey', str(public),
                                '-pkeyopt', 'rsa_padding_mode:oaep', '-pkeyopt', 'rsa_oaep_md:sha256',
                                '-pkeyopt', 'rsa_mgf1_md:sha256'], input=token.encode(), check=True, capture_output=True).stdout
    backup = folder / 'env-before-runner.private'
    if not backup.exists():
        shutil.copyfile(env, backup)
        backup.chmod(0o600)
    if not had_token:
        next_text = re.sub(r'^ADS_RUNNER_TOKEN=.*$', 'ADS_RUNNER_TOKEN=' + token, text, flags=re.M) if matches else text.rstrip() + '\nADS_RUNNER_TOKEN=' + token + '\n'
        temporary = folder / 'env-next.private'
        with temporary.open('w') as out:
            out.write(next_text)
        temporary.chmod(0o600)
        info = env.stat()
        os.chown(temporary, info.st_uid, info.st_gid)
        os.replace(temporary, env)
    print('RUNNER_TOKEN_PREPARED=true')
    print('ENCRYPTED_RUNNER_TOKEN=' + base64.b64encode(encrypted).decode())
except Exception:
    print('RUNNER_TOKEN_PREPARE_FAILED=true')
    raise SystemExit(1)
