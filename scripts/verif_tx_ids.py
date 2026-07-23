"""Verifie H5 : IDs transaction non previsibles + rejet ids non namespaces."""
from __future__ import annotations

import os
import re
import sys
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.contrib.auth import get_user_model
from django.test import Client
from django.utils import timezone

from comptes.models import MembreOrganisation, Organisation
from finances.models import Transaction
from finances.services import transactions as tx_service
from finances.services.transactions import (
    _CLIENT_TX_ID_RE,
    generate_transaction_id,
    resolve_new_transaction_id,
)

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


print('=== 1. Generateur / resolve ===')
ids = {generate_transaction_id() for _ in range(50)}
if len(ids) == 50:
    ok('unique_50')
else:
    fail('unique_50', len(ids))

sample = next(iter(ids))
if sample.startswith('tx_') and _CLIENT_TX_ID_RE.fullmatch(sample):
    ok('format_tx')
else:
    fail('format_tx', sample)

# Timestamp nu ignore
ts = str(int(timezone.now().timestamp() * 1000))
resolved = resolve_new_transaction_id(ts)
if resolved != ts and resolved.startswith('tx_'):
    ok('ignore_timestamp')
else:
    fail('ignore_timestamp', resolved)

# offline_ legacy ignore
resolved2 = resolve_new_transaction_id('offline_1234567890')
if resolved2.startswith('tx_') and resolved2 != 'offline_1234567890':
    ok('ignore_offline_prefix')
else:
    fail('ignore_offline_prefix', resolved2)

# namespaced accepte
good = 'tx_abcdef0123456789_a1b2c3d4'
if resolve_new_transaction_id(good) == good:
    ok('accept_namespaced')
else:
    fail('accept_namespaced', resolve_new_transaction_id(good))

# injection refusee
evil = "tx_');alert(1);//"
if resolve_new_transaction_id(evil) != evil:
    ok('reject_evil')
else:
    fail('reject_evil', 'accepte')

print('=== 2. create_transaction service ===')
suffix = f'h5_{os.getpid()}'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org H5')
user = User.objects.create_user(
    username=f'u_{suffix}@example.com',
    email=f'u_{suffix}@example.com',
    password='TestPass123!',
)
membre = MembreOrganisation.objects.create(
    utilisateur=user, organisation=org, role='proprietaire',
)

base = {
    'type': 'income',
    'amount': 1000,
    'description': 'Test H5',
    'date': timezone.now().isoformat(),
    'payments': [{'amount': 1000, 'date': timezone.now().isoformat()}],
}

created = tx_service.create_transaction(org, user, membre, dict(base))
if str(created['id']).startswith('tx_') and not str(created['id']).isdigit():
    ok('create_auto_id')
else:
    fail('create_auto_id', created['id'])

# Client envoie Date.now() → serveur ignore
legacy = dict(base, id=str(int(timezone.now().timestamp() * 1000)))
created2 = tx_service.create_transaction(org, user, membre, legacy)
if str(created2['id']) != legacy['id'] and str(created2['id']).startswith('tx_'):
    ok('create_ignores_legacy_id')
else:
    fail('create_ignores_legacy_id', created2['id'])

# Client envoie id namespacé
wanted = f'tx_clientwant_{suffix}'[:40]
# ensure matches regex: need 10+ chars after tx_
wanted = f'tx_{suffix}_abcd1234'
created3 = tx_service.create_transaction(org, user, membre, dict(base, id=wanted))
if created3['id'] == wanted:
    ok('create_keeps_namespaced')
else:
    fail('create_keeps_namespaced', created3['id'])

# Collision namespaced → 409
try:
    tx_service.create_transaction(org, user, membre, dict(base, id=wanted))
    fail('create_collision_409', 'pas leve')
except tx_service.TransactionServiceError as exc:
    if exc.status == 409:
        ok('create_collision_409')
    else:
        fail('create_collision_409', exc.status)

print('=== 3. API HTTP ===')
client = Client(HTTP_HOST='localhost', enforce_csrf_checks=True)
client.force_login(user)
client.get('/app/')
csrf = client.cookies.get('csrftoken')
token = csrf.value if csrf else ''

import json
resp = client.post(
    '/app/api/transactions/',
    data=json.dumps(dict(base, id='9999999999999')),
    content_type='application/json',
    HTTP_X_CSRFTOKEN=token,
)
if resp.status_code == 201:
    body = resp.json().get('transaction') or resp.json()
    tid = str(body.get('id') or '')
    if tid.startswith('tx_') and tid != '9999999999999':
        ok('api_ignores_numeric')
    else:
        fail('api_ignores_numeric', tid)
else:
    fail('api_ignores_numeric', f'{resp.status_code} {resp.content[:200]!r}')

print('=== 4. Front source ===')
script = (ROOT / 'static' / 'js' / 'script.js').read_text(encoding='utf-8')
bridge = (ROOT / 'static' / 'js' / 'django-bridge.js').read_text(encoding='utf-8')
if 'function generateTransactionId' in script and "transaction.id = Date.now()" not in script:
    ok('front_generate')
else:
    fail('front_generate', 'Date.now encore utilise pour id')
if 'generateTransactionId()' in bridge and "offline_' + Date.now()" not in bridge:
    ok('bridge_generate')
else:
    fail('bridge_generate', 'offline_ Date.now encore present')

sw = (ROOT / 'static' / 'js' / 'service-worker.js').read_text(encoding='utf-8')
if 'kaayprint-static-v16' in sw:
    ok('sw_v16')
else:
    fail('sw_v16', 'pas v16')

print()
print(f'Result: {passed} passed, {len(errors)} failed')
for e in errors:
    print(' -', e.encode('ascii', 'replace').decode('ascii'))

User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()
sys.exit(1 if errors else 0)
