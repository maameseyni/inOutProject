from django.db import transaction as db_transaction
from django.utils import timezone

from finances.models import SequenceDocument, Transaction


PREFIX_BY_TYPE = {
    Transaction.TYPE_ENTRANT: ('FAC', SequenceDocument.PREFIX_FAC),
    Transaction.TYPE_SORTANT: ('PAY', SequenceDocument.PREFIX_PAY),
}


def format_document_number(prefix_label: str, year: int, counter: int) -> str:
    width = max(5, len(str(counter)))
    return f'{prefix_label}-{year}-{counter:0{width}d}'


def document_prefix_label(tx_type: str) -> str:
    return PREFIX_BY_TYPE.get(tx_type, ('FAC', SequenceDocument.PREFIX_FAC))[0]


def allocate_document_number(org, tx_type: str, date=None) -> str:
    when = date or timezone.now()
    if timezone.is_naive(when):
        when = timezone.make_aware(when, timezone.get_current_timezone())
    year = when.year
    prefix_label, prefix_type = PREFIX_BY_TYPE.get(
        tx_type,
        (document_prefix_label(Transaction.TYPE_ENTRANT), SequenceDocument.PREFIX_FAC),
    )

    with db_transaction.atomic():
        seq, _ = SequenceDocument.objects.select_for_update().get_or_create(
            organisation=org,
            prefix_type=prefix_type,
            annee=year,
            defaults={'compteur': 0},
        )
        seq.compteur += 1
        seq.save(update_fields=['compteur'])
        return format_document_number(prefix_label, year, seq.compteur)


def resolve_document_number(transaction) -> str:
    if transaction.numero_document:
        return transaction.numero_document
    prefix = document_prefix_label(transaction.type)
    suffix = str(transaction.id)[-8:].upper()
    return f'{prefix}-{suffix}'
