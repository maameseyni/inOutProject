import re
import secrets

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


# IDs client acceptés uniquement s'ils sont namespacés (pas un timestamp nu).
_CLIENT_TX_ID_RE = re.compile(r'^tx_[A-Za-z0-9_-]{10,80}$')


def generate_transaction_id() -> str:
    """Identifiant non prévisible (évite collisions timestamp ms)."""
    return f'tx_{secrets.token_hex(8)}_{secrets.token_hex(4)}'


def _generate_transaction_id() -> str:
    return generate_transaction_id()


def resolve_new_transaction_id(raw_id) -> str:
    """
    Accepte un id client seulement s'il est namespacé `tx_…`.
    Sinon en génère un côté serveur (ignore Date.now() / ids arbitraires).
    """
    candidate = str(raw_id or '').strip()
    if candidate and _CLIENT_TX_ID_RE.fullmatch(candidate):
        return candidate[:128]
    return generate_transaction_id()


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

    tx_id = resolve_new_transaction_id(data.get('id'))
    if Transaction.objects.filter(pk=tx_id).exists():
        # Collision rare sur id client namespacé : en générer un autre.
        if str(data.get('id') or '').strip() == tx_id:
            raise TransactionServiceError('Une transaction avec cet identifiant existe déjà.', status=409)
        tx_id = generate_transaction_id()
        while Transaction.objects.filter(pk=tx_id).exists():
            tx_id = generate_transaction_id()

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
    from finances.serializers import decimal_or_none, parse_iso_date

    amount_to_complete = decimal_or_none(amount)
    if not amount_to_complete or amount_to_complete <= 0:
        raise TransactionServiceError('Le montant à compléter doit être supérieur à 0.')

    complete_date = parse_iso_date(date) or timezone.now()

    with db_transaction.atomic():
        # Verrou ligne : empêche un double complément concurrent.
        tx = (
            Transaction.objects
            .select_for_update()
            .filter(pk=transaction_id, organisation=org)
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

        if amount_to_complete > tx.montant_restant:
            raise TransactionServiceError(
                f'Le montant ne peut pas dépasser le reste à payer ({tx.montant_restant}).',
            )

        new_amount = tx.montant + amount_to_complete
        new_remaining = tx.montant_restant - amount_to_complete
        if new_remaining <= 0:
            new_remaining = None

        tx.montant = new_amount
        tx.montant_restant = new_remaining
        tx.save()
        Paiement.objects.create(
            transaction=tx,
            client_id=tx.client_id,
            montant=amount_to_complete,
            paye_le=complete_date,
        )
        tx_id = tx.id

    notifier_changement_organisation(org)

    tx = (
        Transaction.objects
        .select_related('client', 'cree_par')
        .prefetch_related('paiements')
        .get(pk=tx_id)
    )
    return transaction_to_js(tx)
