from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

from comptes.emails import envoyer_confirmation_changement_email
from comptes.models import ProfilUtilisateur
from comptes.permissions import PERM_ORGANISATION_MODIFIER, membre_a_permission
from comptes.utils import email_deja_utilise, normaliser_email, synchroniser_email_allauth
from finances.serializers import utilisateur_profil_from_js, utilisateur_profil_to_js
from finances.services.sync import notifier_changement_organisation


class UtilisateurServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def get_profil(utilisateur, organisation, membre) -> dict:
    return utilisateur_profil_to_js(utilisateur, organisation, membre)


def update_profil(utilisateur, organisation, membre, data: dict, request=None) -> dict:
    parsed = utilisateur_profil_from_js(data)

    utilisateur.first_name = parsed['prenom']
    utilisateur.last_name = parsed['nom']
    utilisateur.save(update_fields=['first_name', 'last_name'])

    profil = ProfilUtilisateur.get_or_create_for(utilisateur)
    if 'pays' in parsed:
        profil.pays = parsed['pays']
    if 'ville' in parsed:
        profil.ville = parsed['ville']

    email_demande = normaliser_email(parsed.get('email') or '')
    email_actuel = normaliser_email(utilisateur.email or utilisateur.username or '')

    if email_demande and email_demande != email_actuel:
        if email_deja_utilise(email_demande, exclude_user=utilisateur):
            raise UtilisateurServiceError(
                'Cet e-mail est déjà utilisé par un autre compte.',
                status=409,
            )
        if not request:
            raise UtilisateurServiceError(
                'Impossible d’envoyer l’e-mail de confirmation pour le moment.'
            )
        profil.email_en_attente = email_demande
        profil.save()
        try:
            envoyer_confirmation_changement_email(request, utilisateur, email_demande)
        except Exception as exc:
            profil.email_en_attente = ''
            profil.save(update_fields=['email_en_attente', 'modifie_le'])
            raise UtilisateurServiceError(
                'Impossible d’envoyer l’e-mail de confirmation. Réessayez plus tard.'
            ) from exc
    elif email_demande and email_demande == email_actuel:
        if profil.email_en_attente:
            profil.email_en_attente = ''
            profil.save()
        else:
            profil.save()
    else:
        profil.save()

    if parsed.get('libelle_devise') and membre_a_permission(membre, PERM_ORGANISATION_MODIFIER):
        organisation.libelle_devise = parsed['libelle_devise']
        organisation.save(update_fields=['libelle_devise', 'modifie_le'])
        notifier_changement_organisation(organisation)

    return utilisateur_profil_to_js(utilisateur, organisation, membre, profil=profil)


def appliquer_changement_email(utilisateur) -> str:
    """Applique email_en_attente après confirmation du lien. Retourne le nouvel e-mail."""
    profil = ProfilUtilisateur.get_or_create_for(utilisateur)
    nouvel_email = normaliser_email(profil.email_en_attente)
    if not nouvel_email:
        raise UtilisateurServiceError('Aucun changement d’e-mail en attente.', status=400)
    if email_deja_utilise(nouvel_email, exclude_user=utilisateur):
        profil.email_en_attente = ''
        profil.save(update_fields=['email_en_attente', 'modifie_le'])
        raise UtilisateurServiceError(
            'Cet e-mail est déjà utilisé par un autre compte.',
            status=409,
        )

    utilisateur.email = nouvel_email
    utilisateur.username = nouvel_email
    utilisateur.save(update_fields=['email', 'username'])
    profil.email_en_attente = ''
    profil.save(update_fields=['email_en_attente', 'modifie_le'])
    synchroniser_email_allauth(utilisateur, nouvel_email, verified=True)
    return nouvel_email


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
