import secrets
import time

from django.db import transaction as db_transaction
from django.utils import timezone

from finances.models import AliasClient, Client
from finances.serializers import client_from_js, client_to_js
from finances.services.optimistic import OptimisticLockError, verifier_verrou_optimiste
from finances.services.sync import notifier_changement_organisation


class ClientServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def generate_client_id() -> str:
    ts = format(int(time.time() * 1000), 'x')
    rnd = secrets.token_hex(3)
    return f'cli_{ts}_{rnd}'


def _sync_aliases(client: Client, aliases: list[str]):
    client.alias.all().delete()
    for alias_nom in aliases:
        AliasClient.objects.create(client=client, alias_nom=alias_nom)


def list_clients(org) -> list[dict]:
    qs = (
        Client.objects.filter(organisation=org)
        .prefetch_related('alias')
        .order_by('-cree_le', 'nom')
    )
    return [client_to_js(c) for c in qs]


def create_client(org, data: dict) -> dict:
    parsed = client_from_js(data)
    if not parsed['nom']:
        raise ClientServiceError('Le nom du client est obligatoire.')

    client_id = str(data.get('id') or '').strip() or generate_client_id()
    if Client.objects.filter(pk=client_id).exists():
        raise ClientServiceError('Un client avec cet identifiant existe déjà.', status=409)

    with db_transaction.atomic():
        client = Client.objects.create(
            id=client_id,
            organisation=org,
            nom=parsed['nom'],
            telephone=parsed['telephone'],
            note=parsed['note'],
            provenance=parsed['provenance'],
            cree_le=parsed['cree_le'] or timezone.now(),
        )
        _sync_aliases(client, parsed['aliases'])

    notifier_changement_organisation(org)

    client = Client.objects.prefetch_related('alias').get(pk=client.id)
    return client_to_js(client)


def update_client(org, client_id: str, data: dict) -> dict:
    client = Client.objects.filter(pk=client_id, organisation=org).prefetch_related('alias').first()
    if not client:
        raise ClientServiceError('Client introuvable.', status=404)

    try:
        verifier_verrou_optimiste(client, data)
    except OptimisticLockError as exc:
        raise ClientServiceError(exc.message, status=exc.status) from exc

    parsed = client_from_js({**client_to_js(client), **data})
    if not parsed['nom']:
        raise ClientServiceError('Le nom du client est obligatoire.')

    with db_transaction.atomic():
        client.nom = parsed['nom']
        client.telephone = parsed['telephone']
        client.note = parsed['note']
        client.provenance = parsed['provenance']
        if parsed['cree_le']:
            client.cree_le = parsed['cree_le']
        client.save()
        _sync_aliases(client, parsed['aliases'])

    notifier_changement_organisation(org)

    client = Client.objects.prefetch_related('alias').get(pk=client.id)
    return client_to_js(client)


def delete_client(org, client_id: str) -> None:
    deleted, _ = Client.objects.filter(pk=client_id, organisation=org).delete()
    if not deleted:
        raise ClientServiceError('Client introuvable.', status=404)
    notifier_changement_organisation(org)
