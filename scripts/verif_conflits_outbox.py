"""Verifie conflits outbox : source + 409 optimiste API + suite Node IndexedDB."""
from __future__ import annotations

import json
import os
import subprocess
import sys
from datetime import timedelta
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
from finances.models import Note
from finances.services import notes as note_service
from finances.services.optimistic import OptimisticLockError, verifier_verrou_optimiste

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


print('=== A. Suite Node (IndexedDB + source) ===')
node_script = ROOT / 'scripts' / 'verif_conflits_outbox.cjs'
proc = subprocess.run(
    ['node', str(node_script)],
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
    ok('node_suite')
else:
    fail('node_suite', f'exit {proc.returncode}')

print('=== B. Verrou optimiste / 409 ===')
suffix = f'conflict_{os.getpid()}'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org Conflict')
user = User.objects.create_user(
    username=f'u_{suffix}@example.com',
    email=f'u_{suffix}@example.com',
    password='TestPass123!',
)
MembreOrganisation.objects.create(utilisateur=user, organisation=org, role='proprietaire')

created = note_service.create_note(
    org,
    {'title': 'Note conflit', 'content': '<p>v1</p>', 'pinned': False, 'archived': False},
    user=user,
)
note_id = created['id']
note = Note.objects.get(id=note_id)
stale_ts = (note.modifie_le - timedelta(seconds=30)).isoformat().replace('+00:00', 'Z')

try:
    verifier_verrou_optimiste(note, {'updatedAt': stale_ts})
    fail('optimistic_raises', 'pas leve')
except OptimisticLockError:
    ok('optimistic_raises')

# Update serveur (simule autre utilisateur)
note_service.update_note(
    org,
    note_id,
    {
        'title': 'Note conflit',
        'content': '<p>v2 serveur</p>',
        'pinned': False,
        'archived': False,
        'updatedAt': created.get('updatedAt'),
    },
    user=user,
)
note.refresh_from_db()

client = Client(HTTP_HOST='localhost', enforce_csrf_checks=True)
client.force_login(user)
client.get('/app/')
csrf = client.cookies.get('csrftoken')
token = csrf.value if csrf else ''

# Client envoie ancienne version → 409
resp = client.patch(
    f'/app/api/notes/{note_id}/',
    data=json.dumps({
        'title': 'Note conflit',
        'content': '<p>v1 locale offline</p>',
        'pinned': False,
        'archived': False,
        'updatedAt': stale_ts,
    }),
    content_type='application/json',
    HTTP_X_CSRFTOKEN=token,
)
if resp.status_code == 409:
    ok('api_409')
else:
    fail('api_409', f'{resp.status_code} {resp.content[:200]!r}')

# Force sans updatedAt → OK (écrasement)
resp2 = client.patch(
    f'/app/api/notes/{note_id}/',
    data=json.dumps({
        'title': 'Note conflit',
        'content': '<p>v1 forcee</p>',
        'pinned': False,
        'archived': False,
    }),
    content_type='application/json',
    HTTP_X_CSRFTOKEN=token,
)
if resp2.status_code == 200:
    ok('api_force_without_updatedAt')
    body = resp2.json().get('note') or {}
    if 'forcee' in str(body.get('content') or ''):
        ok('api_force_applied')
    else:
        fail('api_force_applied', body.get('content'))
else:
    fail('api_force_without_updatedAt', f'{resp2.status_code} {resp2.content[:200]!r}')

print()
print(f'Result: {passed} passed, {len(errors)} failed')
for e in errors:
    print(' -', e.encode('ascii', 'replace').decode('ascii'))

User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()
sys.exit(1 if errors else 0)
