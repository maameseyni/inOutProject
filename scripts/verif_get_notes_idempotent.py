"""Verifie H8 : GET /notes/ n'envoie plus d'e-mails ; POST rappels + cron OK."""
from __future__ import annotations

import os
import sys
from datetime import timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.conf import settings

settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

from django.contrib.auth import get_user_model
from django.core import mail
from django.test import Client
from django.utils import timezone

from comptes.models import MembreOrganisation, Organisation
from finances.models import Note
from finances.services.note_reminders import process_due_note_reminder_emails

User = get_user_model()
setattr(mail, 'outbox', [])

passed = 0
errors: list[str] = []


def ok(name: str) -> None:
    global passed
    passed += 1
    print(('OK  ' + name).encode('ascii', 'replace').decode('ascii'))


def fail(name: str, detail) -> None:
    errors.append(f'{name}: {detail}')
    print(('FAIL ' + name + ' - ' + str(detail)).encode('ascii', 'replace').decode('ascii'))


print('=== 1. Source ===')
api_src = (ROOT / 'finances' / 'api_views.py').read_text(encoding='utf-8')
idx = api_src.find('def notes_list_create')
idx_end = api_src.find('def note_detail', idx)
block = api_src[idx:idx_end]
if 'process_due_note_reminder_emails' in block:
    fail('get_no_process', 'encore dans notes_list_create')
else:
    ok('get_no_process')

if 'def notes_process_reminder_emails' in api_src:
    ok('post_endpoint_exists')
else:
    fail('post_endpoint_exists', 'absent')

cmd = ROOT / 'finances' / 'management' / 'commands' / 'envoyer_rappels_notes.py'
if cmd.is_file() and 'process_due_note_reminder_emails' in cmd.read_text(encoding='utf-8'):
    ok('cron_command')
else:
    fail('cron_command', 'absent')

print('=== 2. GET notes ne declenche pas SMTP ===')
suffix = f'h8_{os.getpid()}'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org H8')
user = User.objects.create_user(
    username=f'u_{suffix}@example.com',
    email=f'u_{suffix}@example.com',
    password='TestPass123!',
)
MembreOrganisation.objects.create(utilisateur=user, organisation=org, role='proprietaire')

Note.objects.create(
    id=f'note-{suffix}',
    organisation=org,
    titre='Rappel du',
    contenu='test',
    rappel_le=timezone.now() - timedelta(minutes=5),
    rappel_par_email=True,
    rappel_email_envoye_le=None,
    rappel_email_utilisateur=user,
)

setattr(mail, 'outbox', [])

client = Client(HTTP_HOST='localhost', enforce_csrf_checks=True)
client.force_login(user)
client.get('/app/')
csrf = client.cookies.get('csrftoken')
token = csrf.value if csrf else ''

resp = client.get('/app/api/notes/')
if resp.status_code != 200:
    fail('get_status', resp.status_code)
else:
    ok('get_status')

if len(getattr(mail, 'outbox', [])) == 0:
    ok('get_no_mail')
else:
    fail('get_no_mail', len(mail.outbox))

note = Note.objects.get(id=f'note-{suffix}')
if note.rappel_email_envoye_le is None:
    ok('get_no_claim')
else:
    fail('get_no_claim', note.rappel_email_envoye_le)

print('=== 3. POST rappels-email envoie ===')
setattr(mail, 'outbox', [])
resp3 = client.post(
    '/app/api/notes/rappels-email/',
    data='{}',
    content_type='application/json',
    HTTP_X_CSRFTOKEN=token,
)
if resp3.status_code == 200:
    ok('post_status')
    data = resp3.json()
    if int(data.get('sent') or 0) >= 1:
        ok('post_sent')
    else:
        fail('post_sent', data)
else:
    fail('post_status', f'{resp3.status_code} {resp3.content[:200]!r}')

note.refresh_from_db()
if note.rappel_email_envoye_le is not None:
    ok('post_claimed')
else:
    fail('post_claimed', 'non marque')

if len(getattr(mail, 'outbox', [])) >= 1:
    ok('post_mail')
else:
    fail('post_mail', len(getattr(mail, 'outbox', [])))

print('=== 4. Cron service direct ===')
Note.objects.filter(id=f'note-{suffix}').update(rappel_email_envoye_le=None)
setattr(mail, 'outbox', [])
sent = process_due_note_reminder_emails(org)
if sent >= 1 and len(getattr(mail, 'outbox', [])) >= 1:
    ok('cron_service')
else:
    fail('cron_service', f'sent={sent} mails={len(getattr(mail, "outbox", []))}')

print()
print(f'Result: {passed} passed, {len(errors)} failed')
for e in errors:
    print(' -', e.encode('ascii', 'replace').decode('ascii'))

User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()
sys.exit(1 if errors else 0)
