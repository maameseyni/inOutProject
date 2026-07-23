from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone

from finances.models import VerrouEdition

LOCK_DURATION = timedelta(minutes=2)

VALID_RESSOURCE_TYPES = {
    VerrouEdition.RESSOURCE_TRANSACTION,
    VerrouEdition.RESSOURCE_CLIENT,
}


class LockServiceError(Exception):
    def __init__(self, message: str, status: int = 423):
        self.message = message
        self.status = status
        super().__init__(message)


def _nettoyer_verrous_expires():
    VerrouEdition.objects.filter(expire_le__lte=timezone.now()).delete()


def _nom_utilisateur(user) -> str:
    return user.get_full_name().strip() or user.email or user.username


def message_verrou(ressource_type: str, nom: str) -> str:
    label = 'ce contact' if ressource_type == VerrouEdition.RESSOURCE_CLIENT else 'cette transaction'
    return f'{nom} est en train de modifier {label} à l\'instant, patientez.'


def lister_verrous_actifs(org) -> list[dict]:
    _nettoyer_verrous_expires()
    now = timezone.now()
    verrous = VerrouEdition.objects.filter(
        organisation=org,
        expire_le__gt=now,
    ).order_by('ressource_type', 'ressource_id')
    return [
        {
            'ressourceType': v.ressource_type,
            'ressourceId': v.ressource_id,
            'utilisateurId': v.utilisateur_id,
            'utilisateurNom': v.utilisateur_nom,
            'expireLe': v.expire_le.isoformat(),
            'message': message_verrou(v.ressource_type, v.utilisateur_nom),
        }
        for v in verrous
    ]


def acquerir_verrou(org, user, ressource_type: str, ressource_id: str) -> dict:
    if ressource_type not in VALID_RESSOURCE_TYPES:
        raise LockServiceError('Type de ressource invalide.', status=400)

    ressource_id = str(ressource_id).strip()
    if not ressource_id:
        raise LockServiceError('Identifiant de ressource manquant.', status=400)

    _nettoyer_verrous_expires()
    now = timezone.now()
    expire = now + LOCK_DURATION
    nom = _nom_utilisateur(user)

    with transaction.atomic():
        existing = (
            VerrouEdition.objects
            .select_for_update()
            .filter(
                organisation=org,
                ressource_type=ressource_type,
                ressource_id=ressource_id,
            )
            .first()
        )

        if existing:
            if existing.utilisateur_id == user.id:
                existing.expire_le = expire
                existing.utilisateur_nom = nom
                existing.save(update_fields=['expire_le', 'utilisateur_nom'])
                return {'ok': True, 'expireLe': expire.isoformat()}
            if existing.expire_le > now:
                raise LockServiceError(
                    message_verrou(ressource_type, existing.utilisateur_nom),
                    status=423,
                )
            existing.utilisateur = user
            existing.utilisateur_nom = nom
            existing.expire_le = expire
            existing.save(update_fields=['utilisateur', 'utilisateur_nom', 'expire_le'])
            return {'ok': True, 'expireLe': expire.isoformat()}

        try:
            VerrouEdition.objects.create(
                organisation=org,
                ressource_type=ressource_type,
                ressource_id=ressource_id,
                utilisateur=user,
                utilisateur_nom=nom,
                expire_le=expire,
            )
        except IntegrityError as exc:
            # Course : un autre process a créé le verrou entre le SELECT et le INSERT.
            raise LockServiceError(
                'Cette ressource est en cours de modification. Réessayez.',
                status=423,
            ) from exc

    return {'ok': True, 'expireLe': expire.isoformat()}


def liberer_verrou(org, user, ressource_type: str, ressource_id: str) -> None:
    if ressource_type not in VALID_RESSOURCE_TYPES:
        raise LockServiceError('Type de ressource invalide.', status=400)

    ressource_id = str(ressource_id).strip()
    if not ressource_id:
        raise LockServiceError('Identifiant de ressource manquant.', status=400)

    deleted, _ = VerrouEdition.objects.filter(
        organisation=org,
        ressource_type=ressource_type,
        ressource_id=ressource_id,
        utilisateur=user,
    ).delete()
