import secrets
import time

from django.db import transaction as db_transaction
from django.utils import timezone

from finances.models import Client, Note
from finances.serializers import note_from_js, note_to_js
from finances.services.optimistic import OptimisticLockError, verifier_verrou_optimiste
from finances.services.sync import notifier_changement_organisation


class NoteServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def generate_note_id() -> str:
    ts = format(int(time.time() * 1000), 'x')
    rnd = secrets.token_hex(3)
    return f'note_{ts}_{rnd}'


def _resolve_client_id(org, client_id: str | None) -> str | None:
    if not client_id:
        return None
    if not Client.objects.filter(pk=client_id, organisation=org).exists():
        raise NoteServiceError('Client introuvable.', status=404)
    return client_id


def list_notes(org, page: int = 1, page_size: int = 50) -> dict:
    qs = (
        Note.objects.filter(organisation=org)
        .select_related('client')
        .order_by('-epinglee', '-modifie_le', '-cree_le')
    )
    total = qs.count()
    try:
        page_size = int(page_size)
    except (TypeError, ValueError):
        page_size = 50
    try:
        page = int(page)
    except (TypeError, ValueError):
        page = 1
    page_size = min(max(page_size, 1), 100)
    page = max(page, 1)
    total_pages = max(1, (total + page_size - 1) // page_size) if total else 1
    if page > total_pages:
        page = total_pages
    start = (page - 1) * page_size
    notes = list(qs[start:start + page_size])
    return {
        'notes': [note_to_js(n) for n in notes],
        'page': page,
        'pageSize': page_size,
        'total': total,
        'totalPages': total_pages,
    }


def create_note(org, data: dict, user=None) -> dict:
    parsed = note_from_js(data)
    if not parsed['titre']:
        raise NoteServiceError('Le titre de la note est obligatoire.')

    note_id = str(data.get('id') or '').strip() or generate_note_id()
    if Note.objects.filter(pk=note_id).exists():
        raise NoteServiceError('Une note avec cet identifiant existe déjà.', status=409)

    client_id = _resolve_client_id(org, parsed['client_id'])
    rappel_le = parsed['rappel_le'] if parsed['has_reminder'] else None
    rappel_par_email = bool(parsed['rappel_par_email'] and rappel_le and user)
    rappel_email_user = user if rappel_par_email else None

    with db_transaction.atomic():
        note = Note.objects.create(
            id=note_id,
            organisation=org,
            titre=parsed['titre'],
            contenu=parsed['contenu'],
            client_id=client_id,
            categorie_produit=parsed['categorie_produit'],
            epinglee=parsed['epinglee'],
            archivee=parsed['archivee'],
            rappel_le=rappel_le,
            rappel_par_email=rappel_par_email,
            rappel_email_utilisateur=rappel_email_user,
            rappel_email_envoye_le=None,
            cree_le=parsed['cree_le'] or timezone.now(),
        )

    notifier_changement_organisation(org)
    note = Note.objects.select_related('client', 'rappel_email_utilisateur').get(pk=note.id)
    from finances.services.note_reminders import try_send_note_reminder_email
    email_sent = try_send_note_reminder_email(note)
    payload = note_to_js(note)
    payload['reminderEmailSent'] = email_sent
    return payload


def update_note(org, note_id: str, data: dict, user=None) -> dict:
    note = Note.objects.filter(pk=note_id, organisation=org).select_related('client').first()
    if not note:
        raise NoteServiceError('Note introuvable.', status=404)

    try:
        verifier_verrou_optimiste(note, data)
    except OptimisticLockError as exc:
        raise NoteServiceError(exc.message, status=exc.status) from exc

    merged = {**note_to_js(note), **data}
    parsed = note_from_js(merged)
    if not parsed['titre']:
        raise NoteServiceError('Le titre de la note est obligatoire.')

    client_id = _resolve_client_id(org, parsed['client_id'])
    prev_rappel = note.rappel_le
    prev_email = note.rappel_par_email

    with db_transaction.atomic():
        note.titre = parsed['titre']
        note.contenu = parsed['contenu']
        note.client_id = client_id
        note.categorie_produit = parsed['categorie_produit']
        note.epinglee = parsed['epinglee']
        note.archivee = parsed['archivee']
        if parsed['has_reminder'] or 'reminderAt' in data:
            note.rappel_le = parsed['rappel_le']
        if parsed['has_reminder_email'] or 'reminderEmail' in data or 'reminderAt' in data:
            wants_email = bool(parsed['rappel_par_email'] and note.rappel_le and user)
            note.rappel_par_email = wants_email
            if wants_email:
                # Nouvelle activation → permettre un (ré)envoi
                if not prev_email:
                    note.rappel_email_envoye_le = None
                note.rappel_email_utilisateur = user
            else:
                note.rappel_email_utilisateur = None
                note.rappel_email_envoye_le = None
        if note.rappel_le != prev_rappel:
            note.rappel_email_envoye_le = None
        if not note.rappel_le:
            note.rappel_par_email = False
            note.rappel_email_utilisateur = None
            note.rappel_email_envoye_le = None
        if parsed['cree_le']:
            note.cree_le = parsed['cree_le']
        note.save()

    notifier_changement_organisation(org)
    note = Note.objects.select_related('client', 'rappel_email_utilisateur').get(pk=note.id)
    from finances.services.note_reminders import try_send_note_reminder_email
    email_sent = try_send_note_reminder_email(note)
    payload = note_to_js(note)
    payload['reminderEmailSent'] = email_sent
    return payload


def delete_note(org, note_id: str) -> None:
    deleted, _ = Note.objects.filter(pk=note_id, organisation=org).delete()
    if not deleted:
        raise NoteServiceError('Note introuvable.', status=404)
    notifier_changement_organisation(org)
