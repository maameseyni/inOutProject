"""Verifie sanitize XSS notes (bleach + create/update service)."""
from __future__ import annotations

import json
import os
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
from finances.models import Note
from finances.serializers import note_from_js, note_to_js
from finances.services import notes as note_service
from finances.services.html_sanitize import sanitize_note_html, sanitize_plain_text

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


def assert_no_xss(label: str, html: str) -> None:
    lower = (html or '').lower()
    forbidden = (
        '<script', '</script', 'javascript:', 'onerror=', 'onload=',
        'onclick=', '<img', '<svg', '<iframe', 'srcdoc=',
    )
    for token in forbidden:
        if token in lower:
            fail(label, f'payload residual: {token!r} in {html!r}')
            return
    ok(label)


print('=== 1. bleach unit ===')
out = sanitize_note_html('<script>alert(1)</script><b>ok</b>')
assert_no_xss('unit_script', out)
if '<b>ok</b>' not in out:
    fail('unit_script_keep_b', out)
else:
    ok('unit_script_keep_b')

out = sanitize_note_html('<img src=x onerror=alert(1)>')
assert_no_xss('unit_img', out)
if out.strip():
    fail('unit_img_empty', out)
else:
    ok('unit_img_empty')

out = sanitize_note_html('<a href="javascript:alert(1)">x</a>')
assert_no_xss('unit_js_href', out)

out = sanitize_note_html('<p onclick="alert(1)">hi</p>')
assert_no_xss('unit_onclick', out)
if 'hi' not in out:
    fail('unit_onclick_text', out)
else:
    ok('unit_onclick_text')

out = sanitize_note_html('<a href="https://example.com">lien</a>')
assert_no_xss('unit_safe_link', out)
if 'https://example.com' not in out or 'lien' not in out:
    fail('unit_safe_link_href', out)
else:
    ok('unit_safe_link_href')

out = sanitize_note_html('<b>gras</b>')
if out != '<b>gras</b>':
    fail('unit_safe_b', out)
else:
    ok('unit_safe_b')

out = sanitize_note_html('texte brut')
if out != 'texte brut':
    fail('unit_plain', out)
else:
    ok('unit_plain')

titre = sanitize_plain_text('<b>Hi</b> Titre')
if '<' in titre or 'Hi' not in titre:
    fail('unit_titre', titre)
else:
    ok('unit_titre')

print('=== 2. note_from_js / note_to_js ===')
parsed = note_from_js({
    'title': '<img src=x onerror=alert(1)>Titre safe',
    'content': (
        '<script>alert(1)</script><p>Bonjour <b>monde</b></p>'
        '<a href="javascript:evil()">bad</a>'
    ),
})
assert_no_xss('from_js_titre', parsed['titre'])
assert_no_xss('from_js_contenu', parsed['contenu'])
if 'Bonjour' not in parsed['contenu'] or '<b>' not in parsed['contenu'].lower():
    fail('from_js_keep_format', parsed['contenu'])
else:
    ok('from_js_keep_format')
if 'Titre safe' not in parsed['titre']:
    fail('from_js_titre_text', parsed['titre'])
else:
    ok('from_js_titre_text')

print('=== 3. service create/update ===')
suffix = f'xsstest_{os.getpid()}'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org XSS')
user = User.objects.create_user(
    username=f'u_{suffix}@example.com',
    email=f'u_{suffix}@example.com',
    password='TestPass123!',
)
MembreOrganisation.objects.create(utilisateur=user, organisation=org, role='proprietaire')

created = note_service.create_note(
    org,
    {
        'title': 'Note XSS <script>alert(1)</script>',
        'content': (
            '<p>Contenu <b>safe</b></p>'
            '<script>alert("xss")</script>'
            '<img src=x onerror=alert(1)>'
            '<a href="javascript:alert(1)">click</a>'
            '<a href="https://kaayprint.test">ok</a>'
        ),
        'pinned': False,
        'archived': False,
    },
    user=user,
)
assert_no_xss('svc_create_title', created.get('title', ''))
assert_no_xss('svc_create_content', created.get('content', ''))
if '<b>safe</b>' not in created.get('content', '') and '<b>' not in created.get('content', '').lower():
    fail('svc_create_keep_b', created.get('content'))
else:
    ok('svc_create_keep_b')
if 'https://kaayprint.test' not in created.get('content', ''):
    fail('svc_create_keep_link', created.get('content'))
else:
    ok('svc_create_keep_link')

note_id = created['id']
db_note = Note.objects.get(id=note_id)
assert_no_xss('db_contenu', db_note.contenu)
assert_no_xss('db_titre', db_note.titre)
roundtrip = note_to_js(db_note)
assert_no_xss('to_js_content', roundtrip['content'])

updated = note_service.update_note(
    org,
    note_id,
    {
        'title': 'Maj',
        'content': '<svg onload=alert(1)><b>maj</b></svg>',
        'pinned': False,
        'archived': False,
    },
    user=user,
)
assert_no_xss('svc_update_content', updated.get('content', ''))
if 'maj' not in updated.get('content', '').lower():
    fail('svc_update_keep_text', updated.get('content'))
else:
    ok('svc_update_keep_text')

print('=== 4. API HTTP (CSRF) ===')
client = Client(HTTP_HOST='localhost', enforce_csrf_checks=True)
client.force_login(user)
# Cookie CSRF
client.get('/app/')
csrf = client.cookies.get('csrftoken')
csrf_token = csrf.value if csrf else ''
api_payload = {
    'title': 'API XSS',
    'content': '<script>alert(9)</script><i>italique</i>',
    'pinned': False,
    'archived': False,
}
resp = client.post(
    '/app/api/notes/',
    data=json.dumps(api_payload),
    content_type='application/json',
    HTTP_X_CSRFTOKEN=csrf_token,
)
if resp.status_code != 201:
    fail('api_create_status', f'{resp.status_code} {resp.content[:400]!r}')
else:
    ok('api_create_status')
    body = resp.json().get('note') or {}
    assert_no_xss('api_create_content', body.get('content', ''))
    if '<i>italique</i>' not in body.get('content', '') and '<i>' not in body.get('content', '').lower():
        fail('api_create_keep_i', body.get('content'))
    else:
        ok('api_create_keep_i')

print()
print(f'Result: {passed} passed, {len(errors)} failed')
for e in errors:
    print(' -', e.encode('ascii', 'replace').decode('ascii'))

# cleanup
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

sys.exit(1 if errors else 0)
