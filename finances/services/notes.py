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


def list_notes(org) -> list[dict]:
    qs = (
        Note.objects.filter(organisation=org)
        .select_related('client')
        .order_by('-modifie_le', '-cree_le')
    )
    return [note_to_js(n) for n in qs]


def create_note(org, data: dict) -> dict:
    parsed = note_from_js(data)
    if not parsed['titre']:
        raise NoteServiceError('Le titre de la note est obligatoire.')

    note_id = str(data.get('id') or '').strip() or generate_note_id()
    if Note.objects.filter(pk=note_id).exists():
        raise NoteServiceError('Une note avec cet identifiant existe déjà.', status=409)

    client_id = _resolve_client_id(org, parsed['client_id'])

    with db_transaction.atomic():
        note = Note.objects.create(
            id=note_id,
            organisation=org,
            titre=parsed['titre'],
            contenu=parsed['contenu'],
            client_id=client_id,
            categorie_produit=parsed['categorie_produit'],
            cree_le=parsed['cree_le'] or timezone.now(),
        )

    notifier_changement_organisation(org)
    note = Note.objects.select_related('client').get(pk=note.id)
    return note_to_js(note)


def update_note(org, note_id: str, data: dict) -> dict:
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

    with db_transaction.atomic():
        note.titre = parsed['titre']
        note.contenu = parsed['contenu']
        note.client_id = client_id
        note.categorie_produit = parsed['categorie_produit']
        if parsed['cree_le']:
            note.cree_le = parsed['cree_le']
        note.save()

    notifier_changement_organisation(org)
    note = Note.objects.select_related('client').get(pk=note.id)
    return note_to_js(note)


def delete_note(org, note_id: str) -> None:
    deleted, _ = Note.objects.filter(pk=note_id, organisation=org).delete()
    if not deleted:
        raise NoteServiceError('Note introuvable.', status=404)
    notifier_changement_organisation(org)
