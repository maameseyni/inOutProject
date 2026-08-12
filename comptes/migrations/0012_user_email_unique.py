# Unicité e-mail des comptes Django (auth.User).
# Normalise les e-mails, résout les doublons, index unique LOWER(email) (PostgreSQL).

from django.db import migrations
from django.utils import timezone


def _score(u):
    """Préférence pour le compte à garder : actif, dernier login, plus récent."""
    ll = u.last_login or u.date_joined or timezone.now()
    return (1 if u.is_active else 0, ll, u.pk)


def normaliser_et_dedoublonner(apps, schema_editor):
    User = apps.get_model('auth', 'User')
    try:
        EmailAddress = apps.get_model('account', 'EmailAddress')
    except LookupError:
        EmailAddress = None

    # 1) Minuscules + trim sur auth_user.email
    for u in User.objects.iterator(chunk_size=200):
        raw = (u.email or '').strip()
        if not raw:
            continue
        lower = raw.lower()
        if lower != u.email:
            u.email = lower
            u.save(update_fields=['email'])

    # 2) Doublons même e-mail
    by_email = {}
    for u in User.objects.exclude(email='').order_by('id'):
        by_email.setdefault(u.email.lower(), []).append(u)

    for email, users in by_email.items():
        if len(users) < 2:
            continue
        keep = sorted(users, key=_score, reverse=True)[0]
        for u in users:
            if u.pk == keep.pk:
                continue
            u.email = f'legacy.user{u.pk}@doublon.xaliss.invalid'
            u.save(update_fields=['email'])
            if EmailAddress is not None:
                EmailAddress.objects.filter(user_id=u.pk, email__iexact=email).delete()

    # 3) Normaliser allauth.EmailAddress
    if EmailAddress is None:
        return
    for row in EmailAddress.objects.iterator(chunk_size=200):
        raw = (row.email or '').strip()
        if not raw:
            continue
        lower = raw.lower()
        if lower != row.email:
            row.email = lower
            row.save(update_fields=['email'])

    # 4) Une seule ligne EmailAddress par adresse (préférer verified + primary)
    seen = {}
    for row in EmailAddress.objects.order_by('-verified', '-primary', 'id'):
        key = (row.email or '').strip().lower()
        if not key:
            continue
        if key in seen:
            row.delete()
        else:
            seen[key] = row.pk


def creer_index_unique(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        if schema_editor.connection.vendor == 'postgresql':
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS auth_user_email_unique_ci
                ON auth_user (LOWER(email))
                WHERE email IS NOT NULL AND email <> ''
                """
            )
        else:
            cursor.execute(
                """
                CREATE UNIQUE INDEX IF NOT EXISTS auth_user_email_unique_ci
                ON auth_user (email)
                WHERE email IS NOT NULL AND email <> ''
                """
            )


def supprimer_index_unique(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('DROP INDEX IF EXISTS auth_user_email_unique_ci')


class Migration(migrations.Migration):
    dependencies = [
        ('auth', '0012_alter_user_first_name_max_length'),
        ('comptes', '0011_abonnements_organisation'),
    ]

    operations = [
        migrations.RunPython(normaliser_et_dedoublonner, migrations.RunPython.noop),
        migrations.RunPython(creer_index_unique, supprimer_index_unique),
    ]
