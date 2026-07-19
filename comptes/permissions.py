"""Permissions par rôle au sein d'une organisation."""

from comptes.models import MembreOrganisation

# Lecture : tout membre actif
PERM_LIRE = 'lire'

# Écriture opérationnelle (transactions, compléter paiement)
PERM_TRANSACTION_ECRIRE = 'transaction_ecrire'
PERM_TRANSACTION_SUPPRIMER = 'transaction_supprimer'

# Clients
PERM_CLIENT_ECRIRE = 'client_ecrire'
PERM_CLIENT_SUPPRIMER = 'client_supprimer'

# Paramètres entreprise
PERM_ORGANISATION_MODIFIER = 'organisation_modifier'

_ROLE_PERMISSIONS: dict[str, set[str]] = {
    MembreOrganisation.ROLE_PROPRIETAIRE: {
        PERM_LIRE,
        PERM_TRANSACTION_ECRIRE,
        PERM_TRANSACTION_SUPPRIMER,
        PERM_CLIENT_ECRIRE,
        PERM_CLIENT_SUPPRIMER,
        PERM_ORGANISATION_MODIFIER,
    },
    MembreOrganisation.ROLE_ADMIN: {
        PERM_LIRE,
        PERM_TRANSACTION_ECRIRE,
        PERM_TRANSACTION_SUPPRIMER,
        PERM_CLIENT_ECRIRE,
        PERM_CLIENT_SUPPRIMER,
        PERM_ORGANISATION_MODIFIER,
    },
    MembreOrganisation.ROLE_MEMBRE: {
        PERM_LIRE,
        PERM_TRANSACTION_ECRIRE,
        PERM_CLIENT_ECRIRE,
    },
}


def membre_a_permission(membre, permission: str) -> bool:
    if not membre or not membre.actif:
        return False
    allowed = _ROLE_PERMISSIONS.get(membre.role, set())
    return permission in allowed


def permissions_pour_frontend(membre) -> dict:
    """Dict booléen pour le JS (masquer boutons interdits)."""
    return {
        'canWriteTransaction': membre_a_permission(membre, PERM_TRANSACTION_ECRIRE),
        'canDeleteTransaction': membre_a_permission(membre, PERM_TRANSACTION_SUPPRIMER),
        'canWriteClient': membre_a_permission(membre, PERM_CLIENT_ECRIRE),
        'canDeleteClient': membre_a_permission(membre, PERM_CLIENT_SUPPRIMER),
        'canEditOrganisation': membre_a_permission(membre, PERM_ORGANISATION_MODIFIER),
        'role': membre.role if membre else '',
        'roleLabel': membre.get_role_display_label() if membre else '',
    }
