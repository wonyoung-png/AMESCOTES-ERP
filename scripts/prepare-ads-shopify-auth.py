"""Reuse the installed Shopify app's server credentials; never export secret values."""
import json
import os
import pathlib
import re
import shutil
import subprocess

os.umask(0o077)
try:
    app = pathlib.Path('/opt/app')
    folder = app / 'backups' / 'ads-commerce-20261012'
    folder.mkdir(mode=0o700, exist_ok=True)
    if folder.is_symlink() or folder.stat().st_mode & 0o077:
        raise RuntimeError()
    rows = json.loads(subprocess.run(['docker', 'inspect', '--format', '{{json .Config.Env}}', 'app-daily-1'],
                                    check=True, capture_output=True, text=True).stdout)
    current = dict(line.split('=', 1) for line in rows)
    shop = current.get('SHOPIFY_SHOP', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9-]*', shop):
        raise RuntimeError()
    values = {'SHOPIFY_SHOP_DOMAIN': shop + '.myshopify.com', 'SHOPIFY_CLIENT_ID': current.get('SHOPIFY_CLIENT_ID', ''),
              'SHOPIFY_CLIENT_SECRET': current.get('SHOPIFY_CLIENT_SECRET', ''), 'SHOPIFY_API_VERSION': '2026-10',
              'ADS_COMMERCE_AUTH_ENABLED': 'true', 'PRODUCT_REGISTRATION_WRITES_ENABLED': 'false',
              'PRODUCT_REGISTRATION_OAUTH_REFRESH_ENABLED': 'false'}
    for key in ['SHOPIFY_CLIENT_ID', 'SHOPIFY_CLIENT_SECRET']:
        if not re.fullmatch(r'[A-Za-z0-9_-]{16,256}', values[key]):
            raise RuntimeError()
    env = app / '.env'
    if env.is_symlink():
        raise RuntimeError()
    text = env.read_text()
    for key in ['SHOPIFY_ADMIN_TOKEN', 'SHOPIFY_ACCESS_TOKEN']:
        old_token = re.findall(r'^' + key + r'=(.*)$', text, re.M)
        if len(old_token) > 1 or (old_token and old_token[0].strip().strip('"\'')):
            raise RuntimeError()
    for key, value in values.items():
        previous = re.findall(r'^' + key + r'=(.*)$', text, re.M)
        if len(previous) > 1 or (previous and previous[0].strip().strip('"\'') not in ['', value]):
            raise RuntimeError()
        line = key + '=' + value
        text = re.sub(r'^' + key + r'=.*$', lambda _: line, text, flags=re.M) if previous else text.rstrip() + '\n' + line + '\n'
    backup = folder / 'env-before-shopify.private'
    if not backup.exists():
        shutil.copyfile(env, backup)
        backup.chmod(0o600)
    temporary = folder / 'env-shopify-next.private'
    temporary.write_text(text)
    temporary.chmod(0o600)
    info = env.stat()
    os.chown(temporary, info.st_uid, info.st_gid)
    os.replace(temporary, env)
    print('SHOPIFY_EXISTING_APP_AUTH_STAGED=true')
    print('STATIC_TOKEN_PRESENT=false')
    print('MERCHANT_WRITES_ENABLED=false')
except Exception:
    print('SHOPIFY_AUTH_STAGE_FAILED=true')
    raise SystemExit(1)
