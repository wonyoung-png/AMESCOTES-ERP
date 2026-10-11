"""Host-only config preparation. Does not start a runner or print credentials."""
import json
import os
import pathlib
import re
import subprocess

os.umask(0o077)
base = pathlib.Path('/opt/app/ads-runner')
assert base.resolve() == base and not base.is_symlink()
private = base / 'private'
for folder in [private, private / 'config', private / 'codex']:
    folder.mkdir(mode=0o700, exist_ok=True)
    assert not folder.is_symlink()
    folder.chmod(0o700)
    os.chown(folder, 1000, 1000)
raw = subprocess.run(['docker', 'inspect', '--format', '{{json .Config.Env}}', 'app-app-1'],
                     capture_output=True, text=True, check=True).stdout
env = dict(line.split('=', 1) for line in json.loads(raw))
assert env.get('ADS_ANALYSIS_ENABLED') != 'true', 'Pause analysis before runner cutover'
token = env.get('ADS_RUNNER_TOKEN', '')
assert re.fullmatch(r'[A-Za-z0-9_-]{32,128}', token)
target = private / 'config' / 'runner.json'
assert not target.exists() and not target.is_symlink(), 'Existing runner config must be preserved'
# The deployed API uses this legacy logical ID for heartbeat; physical host is now AWS.
with target.open('x') as out:
    json.dump({'apiUrl': 'https://erp.ameserp.kr', 'runnerId': 'macmini', 'token': token}, out)
target.chmod(0o600)
os.chown(target, 1000, 1000)
print('AWS_RUNNER_CONFIG_PREPARED=true')
print('ANALYSIS_ENABLED=false')
print('CREDENTIAL_VALUES_PRINTED=false')
