from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any

from comptes.permissions import PERM_ORGANISATION_MODIFIER, membre_a_permission
from finances.models import Client, Note, Transaction

TYPE_JS_TO_MODEL = {
    'income': Transaction.TYPE_ENTRANT,
    'expense': Transaction.TYPE_SORTANT,
    'entrant': Transaction.TYPE_ENTRANT,
    'sortant': Transaction.TYPE_SORTANT,
}

TYPE_MODEL_TO_JS = {
    Transaction.TYPE_ENTRANT: 'income',
    Transaction.TYPE_SORTANT: 'expense',
}


def parse_iso_date(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def format_iso_date(dt: datetime | None) -> str | None:
    if not dt:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')[:-3] + 'Z'


def decimal_or_none(value: Any) -> Decimal | None:
    if value is None or value == '':
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        return None


def decimal_to_float(value: Decimal | None) -> float | None:
    if value is None:
        return None
    return float(value)


def paiement_to_js(paiement) -> dict:
    return {
        'amount': decimal_to_float(paiement.montant),
        'date': format_iso_date(paiement.paye_le),
    }


def transaction_to_js(transaction: Transaction) -> dict:
    paiements = list(transaction.paiements.all())
    if paiements:
        payments = [paiement_to_js(p) for p in paiements]
    else:
        payments = [{
            'amount': decimal_to_float(transaction.montant),
            'date': format_iso_date(transaction.date),
        }]

    client_nom = transaction.nom_client_facture
    if not client_nom and transaction.client_id:
        client_nom = transaction.client.nom

    data = {
        'id': transaction.id,
        'type': TYPE_MODEL_TO_JS.get(transaction.type, transaction.type),
        'amount': decimal_to_float(transaction.montant),
        'description': transaction.description,
        'category': transaction.categorie_produit or '',
        'date': format_iso_date(transaction.date),
        'payments': payments,
        'remainingAmount': decimal_to_float(transaction.montant_restant),
        'invoiceClient': client_nom or None,
        'invoiceClientId': transaction.client_id,
        'cree_par_nom': transaction.cree_par_nom or None,
        'cree_par_role': transaction.cree_par_role or None,
        'updatedAt': format_iso_date(transaction.modifie_le),
    }
    return data


def transaction_from_js(data: dict) -> dict:
    """Extrait les champs modèle depuis le format JS."""
    tx_type = TYPE_JS_TO_MODEL.get(str(data.get('type', '')).strip(), Transaction.TYPE_ENTRANT)
    montant = decimal_or_none(data.get('amount')) or Decimal('0')
    date = parse_iso_date(data.get('date')) or datetime.now(timezone.utc)

    remaining = data.get('remainingAmount')
    if remaining is None and 'remainingAmount' not in data:
        montant_restant = None
    else:
        montant_restant = decimal_or_none(remaining)

    invoice_client = data.get('invoiceClient')
    nom_client = str(invoice_client).strip()[:200] if invoice_client else ''
    client_id = str(data['invoiceClientId']).strip() if data.get('invoiceClientId') else None

    payments_raw = data.get('payments')
    payments = []
    if isinstance(payments_raw, list) and payments_raw:
        for p in payments_raw:
            if not isinstance(p, dict):
                continue
            payments.append({
                'montant': decimal_or_none(p.get('amount')) or Decimal('0'),
                'paye_le': parse_iso_date(p.get('date')) or date,
            })
    else:
        payments = [{'montant': montant, 'paye_le': date}]

    return {
        'type': tx_type,
        'montant': montant,
        'description': str(data.get('description') or ''),
        'categorie_produit': str(data.get('category') or '').strip()[:120],
        'date': date,
        'montant_restant': montant_restant,
        'nom_client_facture': nom_client,
        'client_id': client_id,
        'payments': payments,
    }


def client_to_js(client: Client) -> dict:
    return {
        'id': client.id,
        'name': client.nom,
        'phone': client.telephone,
        'note': client.note,
        'provenance': client.provenance,
        'createdAt': format_iso_date(client.cree_le),
        'updatedAt': format_iso_date(client.modifie_le),
        'aliases': [a.alias_nom for a in client.alias.all()],
    }


def client_from_js(data: dict) -> dict:
    nom = str(data.get('name') or '').strip()[:200]
    aliases_raw = data.get('aliases') or []
    aliases = []
    seen = set()
    for alias in aliases_raw:
        a = str(alias or '').strip()[:200]
        key = a.lower()
        if not a or key == nom.lower() or key in seen:
            continue
        seen.add(key)
        aliases.append(a)

    return {
        'nom': nom,
        'telephone': str(data.get('phone') or '').strip()[:40],
        'note': str(data.get('note') or '').strip(),
        'provenance': str(data.get('provenance') or '').strip()[:40],
        'cree_le': parse_iso_date(data.get('createdAt')),
        'aliases': aliases,
    }


def note_to_js(note: Note) -> dict:
    client_nom = note.client.nom if note.client_id else ''
    return {
        'id': note.id,
        'title': note.titre,
        'content': note.contenu,
        'clientId': note.client_id,
        'clientName': client_nom or None,
        'category': note.categorie_produit or '',
        'pinned': bool(note.epinglee),
        'archived': bool(note.archivee),
        'reminderAt': format_iso_date(note.rappel_le),
        'reminderEmail': bool(note.rappel_par_email and note.rappel_le),
        'createdAt': format_iso_date(note.cree_le),
        'updatedAt': format_iso_date(note.modifie_le),
    }


def note_from_js(data: dict) -> dict:
    client_id = data.get('clientId') or data.get('invoiceClientId')
    if client_id is not None:
        client_id = str(client_id).strip() or None
    category = str(data.get('category') or '').strip()[:120]
    reminder_raw = data.get('reminderAt')
    if reminder_raw is None and 'reminderAt' not in data:
        rappel_le = None
        has_reminder = False
    else:
        has_reminder = True
        rappel_le = parse_iso_date(reminder_raw) if reminder_raw else None
    reminder_email = bool(data.get('reminderEmail')) and bool(rappel_le)
    return {
        'titre': str(data.get('title') or '').strip()[:200],
        'contenu': str(data.get('content') or '').strip(),
        'client_id': client_id,
        'categorie_produit': category,
        'epinglee': bool(data.get('pinned')),
        'archivee': bool(data.get('archived')),
        'rappel_le': rappel_le,
        'has_reminder': has_reminder,
        'rappel_par_email': reminder_email,
        'has_reminder_email': 'reminderEmail' in data,
        'cree_le': parse_iso_date(data.get('createdAt')),
    }


def organisation_profile_to_js(organisation) -> dict:
    return {
        'name': organisation.nom,
        'address': organisation.adresse,
        'phone': organisation.telephone,
        'email': organisation.email,
        'website': organisation.site_web,
        'currencyLabel': organisation.libelle_devise or 'FCFA',
        'autoRefreshLocal': organisation.rafraichissement_auto,
    }


def organisation_profile_from_js(data: dict) -> dict:
    libelle = None
    if 'currencyLabel' in data or 'libelle_devise' in data:
        libelle = str(data.get('currencyLabel') or data.get('libelle_devise') or 'FCFA').strip()[:16] or 'FCFA'

    auto_refresh = None
    if 'autoRefreshLocal' in data:
        auto_refresh = data.get('autoRefreshLocal') is not False
    elif 'rafraichissement_auto' in data:
        auto_refresh = data.get('rafraichissement_auto') is not False

    return {
        'nom': str(data.get('name') or '').strip()[:200],
        'adresse': str(data.get('address') or '').strip(),
        'telephone': str(data.get('phone') or '').strip()[:40],
        'email': str(data.get('email') or '').strip()[:80],
        'site_web': str(data.get('website') or '').strip()[:120],
        'libelle_devise': libelle,
        'rafraichissement_auto': auto_refresh,
    }


def utilisateur_profil_to_js(utilisateur, organisation, membre) -> dict:
    # Reverse one-to-one : getattr renvoie None si le profil n'existe pas encore
    # (RelatedObjectDoesNotExist hérite d'AttributeError).
    profil = getattr(utilisateur, 'profil', None)
    return {
        'firstName': utilisateur.first_name or '',
        'lastName': utilisateur.last_name or '',
        'email': utilisateur.email or '',
        'country': profil.pays if profil else '',
        'city': profil.ville if profil else '',
        'currencyLabel': organisation.libelle_devise or 'FCFA',
        'hasPassword': utilisateur.has_usable_password(),
        'canEditCurrency': membre_a_permission(membre, PERM_ORGANISATION_MODIFIER),
    }


def utilisateur_profil_from_js(data: dict) -> dict:
    libelle = None
    if 'currencyLabel' in data or 'libelle_devise' in data:
        libelle = str(
            data.get('currencyLabel') or data.get('libelle_devise') or ''
        ).strip()[:16] or None

    parsed = {
        'prenom': str(data.get('firstName') or data.get('prenom') or '').strip()[:150],
        'nom': str(data.get('lastName') or data.get('nom') or '').strip()[:150],
        'email': str(data.get('email') or '').strip()[:254],
        'libelle_devise': libelle,
    }
    if 'country' in data or 'pays' in data:
        parsed['pays'] = str(data.get('country') or data.get('pays') or '').strip()[:100]
    if 'city' in data or 'ville' in data:
        parsed['ville'] = str(data.get('city') or data.get('ville') or '').strip()[:100]
    return parsed
