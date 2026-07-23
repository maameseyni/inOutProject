"""Verifie CSRF dynamique : cookie frais vs jeton fige + presence du fix JS."""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.contrib.auth import get_user_model
from django.middleware.csrf import get_token, rotate_token
from django.test import Client, RequestFactory
from django.contrib.sessions.middleware import SessionMiddleware

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


def read_cookie_value(cookie_header: str, name: str) -> str:
    """Miroir de readCookieValue() dans django-bridge.js."""
    source = str(cookie_header or '')
    if not source or not name:
        return ''
    prefix = name + '='
    for part in source.split(';'):
        part = part.strip()
        if part.startswith(prefix):
            raw = part[len(prefix):]
            try:
                from urllib.parse import unquote
                return unquote(raw)
            except Exception:
                return raw
    return ''


print('=== 1. Source JS ===')
bridge = (ROOT / 'static' / 'js' / 'django-bridge.js').read_text(encoding='utf-8')
checks = {
    'fn_readCookieValue': 'function readCookieValue(',
    'fn_readCsrfToken': 'function readCsrfToken(',
    'cookie_csrftoken': "'csrftoken'",
    'retry_flag': 'apiFetchNetwork(path, options, true)',
    'looksLikeCsrfFailure': 'function looksLikeCsrfFailure(',
    'no_frozen_only': re.search(
        r"X-CSRFToken['\"]\s*:\s*cfg\.csrfToken\s*[,}]",
        bridge,
    ) is None,
}
for name, expected in checks.items():
    if name == 'no_frozen_only':
        if expected:
            ok(name)
        else:
            fail(name, 'encore X-CSRFToken: cfg.csrfToken en dur')
        continue
    if expected in bridge:
        ok(name)
    else:
        fail(name, 'motif absent')

print('=== 2. Parser cookie (miroir JS) ===')
sample = 'foo=1; csrftoken=abc%2Fdef; other=x'
got = read_cookie_value(sample, 'csrftoken')
if got == 'abc/def':
    ok('cookie_decode')
else:
    fail('cookie_decode', got)
if read_cookie_value('a=1', 'csrftoken') == '':
    ok('cookie_missing')
else:
    fail('cookie_missing', 'non vide')

print('=== 3. API : jeton fige vs cookie frais ===')
suffix = f'csrftest_{os.getpid()}'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org CSRF')
user = User.objects.create_user(
    username=f'u_{suffix}@example.com',
    email=f'u_{suffix}@example.com',
    password='TestPass123!',
)
MembreOrganisation.objects.create(utilisateur=user, organisation=org, role='proprietaire')

client = Client(HTTP_HOST='localhost', enforce_csrf_checks=True)
client.force_login(user)

# Charge /app/ → cookie + token template (simule le gel initial)
page = client.get('/app/')
if page.status_code != 200:
    fail('load_app', page.status_code)
else:
    ok('load_app')

frozen = client.cookies.get('csrftoken')
frozen_token = frozen.value if frozen else ''
if not frozen_token:
    fail('initial_cookie', 'pas de csrftoken')
else:
    ok('initial_cookie')

# Rotation CSRF (comme une autre navigation / middleware)
factory = RequestFactory()
req = factory.get('/app/')
req.user = user
SessionMiddleware(lambda r: None).process_request(req)
req.session.save()
# Reprendre la session du client de test
req.session = client.session
old_token = frozen_token
rotate_token(req)
req.session.save()
client.cookies['sessionid'] = client.session.session_key
# Django stocke le nouveau secret dans la session ; le cookie client doit suivre.
# get_token met à jour le cookie sur la réponse — on simule le cookie à jour :
new_token = get_token(req)
client.cookies['csrftoken'] = new_token

if new_token == old_token:
    fail('rotate_changed', 'token non change')
else:
    ok('rotate_changed')

payload = {
    'title': 'CSRF dynamic',
    'content': '<p>ok</p>',
    'pinned': False,
    'archived': False,
}

# Ancien jeton (page figee) → 403
resp_stale = client.post(
    '/app/api/notes/',
    data=json.dumps(payload),
    content_type='application/json',
    HTTP_X_CSRFTOKEN=old_token,
)
if resp_stale.status_code == 403:
    ok('stale_token_403')
else:
    fail('stale_token_403', f'{resp_stale.status_code} {resp_stale.content[:200]!r}')

# Cookie frais (ce que readCsrfToken lit) → 201
resp_fresh = client.post(
    '/app/api/notes/',
    data=json.dumps(payload),
    content_type='application/json',
    HTTP_X_CSRFTOKEN=new_token,
)
if resp_fresh.status_code == 201:
    ok('fresh_cookie_201')
else:
    fail('fresh_cookie_201', f'{resp_fresh.status_code} {resp_fresh.content[:300]!r}')

# Lecture cookie header (comme le bridge)
header = f'sessionid=x; csrftoken={new_token}; path=/'
if read_cookie_value(header, 'csrftoken') == new_token:
    ok('bridge_would_read_fresh')
else:
    fail('bridge_would_read_fresh', read_cookie_value(header, 'csrftoken'))

print()
print(f'Result: {passed} passed, {len(errors)} failed')
for e in errors:
    print(' -', e.encode('ascii', 'replace').decode('ascii'))

User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()
sys.exit(1 if errors else 0)
