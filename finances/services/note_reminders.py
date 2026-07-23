import logging

from django.utils import timezone

from comptes.emails import envoyer_rappel_note_email
from finances.models import Note

logger = logging.getLogger(__name__)


def try_send_note_reminder_email(note: Note) -> bool:
    """Envoie le rappel e-mail si la note est due et pas encore notifiée."""
    if not note or note.archivee or not note.rappel_par_email or not note.rappel_le:
        return False
    if note.rappel_email_envoye_le:
        return False
    if not note.rappel_email_utilisateur_id:
        return False
    if note.rappel_le > timezone.now():
        return False

    user = note.rappel_email_utilisateur
    email = (user.email or '').strip() if user else ''
    if not email:
        logger.warning('Rappel note %s : destinataire sans e-mail', note.id)
        return False

    try:
        envoyer_rappel_note_email(note, user)
        note.rappel_email_envoye_le = timezone.now()
        note.save(update_fields=['rappel_email_envoye_le', 'modifie_le'])
        logger.info('Rappel note %s envoyé à %s', note.id, email)
        return True
    except Exception:
        logger.exception('Échec envoi rappel e-mail note %s', note.id)
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
        .select_related('rappel_email_utilisateur')
        .order_by('rappel_le')
    )
    if org is not None:
        qs = qs.filter(organisation=org)

    sent = 0
    for note in list(qs[:100]):
        if try_send_note_reminder_email(note):
            sent += 1
    return sent
