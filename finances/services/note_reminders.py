import logging

from django.utils import timezone

from comptes.emails import envoyer_rappel_note_email
from finances.models import Note

logger = logging.getLogger(__name__)


def try_send_note_reminder_email(note: Note) -> bool:
    """
    Envoie le rappel e-mail si la note est due et pas encore notifiée.

    Claim atomique (UPDATE … WHERE rappel_email_envoye_le IS NULL) avant l'envoi
    pour éviter un double mail sous concurrence (cron + GET / onglets).
    """
    if not note or not note.pk:
        return False

    now = timezone.now()
    claimed_at = now

    # Réserve la note avant SMTP (1 seul gagnant si course).
    updated = Note.objects.filter(
        pk=note.pk,
        archivee=False,
        rappel_par_email=True,
        rappel_le__isnull=False,
        rappel_le__lte=now,
        rappel_email_envoye_le__isnull=True,
        rappel_email_utilisateur__isnull=False,
    ).update(
        rappel_email_envoye_le=claimed_at,
        modifie_le=claimed_at,
    )
    if updated != 1:
        return False

    locked = (
        Note.objects
        .select_related('rappel_email_utilisateur')
        .filter(pk=note.pk)
        .first()
    )
    if not locked:
        return False

    user = locked.rappel_email_utilisateur
    email = (user.email or '').strip() if user else ''
    if not email:
        logger.warning('Rappel note %s : destinataire sans e-mail', locked.id)
        Note.objects.filter(pk=locked.pk, rappel_email_envoye_le=claimed_at).update(
            rappel_email_envoye_le=None,
            modifie_le=timezone.now(),
        )
        return False

    try:
        envoyer_rappel_note_email(locked, user)
        logger.info('Rappel note %s envoyé à %s', locked.id, email)
        return True
    except Exception:
        # Libère le claim pour un nouvel essai.
        Note.objects.filter(pk=locked.pk, rappel_email_envoye_le=claimed_at).update(
            rappel_email_envoye_le=None,
            modifie_le=timezone.now(),
        )
        logger.exception('Échec envoi rappel e-mail note %s', locked.id)
        return False


def process_due_note_reminder_emails(org=None) -> int:
    """Envoie les e-mails de rappel dus (une fois par échéance)."""
    now = timezone.now()
    qs = (
        Note.objects.filter(
            rappel_par_email=True,
            archivee=False,
            rappel_le__isnull=False,
            rappel_le__lte=now,
            rappel_email_envoye_le__isnull=True,
            rappel_email_utilisateur__isnull=False,
        )
        .only('id')
        .order_by('rappel_le')
    )
    if org is not None:
        qs = qs.filter(organisation=org)

    sent = 0
    for note in list(qs[:100]):
        if try_send_note_reminder_email(note):
            sent += 1
    return sent
