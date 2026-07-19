from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

from comptes.models import ProfilUtilisateur
from comptes.permissions import PERM_ORGANISATION_MODIFIER, membre_a_permission
from finances.serializers import utilisateur_profil_from_js, utilisateur_profil_to_js
from finances.services.sync import notifier_changement_organisation


class UtilisateurServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def get_profil(utilisateur, organisation, membre) -> dict:
    return utilisateur_profil_to_js(utilisateur, organisation, membre)


def update_profil(utilisateur, organisation, membre, data: dict) -> dict:
    parsed = utilisateur_profil_from_js(data)

    utilisateur.first_name = parsed['prenom']
    utilisateur.last_name = parsed['nom']
    if parsed['email']:
        utilisateur.email = parsed['email']
        utilisateur.username = parsed['email']
    utilisateur.save(update_fields=['first_name', 'last_name', 'email', 'username'])

    profil = ProfilUtilisateur.get_or_create_for(utilisateur)
    if 'pays' in parsed:
        profil.pays = parsed['pays']
    if 'ville' in parsed:
        profil.ville = parsed['ville']
    profil.save()

    if parsed.get('libelle_devise') and membre_a_permission(membre, PERM_ORGANISATION_MODIFIER):
        organisation.libelle_devise = parsed['libelle_devise']
        organisation.save(update_fields=['libelle_devise', 'modifie_le'])
        notifier_changement_organisation(organisation)

    return utilisateur_profil_to_js(utilisateur, organisation, membre)


def changer_mot_de_passe(utilisateur, data: dict) -> None:
    current_password = str(data.get('currentPassword') or '')
    new_password = str(data.get('newPassword') or '')
    confirm_password = str(data.get('confirmPassword') or '')

    if utilisateur.has_usable_password() and not utilisateur.check_password(current_password):
        raise UtilisateurServiceError('Le mot de passe actuel est incorrect.', status=403)
    if not new_password:
        raise UtilisateurServiceError('Le nouveau mot de passe est obligatoire.')
    if new_password != confirm_password:
        raise UtilisateurServiceError('Les mots de passe ne correspondent pas.')

    try:
        validate_password(new_password, utilisateur)
    except ValidationError as exc:
        raise UtilisateurServiceError(' '.join(exc.messages)) from exc

    utilisateur.set_password(new_password)
    utilisateur.save(update_fields=['password'])
