import time

from django.db import transaction as db_transaction
from django.utils import timezone

from finances.models import Client, Paiement, Transaction
from finances.serializers import transaction_from_js, transaction_to_js
from finances.services.optimistic import OptimisticLockError, verifier_verrou_optimiste
from finances.services.sync import notifier_changement_organisation


class TransactionServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def _generate_transaction_id() -> str:
    return str(int(time.time() * 1000))


def _resolve_client(org, client_id, nom_client):
    if not client_id:
        return None, nom_client
    client = Client.objects.filter(pk=client_id, organisation=org).first()
    if not client:
        raise TransactionServiceError('Client introuvable.', status=404)
    nom = nom_client or client.nom
    return client, nom


def _sync_paiements(transaction: Transaction, payments: list[dict]):
    transaction.paiements.all().delete()
    client_id = transaction.client_id
    for p in payments:
        Paiement.objects.create(
            transaction=transaction,
            client_id=client_id,
            montant=p['montant'],
            paye_le=p['paye_le'],
        )


def list_transactions(org) -> list[dict]:
    qs = (
        Transaction.objects
        .filter(organisation=org)
        .select_related('client', 'cree_par')
        .prefetch_related('paiements')
    )
    return [transaction_to_js(tx) for tx in qs]


def create_transaction(org, user, membre, data: dict) -> dict:
    parsed = transaction_from_js(data)
    if parsed['montant'] <= 0 and parsed['montant_restant'] is None:
        raise TransactionServiceError('Le montant doit être supérieur à 0.')

    tx_id = str(data.get('id') or '').strip() or _generate_transaction_id()
    if Transaction.objects.filter(pk=tx_id).exists():
        raise TransactionServiceError('Une transaction avec cet identifiant existe déjà.', status=409)

    client, nom_client = _resolve_client(org, parsed['client_id'], parsed['nom_client_facture'])

    with db_transaction.atomic():
        tx = Transaction(
            id=tx_id,
            organisation=org,
            type=parsed['type'],
            montant=parsed['montant'],
            description=parsed['description'],
            categorie_produit=parsed['categorie_produit'],
            date=parsed['date'],
            montant_restant=parsed['montant_restant'],
            nom_client_facture=nom_client,
            client=client,
        )
        Transaction.remplir_auteur(tx, user, membre)
        tx.save()
        _sync_paiements(tx, parsed['payments'])

    notifier_changement_organisation(org)

    tx = (
        Transaction.objects
        .select_related('client', 'cree_par')
        .prefetch_related('paiements')
        .get(pk=tx.id)
    )
    return transaction_to_js(tx)


def update_transaction(org, transaction_id: str, data: dict) -> dict:
    tx = (
        Transaction.objects
        .filter(pk=transaction_id, organisation=org)
        .select_related('client')
        .prefetch_related('paiements')
        .first()
    )
    if not tx:
        raise TransactionServiceError('Transaction introuvable.', status=404)

    try:
        verifier_verrou_optimiste(tx, data)
    except OptimisticLockError as exc:
        raise TransactionServiceError(exc.message, status=exc.status) from exc

    merged = {**transaction_to_js(tx), **data}
    parsed = transaction_from_js(merged)
    # Ne resynchroniser les paiements que s'ils sont dans le PATCH.
    # Sinon un PATCH partiel (catégorie, client…) écrase l'historique des paiements.
    sync_payments = 'payments' in data
    if parsed['montant'] <= 0 and parsed['montant_restant'] is None:
        raise TransactionServiceError('Le montant doit être supérieur à 0.')

    client, nom_client = _resolve_client(org, parsed['client_id'], parsed['nom_client_facture'])

    with db_transaction.atomic():
        tx.type = parsed['type']
        tx.montant = parsed['montant']
        tx.description = parsed['description']
        tx.categorie_produit = parsed['categorie_produit']
        tx.date = parsed['date']
        tx.montant_restant = parsed['montant_restant']
        tx.nom_client_facture = nom_client
        tx.client = client
        tx.save()
        if sync_payments:
            _sync_paiements(tx, parsed['payments'])

    notifier_changement_organisation(org)

    tx = (
        Transaction.objects
        .select_related('client', 'cree_par')
        .prefetch_related('paiements')
        .get(pk=tx.id)
    )
    return transaction_to_js(tx)


def delete_transaction(org, transaction_id: str) -> None:
    deleted, _ = Transaction.objects.filter(pk=transaction_id, organisation=org).delete()
    if not deleted:
        raise TransactionServiceError('Transaction introuvable.', status=404)
    notifier_changement_organisation(org)


def complete_transaction(org, user, membre, transaction_id: str, amount, date, data: dict | None = None) -> dict:
    from decimal import Decimal

    tx = (
        Transaction.objects
        .filter(pk=transaction_id, organisation=org)
        .prefetch_related('paiements')
        .first()
    )
    if not tx:
        raise TransactionServiceError('Transaction introuvable.', status=404)

    try:
        verifier_verrou_optimiste(tx, data or {})
    except OptimisticLockError as exc:
        raise TransactionServiceError(exc.message, status=exc.status) from exc

    if not tx.montant_restant or tx.montant_restant <= 0:
        raise TransactionServiceError('Transaction déjà complète ou sans montant restant.')

    from finances.serializers import decimal_or_none, parse_iso_date

    amount_to_complete = decimal_or_none(amount)
    if not amount_to_complete or amount_to_complete <= 0:
        raise TransactionServiceError('Le montant à compléter doit être supérieur à 0.')

    if amount_to_complete > tx.montant_restant:
        raise TransactionServiceError(
            f'Le montant ne peut pas dépasser le reste à payer ({tx.montant_restant}).',
        )

    complete_date = parse_iso_date(date) or timezone.now()
    new_amount = tx.montant + amount_to_complete
    new_remaining = tx.montant_restant - amount_to_complete
    if new_remaining <= 0:
        new_remaining = None

    with db_transaction.atomic():
        tx.montant = new_amount
        tx.montant_restant = new_remaining
        tx.save()
        Paiement.objects.create(
            transaction=tx,
            client_id=tx.client_id,
            montant=amount_to_complete,
            paye_le=complete_date,
        )

    notifier_changement_organisation(org)

    tx = (
        Transaction.objects
        .select_related('client', 'cree_par')
        .prefetch_related('paiements')
        .get(pk=tx.id)
    )
    return transaction_to_js(tx)
