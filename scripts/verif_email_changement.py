"""Script de vérif manuelle — unicité e-mail + re-confirmation."""
import os
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
from django.test import Client, RequestFactory
from django.urls import reverse
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from comptes.models import MembreOrganisation, Organisation, ProfilUtilisateur
from comptes.tokens import changement_email_token
from comptes.utils import email_deja_utilise
from finances.services import utilisateur as user_service

User = get_user_model()
settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

rf = RequestFactory()
errors = []


def ok(name):
    print('OK ', name)


def fail(name, detail):
    errors.append(f'{name}: {detail}')
    print('FAIL', name, '-', detail)


suffix = f'testuniq_{os.getpid()}'
email_a = f'a_{suffix}@example.com'
email_b = f'b_{suffix}@example.com'
email_c = f'c_{suffix}@example.com'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org Test Uniq')
ua = User.objects.create_user(
    username=email_a, email=email_a, password='TestPass123!', first_name='A', last_name='One',
)
ub = User.objects.create_user(
    username=email_b, email=email_b, password='TestPass123!', first_name='B', last_name='Two',
)
ma = MembreOrganisation.objects.create(utilisateur=ua, organisation=org, role='proprietaire')
mb = MembreOrganisation.objects.create(utilisateur=ub, organisation=org, role='membre')

if (
    email_deja_utilise(email_a)
    and not email_deja_utilise(email_a, exclude_user=ua)
    and email_deja_utilise(email_a.upper(), exclude_user=ub)
):
    ok('1 unicité iexact')
else:
    fail('1', 'unicité')

req = rf.get('/', HTTP_HOST='localhost')
try:
    user_service.update_profil(
        ua, org, ma, {'firstName': 'A', 'lastName': 'One', 'email': email_b}, request=req,
    )
    fail('2', 'pas de 409')
except user_service.UtilisateurServiceError as exc:
    if exc.status == 409:
        ok('2 refuse 409')
    else:
        fail('2', exc)

profil = user_service.update_profil(
    ua, org, ma, {'firstName': 'A', 'lastName': 'One', 'email': email_a}, request=req,
)
if not profil.get('pendingEmail'):
    ok('3 pas pending si même email')
else:
    fail('3', profil)

mail.outbox = []
profil = user_service.update_profil(
    ua, org, ma, {'firstName': 'A', 'lastName': 'One', 'email': email_c}, request=req,
)
ua.refresh_from_db()
pa = ProfilUtilisateur.objects.get(utilisateur=ua)
if (
    ua.email == email_a
    and pa.email_en_attente == email_c
    and profil.get('pendingEmail') == email_c
):
    ok('4a pending JSON + DB')
else:
    fail(
        '4a',
        f"email={ua.email} db={pa.email_en_attente} js={profil.get('pendingEmail')!r}",
    )

if len(mail.outbox) == 1 and mail.outbox[0].to == [email_c]:
    ok('4b mail nouvelle adresse')
else:
    fail('4b', getattr(mail, 'outbox', None))

if email_deja_utilise(email_c, exclude_user=ub):
    ok('5 email réservé pendant pending')
else:
    fail('5', 'pending non détecté')

uidb64 = urlsafe_base64_encode(force_bytes(ua.pk))
token = changement_email_token.make_token(ua)
client = Client(HTTP_HOST='localhost')
client.force_login(ua)
url = reverse('confirmer_changement_email', args=[uidb64, token])
resp = client.get(url)
ua.refresh_from_db()
pa.refresh_from_db()
if (
    resp.status_code in (301, 302)
    and ua.email == email_c
    and ua.username == email_c
    and not pa.email_en_attente
):
    ok('6 confirmation appliquée')
else:
    fail('6', f'{resp.status_code} {ua.email} {pa.email_en_attente!r}')

resp2 = client.get(url)
ua.refresh_from_db()
if resp2.status_code in (301, 302) and ua.email == email_c:
    ok('7 rejeu token sans casser email')
else:
    fail('7', f'{resp2.status_code} {ua.email}')

try:
    user_service.update_profil(
        ub, org, mb, {'firstName': 'B', 'lastName': 'Two', 'email': email_c}, request=req,
    )
    fail('8', 'pas bloqué')
except user_service.UtilisateurServiceError as exc:
    if exc.status == 409:
        ok('8 ub bloqué après transfert')
    else:
        fail('8', exc)

resp3 = client.get(reverse('confirmer_changement_email', args=[uidb64, 'badtoken']))
if resp3.status_code in (301, 302):
    ok('9 mauvais token redirigé')
else:
    fail('9', resp3.status_code)

User.objects.filter(pk__in=[ua.pk, ub.pk]).delete()
org.delete()

print('---')
if errors:
    print('FAILED', len(errors))
    for err in errors:
        print(' -', err)
    raise SystemExit(1)
print('ALL PASSED')
