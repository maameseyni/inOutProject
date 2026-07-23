"""
Vérifie toutes les corrections de la session P0/P1 :
1. SECRET_KEY / DEBUG
2. Confirmation e-mail (routes + activation)
3. SSE retiré + polling 30s
4. Mot de passe init obligatoire
5. Snapshot offline notes/catégories
6. Purge logout
7. Rate limiting
8. Unicité e-mail + re-confirmation
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import Client, RequestFactory
from django.urls import NoReverseMatch, reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode
from io import StringIO

from comptes.models import MembreOrganisation, Organisation, ProfilUtilisateur
from comptes.ratelimit_utils import limited
from comptes.tokens import changement_email_token, confirmation_email_token
from comptes.utils import email_deja_utilise
from finances.services import utilisateur as user_service

User = get_user_model()
errors: list[str] = []
passed = 0


def ok(name: str) -> None:
    global passed
    passed += 1
    print(('OK  ' + name).encode('ascii', 'replace').decode('ascii'))


def fail(name: str, detail) -> None:
    errors.append(f'{name}: {detail}')
    print(('FAIL ' + name + ' - ' + str(detail)).encode('ascii', 'replace').decode('ascii'))


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


print('=== 1. Config prod SECRET_KEY / DEBUG ===')
src_settings = read('config/settings.py')
if '_load_secret_key' in src_settings and "DEBUG = _env_bool('DJANGO_DEBUG', False)" in src_settings:
    ok('1a DEBUG default False + SECRET via _load_secret_key')
else:
    fail('1a', 'structure settings inattendue')

if settings.SECRET_KEY and len(settings.SECRET_KEY) >= 40:
    ok('1b SECRET_KEY runtime valide')
else:
    fail('1b', f'len={len(settings.SECRET_KEY or "")}')

if isinstance(settings.DEBUG, bool):
    ok(f'1c DEBUG runtime={settings.DEBUG} (depuis .env)')
else:
    fail('1c', settings.DEBUG)

from django.core.exceptions import ImproperlyConfigured
from config import settings as settings_mod

old = os.environ.get('DJANGO_SECRET_KEY')
try:
    os.environ['DJANGO_SECRET_KEY'] = ''
    try:
        settings_mod._load_secret_key()
        fail('1d', 'aurait du lever ImproperlyConfigured')
    except ImproperlyConfigured:
        ok('1d SECRET_KEY vide rejete')

    os.environ['DJANGO_SECRET_KEY'] = 'django-insecure-test-key-should-be-rejected-xxxxxx'
    try:
        settings_mod._load_secret_key()
        fail('1e', 'cle insecure acceptee')
    except ImproperlyConfigured:
        ok('1e SECRET_KEY insecure rejetee')
finally:
    if old is None:
        os.environ.pop('DJANGO_SECRET_KEY', None)
    else:
        os.environ['DJANGO_SECRET_KEY'] = old


print('=== 2. Confirmation e-mail (inscription) ===')
try:
    reverse('confirmer_email', args=['uid', 'tok'])
    reverse('confirmation_email_envoyee')
    reverse('renvoyer_confirmation_email')
    ok('2a routes reverse OK')
except NoReverseMatch as exc:
    fail('2a', exc)

for tpl in (
    'templates/comptes/confirmation_email_envoyee.html',
    'templates/comptes/renvoyer_confirmation_email.html',
    'templates/comptes/email_confirmation_compte.html',
):
    if (ROOT / tpl).exists():
        ok(f'2b template {Path(tpl).name}')
    else:
        fail('2b', f'manquant {tpl}')

suffix = f'vsuite_{os.getpid()}'
settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
mail.outbox = []
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

email_new = f'new_{suffix}@example.com'
client = Client(HTTP_HOST='localhost')
# Inscription via form service path: create inactive + send mail manually like view
from comptes.forms import InscriptionForm
from comptes.emails import envoyer_confirmation_email
from django.test import RequestFactory

rf = RequestFactory()
form = InscriptionForm(data={
    'nom_organisation': f'Test Org {suffix}',
    'telephone': '+221770000000',
    'libelle_devise': 'XOF',
    'email': email_new,
    'prenom': 'Test',
    'nom': 'User',
    'mot_de_passe': 'TestPass123!',
    'confirmation_mot_de_passe': 'TestPass123!',
})
if form.is_valid():
    user, org = form.save()
    if not user.is_active:
        ok('2c user créé inactif')
    else:
        fail('2c', 'user actif dès création')
    req = rf.get('/', HTTP_HOST='localhost')
    mail.outbox = []
    envoyer_confirmation_email(req, user)
    if mail.outbox and 'confirmer-email' in (mail.outbox[0].body or ''):
        ok('2d mail confirmation contient lien')
    else:
        # check html alternative
        body = mail.outbox[0].body if mail.outbox else ''
        alts = getattr(mail.outbox[0], 'alternatives', []) if mail.outbox else []
        html = alts[0][0] if alts else ''
        if 'confirmer-email' in body or 'confirmer-email' in html:
            ok('2d mail confirmation contient lien')
        else:
            fail('2d', 'lien absent du mail')

    uidb64 = urlsafe_base64_encode(force_bytes(user.pk))
    token = confirmation_email_token.make_token(user)
    resp = client.get(reverse('confirmer_email', args=[uidb64, token]))
    user.refresh_from_db()
    if resp.status_code in (301, 302) and user.is_active:
        ok('2e clic lien active le compte')
    else:
        fail('2e', f'status={resp.status_code} active={user.is_active}')
else:
    fail('2c form', form.errors)


print('=== 3. SSE retiré / polling 30s ===')
api_src = read('finances/api_views.py')
urls_src = read('finances/urls.py')
bridge = read('static/js/django-bridge.js')
if 'evenements_sync' not in api_src and 'api/evenements' not in urls_src:
    ok('3a endpoint SSE absent')
else:
    fail('3a', 'SSE encore présent')
if 'EventSource' not in bridge and 'SYNC_POLL_MS = 30000' in bridge and 'pollSyncSeq' in bridge:
    ok('3b polling 30s côté front')
else:
    fail('3b', 'polling manquant ou EventSource encore là')
if 'while True' not in api_src or 'time.sleep(2)' not in api_src:
    ok('3c pas de while True sleep dans api_views')
else:
    fail('3c', 'boucle SSE encore dans api_views')


print('=== 4. Mot de passe init obligatoire ===')
cmd_src = read('comptes/management/commands/initialiser_kaayprint.py')
if "default='inout2#'" in cmd_src:
    fail('4a', 'défaut inout2# encore présent')
else:
    ok('4a plus de défaut inout2#')
if 'required=True' in cmd_src and '--password' in cmd_src:
    ok('4b --password required')
else:
    fail('4b', 'password non required')

buf = StringIO()
try:
    call_command('initialiser_kaayprint', email=f'x_{suffix}@example.com', stdout=buf, stderr=buf)
    fail('4c', 'commande sans --password aurait du echouer')
except (CommandError, SystemExit):
    ok('4c sans --password = erreur')

try:
    call_command(
        'initialiser_kaayprint',
        email=f'x_{suffix}@example.com',
        password='inout2#',
        stdout=buf,
        stderr=buf,
    )
    fail('4d', 'inout2# accepte')
except (CommandError, SystemExit):
    ok('4d inout2# / faible rejete')


print('=== 5. Snapshot offline notes/catégories ===')
offline = read('static/js/xaliss-offline.js')
if 'notes: data.notes || []' in offline and 'categories: data.categories || []' in offline:
    ok('5a saveSnapshot persiste notes+categories')
else:
    fail('5a', 'champs absents de saveSnapshot')
if "/categories/" in offline and 'snapshot.categories' in offline and 'snapshot.notes' in offline:
    ok('5b getSnapshotResponse notes+categories')
else:
    fail('5b', 'lecture snapshot incomplète')


print('=== 6. Purge logout ===')
script_js = read('static/js/script.js')
if 'purgeSensitiveClientData' in offline and 'purgeSensitiveClientData' in script_js:
    ok('6a purge branchée au logout')
else:
    fail('6a', 'purge non branchée')
if 'deleteDatabase' in offline and 'kaayprint_' in offline and 'caches.delete' in offline:
    ok('6b purge localStorage + IndexedDB + caches')
else:
    fail('6b', 'purge incomplète')


print('=== 7. Rate limiting ===')
if any('ApiWriteRateLimitMiddleware' in m for m in settings.MIDDLEWARE) and settings.RATELIMIT_ENABLE:
    ok('7a middleware + RATELIMIT_ENABLE')
else:
    fail('7a', f'mw={settings.MIDDLEWARE} enable={settings.RATELIMIT_ENABLE}')

# reset cache group
from django.core.cache import cache
cache.clear()
blocked_at = None
for i in range(1, 12):
    req = rf.post('/connexion/')
    if limited(req, group=f'verif_login_{suffix}', rate='10/m', key='ip'):
        blocked_at = i
        break
if blocked_at == 11:
    ok('7b login rate limit 10/m (bloque au 11e)')
else:
    fail('7b', f'blocked_at={blocked_at}')

# API write middleware smoke
from finances.middleware import ApiWriteRateLimitMiddleware

mw_hits = {'n': 0}

def dummy(request):
    mw_hits['n'] += 1
    from django.http import JsonResponse
    return JsonResponse({'ok': True})

mw = ApiWriteRateLimitMiddleware(dummy)
u_rl = User.objects.filter(is_active=True).first()
if u_rl:
    cache.clear()
    req = rf.post('/app/api/transactions/')
    req.user = u_rl
    # 121 writes should eventually 429
    got_429 = False
    for i in range(130):
        resp = mw(req)
        if getattr(resp, 'status_code', 200) == 429:
            got_429 = True
            break
    if got_429:
        ok('7c API writes → 429 après saturation')
    else:
        fail('7c', 'pas de 429')
else:
    fail('7c', 'pas d’utilisateur pour tester')


print('=== 8. Unicité e-mail + re-confirmation ===')
email_a = f'a_{suffix}@example.com'
email_b = f'b_{suffix}@example.com'
email_c = f'c_{suffix}@example.com'
User.objects.filter(email__contains=suffix).delete()
# keep org from inscription if exists else create
org8 = Organisation.objects.filter(slug__contains=suffix).first()
if not org8:
    org8 = Organisation.objects.create(slug=f'org8-{suffix}', nom='Org8')
ua = User.objects.create_user(username=email_a, email=email_a, password='TestPass123!')
ub = User.objects.create_user(username=email_b, email=email_b, password='TestPass123!')
ma = MembreOrganisation.objects.create(utilisateur=ua, organisation=org8, role='proprietaire')
mb = MembreOrganisation.objects.create(utilisateur=ub, organisation=org8, role='membre')

if email_deja_utilise(email_a) and not email_deja_utilise(email_a, exclude_user=ua):
    ok('8a unicité helper')
else:
    fail('8a', 'helper')

req = rf.get('/', HTTP_HOST='localhost')
try:
    user_service.update_profil(ua, org8, ma, {'firstName': 'A', 'lastName': 'A', 'email': email_b}, request=req)
    fail('8b', 'pas de 409')
except user_service.UtilisateurServiceError as exc:
    ok('8b refuse email pris') if exc.status == 409 else fail('8b', exc)

mail.outbox = []
profil = user_service.update_profil(
    ua, org8, ma, {'firstName': 'A', 'lastName': 'A', 'email': email_c}, request=req,
)
ua.refresh_from_db()
pa = ProfilUtilisateur.objects.get(utilisateur=ua)
if ua.email == email_a and pa.email_en_attente == email_c and profil.get('pendingEmail') == email_c:
    ok('8c pending JSON+DB')
else:
    fail('8c', f"{ua.email}/{pa.email_en_attente}/{profil.get('pendingEmail')}")
if mail.outbox and mail.outbox[0].to == [email_c]:
    ok('8d mail vers nouvelle adresse')
else:
    fail('8d', mail.outbox)

uidb64 = urlsafe_base64_encode(force_bytes(ua.pk))
token = changement_email_token.make_token(ua)
c2 = Client(HTTP_HOST='localhost')
c2.force_login(ua)
resp = c2.get(reverse('confirmer_changement_email', args=[uidb64, token]))
ua.refresh_from_db()
pa.refresh_from_db()
if resp.status_code in (301, 302) and ua.email == email_c and not pa.email_en_attente:
    ok('8e confirmation appliquée')
else:
    fail('8e', f'{resp.status_code} {ua.email}')

try:
    user_service.update_profil(ub, org8, mb, {'firstName': 'B', 'lastName': 'B', 'email': email_c}, request=req)
    fail('8f', 'ub non bloqué')
except user_service.UtilisateurServiceError as exc:
    ok('8f ub bloqué après transfert') if exc.status == 409 else fail('8f', exc)

# templates changement
for tpl in (
    'templates/comptes/email_confirmation_changement.html',
    'templates/comptes/email_confirmation_changement.txt',
):
    if (ROOT / tpl).exists():
        ok(f'8g {Path(tpl).name}')
    else:
        fail('8g', tpl)


print('=== Cleanup ===')
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

print('---')
print(f'PASSED {passed}  FAILED {len(errors)}')
if errors:
    for e in errors:
        print(' -', e)
    raise SystemExit(1)
print('ALL PASSED')
