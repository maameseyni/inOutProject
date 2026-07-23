"""Tests concurrence : paiements + rappels e-mail + verrous."""
from __future__ import annotations

import os
import sys
import threading
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

import django

django.setup()

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core import mail
from django.utils import timezone

from comptes.models import MembreOrganisation, Organisation
from finances.models import Note, Paiement, Transaction, VerrouEdition
from finances.services import locks as lock_service
from finances.services import note_reminders
from finances.services import transactions as tx_service

User = get_user_model()
settings.EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'

passed = 0
errors: list[str] = []


def ok(name: str) -> None:
    global passed
    passed += 1
    print(('OK  ' + name).encode('ascii', 'replace').decode('ascii'))


def fail(name: str, detail) -> None:
    errors.append(f'{name}: {detail}')
    print(('FAIL ' + name + ' - ' + str(detail)).encode('ascii', 'replace').decode('ascii'))


suffix = f'locktest_{os.getpid()}'
User.objects.filter(email__contains=suffix).delete()
Organisation.objects.filter(slug__contains=suffix).delete()

org = Organisation.objects.create(slug=f'org-{suffix}', nom='Org Lock')
user = User.objects.create_user(
    username=f'u_{suffix}@example.com',
    email=f'u_{suffix}@example.com',
    password='TestPass123!',
)
membre = MembreOrganisation.objects.create(
    utilisateur=user, organisation=org, role='proprietaire',
)

print('=== 1. Double complement paiement ===')
tx = Transaction.objects.create(
    id=f'tx-{suffix}',
    organisation=org,
    type='entrant',
    montant=Decimal('50000'),
    description='Test lock',
    date=timezone.now(),
    montant_restant=Decimal('50000'),
)
Paiement.objects.create(
    transaction=tx,
    montant=Decimal('50000'),
    paye_le=timezone.now(),
)

results: list[str] = []
barrier = threading.Barrier(2)


def do_complete(label: str) -> None:
    try:
        barrier.wait(timeout=5)
        tx_service.complete_transaction(
            org, user, membre, tx.id, Decimal('50000'), timezone.now().isoformat(),
        )
        results.append(f'{label}:ok')
    except Exception as exc:
        results.append(f'{label}:err:{exc}')


t1 = threading.Thread(target=do_complete, args=('A',))
t2 = threading.Thread(target=do_complete, args=('B',))
t1.start()
t2.start()
t1.join(timeout=15)
t2.join(timeout=15)

tx.refresh_from_db()
nb_paiements = Paiement.objects.filter(transaction=tx).count()
oks = [r for r in results if r.endswith(':ok')]
errs = [r for r in results if ':err:' in r]

# 1 seul succes, 1 echec, reste null/0, 2 paiements max (1 initial + 1 complement)
# Wait - initial create has 1 paiement of 50000 for montant 50000 with remaining 50000?
# Looking at my setup: montant=50000, remaining=50000, and one paiement 50000 - that's odd business-wise
# but for complete we only care about remaining.
# After one complete of 50000: remaining None, montant 100000, paiements = 2
# Second should fail with "deja complete"

if len(oks) == 1 and len(errs) == 1 and nb_paiements == 2 and (tx.montant_restant is None or tx.montant_restant == 0):
    ok('1a un seul complement gagne sous concurrence')
else:
    fail(
        '1a',
        f'results={results} paiements={nb_paiements} restant={tx.montant_restant} montant={tx.montant}',
    )

# Second sequential complete must fail
try:
    tx_service.complete_transaction(
        org, user, membre, tx.id, Decimal('1000'), timezone.now().isoformat(),
    )
    fail('1b', '2e complement aurait du echouer')
except tx_service.TransactionServiceError:
    ok('1b 2e complement refuse')


print('=== 2. Double envoi rappel note ===')
mail.outbox = []
note = Note.objects.create(
    id=f'note-{suffix}',
    organisation=org,
    titre='Rappel test',
    contenu='contenu',
    rappel_le=timezone.now() - timedelta(minutes=1),
    rappel_par_email=True,
    rappel_email_utilisateur=user,
)

send_results: list[bool] = []
barrier2 = threading.Barrier(2)


def do_send() -> None:
    barrier2.wait(timeout=5)
    send_results.append(note_reminders.try_send_note_reminder_email(note))


s1 = threading.Thread(target=do_send)
s2 = threading.Thread(target=do_send)
s1.start()
s2.start()
s1.join(timeout=15)
s2.join(timeout=15)

note.refresh_from_db()
true_count = sum(1 for x in send_results if x)
if true_count == 1 and len(mail.outbox) == 1 and note.rappel_email_envoye_le:
    ok('2a un seul mail rappel sous concurrence')
else:
    fail(
        '2a',
        f'sends={send_results} mails={len(mail.outbox)} envoye_le={note.rappel_email_envoye_le}',
    )

# 3e appel ne renvoie pas
mail.outbox = []
again = note_reminders.try_send_note_reminder_email(note)
if not again and len(mail.outbox) == 0:
    ok('2b pas de renvoi si deja envoye')
else:
    fail('2b', f'again={again} mails={len(mail.outbox)}')


print('=== 3. Verrou edition concurrent ===')
ressource_id = f'tx-lock-{suffix}'
lock_results: list[str] = []
barrier3 = threading.Barrier(2)

user2 = User.objects.create_user(
    username=f'u2_{suffix}@example.com',
    email=f'u2_{suffix}@example.com',
    password='TestPass123!',
)
MembreOrganisation.objects.create(utilisateur=user2, organisation=org, role='membre')


def do_lock(u, label: str) -> None:
    try:
        barrier3.wait(timeout=5)
        lock_service.acquerir_verrou(
            org, u, VerrouEdition.RESSOURCE_TRANSACTION, ressource_id,
        )
        lock_results.append(f'{label}:ok')
    except Exception as exc:
        lock_results.append(f'{label}:err:{getattr(exc, "status", type(exc).__name__)}')


l1 = threading.Thread(target=do_lock, args=(user, 'U1'))
l2 = threading.Thread(target=do_lock, args=(user2, 'U2'))
l1.start()
l2.start()
l1.join(timeout=15)
l2.join(timeout=15)

ok_locks = [r for r in lock_results if r.endswith(':ok')]
err_locks = [r for r in lock_results if ':err:' in r]
if len(ok_locks) == 1 and len(err_locks) == 1:
    ok('3a un seul verrou acquis sous concurrence')
else:
    fail('3a', lock_results)

# meme user peut renouveler
lock_service.acquerir_verrou(org, user if 'U1:ok' in lock_results else user2,
                             VerrouEdition.RESSOURCE_TRANSACTION, ressource_id)
ok('3b renouvellement par le detenteur')


print('=== Cleanup ===')
VerrouEdition.objects.filter(organisation=org).delete()
Note.objects.filter(organisation=org).delete()
Transaction.objects.filter(organisation=org).delete()
User.objects.filter(email__contains=suffix).delete()
org.delete()

print('---')
print(f'PASSED {passed}  FAILED {len(errors)}')
if errors:
    for e in errors:
        print(' -', e)
    raise SystemExit(1)
print('ALL PASSED')
