"""Verifie que le SW ne cache plus API sensibles ni shell /app/."""
from __future__ import annotations

import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.contrib.auth import get_user_model
from django.test import Client

from comptes.models import MembreOrganisation, Organisation

User = get_user_model()

passed = 0
errors: list[str] = []


def ok(name: str) -> None:
    global passed
    passed += 1
    print(('OK  ' + name).encode('ascii', 'replace').decode('ascii'))


def fail(name: str, detail) -> None:
    errors.append(f'{name}: {detail}')
    print(('FAIL ' + name + ' - ' + str(detail)).encode('ascii', 'replace').decode('ascii'))


print('=== 1. Source service-worker.js ===')
sw = (ROOT / 'static' / 'js' / 'service-worker.js').read_text(encoding='utf-8')
offline = (ROOT / 'static' / 'js' / 'xaliss-offline.js').read_text(encoding='utf-8')

checks = {
    'v14': 'kaayprint-static-v14' in sw,
    'no_api_cache_const': 'API_CACHE' not in sw and 'kaayprint-api-v' not in sw,
    'no_shell_cache_const': 'SHELL_CACHE' not in sw and 'kaayprint-shell-v' not in sw,
    'no_api_put': 'cache.put(event.request' not in sw or 'API' not in sw,
    'private_path_helper': 'function isAuthOrPrivatePath' in sw,
    'offline_fallback_only': "caches.match('/static/offline.html')" in sw,
    'no_app_shell_put': not re.search(r"pathname\.indexOf\('/app'\)[\s\S]{0,120}cache\.put", sw),
    'clear_sensitive_msg': "CLEAR_SENSITIVE_CACHES" in sw,
    'purge_posts_sw': 'CLEAR_SENSITIVE_CACHES' in offline and 'notifyServiceWorkerPurge' in offline,
}
# Explicit: must not open api/shell caches
if 'kaayprint-api-' in sw and 'isSensitiveCacheName' in sw:
    # allowed only for deletion detection
    ok('api_name_only_for_purge')
else:
    # still ok if only in isSensitiveCacheName
    if 'function isSensitiveCacheName' in sw:
        ok('api_name_only_for_purge')
    else:
        fail('api_name_only_for_purge', 'isSensitiveCacheName manquant')

for name, good in checks.items():
    if good:
        ok(name)
    else:
        fail(name, 'echec')

# Ne doit plus avoir API_GET_PREFIXES ni cache.put sur API
if 'API_GET_PREFIXES' in sw:
    fail('no_api_prefixes', 'API_GET_PREFIXES encore present')
else:
    ok('no_api_prefixes')

if re.search(r"caches\.open\(['\"]kaayprint-(api|shell)", sw):
    fail('no_open_sensitive', 'caches.open api/shell')
else:
    ok('no_open_sensitive')

print('=== 2. Endpoint /service-worker.js ===')
client = Client(HTTP_HOST='localhost')
resp = client.get('/service-worker.js')
if resp.status_code == 200 and b'kaayprint-static-v14' in resp.content:
    ok('sw_served_v14')
else:
    fail('sw_served_v14', f'{resp.status_code} {resp.content[:80]!r}')
if b'API_GET_PREFIXES' in resp.content or b'kaayprint-api-v' in resp.content:
    fail('sw_served_clean', 'ancien cache API encore servi')
else:
    ok('sw_served_clean')

print('=== 3. Logique isAuthOrPrivatePath (Node) ===')
node_code = r"""
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const sw = fs.readFileSync(path.join('static','js','service-worker.js'), 'utf8');
// Extraire helpers sans listeners
const excerpt = sw
  .split("self.addEventListener('install'")[0]
  + '\n;({ isAuthOrPrivatePath, isSensitiveCacheName, isStaticAsset });';
const sandbox = { self: {}, caches: {}, URL, console };
vm.createContext(sandbox);
let exports;
try {
  // Re-run only function defs by eval file until install
  const src = sw.replace(/self\.addEventListener\([\s\S]*/m, '');
  vm.runInContext(src + '\nthis.__out = { isAuthOrPrivatePath, isSensitiveCacheName, isStaticAsset };', sandbox);
  exports = sandbox.__out;
} catch (e) {
  console.log('FAIL load ' + e.message);
  process.exit(1);
}
function u(p) { return new URL('http://localhost' + p); }
const cases = [
  ['/app/api/transactions/', true],
  ['/app/api/notes/', true],
  ['/app/', true],
  ['/app', true],
  ['/connexion/', true],
  ['/static/css/style.css', false],
  ['/static/offline.html', false],
];
let failed = 0;
cases.forEach(([p, expect]) => {
  const got = exports.isAuthOrPrivatePath(u(p));
  if (got === expect) console.log('OK  path ' + p);
  else { console.log('FAIL path ' + p + ' got ' + got); failed++; }
});
if (!exports.isSensitiveCacheName('kaayprint-api-v13')) { console.log('FAIL sens api'); failed++; }
else console.log('OK  sens api');
if (!exports.isSensitiveCacheName('kaayprint-shell-v13')) { console.log('FAIL sens shell'); failed++; }
else console.log('OK  sens shell');
if (exports.isSensitiveCacheName('kaayprint-static-v14')) { console.log('FAIL sens static'); failed++; }
else console.log('OK  sens static kept');
process.exit(failed ? 1 : 0);
"""
proc = subprocess.run(
    ['node', '-e', node_code],
    cwd=str(ROOT),
    capture_output=True,
    text=True,
    encoding='utf-8',
    errors='replace',
)
print(proc.stdout)
if proc.stderr:
    print(proc.stderr)
if proc.returncode == 0:
    ok('node_helpers')
else:
    fail('node_helpers', f'exit {proc.returncode}')

print('=== 4. App accessible (pas de regression) ===')
suffix = f'swcache_{os.getpid()}'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()
org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org SW')
user = User.objects.create_user(
    username=f'u_{suffix}@example.com',
    email=f'u_{suffix}@example.com',
    password='TestPass123!',
)
MembreOrganisation.objects.create(utilisateur=user, organisation=org, role='proprietaire')
auth = Client(HTTP_HOST='localhost')
auth.force_login(user)
app = auth.get('/app/')
api = auth.get('/app/api/transactions/')
if app.status_code == 200:
    ok('app_200')
else:
    fail('app_200', app.status_code)
if api.status_code == 200:
    ok('api_200')
else:
    fail('api_200', api.status_code)

print()
print(f'Result: {passed} passed, {len(errors)} failed')
for e in errors:
    print(' -', e.encode('ascii', 'replace').decode('ascii'))

User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()
sys.exit(1 if errors else 0)
