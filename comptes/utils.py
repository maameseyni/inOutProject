from django.conf import settings
from django.contrib import auth
from django.contrib.auth import get_user_model
from django.utils.text import slugify

from .models import MembreOrganisation, Organisation

User = get_user_model()


def connecter_utilisateur(request, user):
    """Connexion session — backend requis avec plusieurs AUTHENTICATION_BACKENDS."""
    backend = getattr(user, 'backend', None) or settings.AUTHENTICATION_BACKENDS[0]
    auth.login(request, user, backend=backend)


def _slug_organisation_unique(nom: str) -> str:
    base = slugify(nom) or 'entreprise'
    slug = base
    n = 2
    while Organisation.objects.filter(slug=slug).exists():
        slug = f'{base}-{n}'
        n += 1
    return slug


def provisionner_organisation_si_absente(utilisateur):
    """Crée une organisation minimale (ex. première connexion Google)."""
    if utilisateur.membres_organisations.filter(actif=True).exists():
        return False

    nom = utilisateur.get_full_name().strip() or utilisateur.email.split('@')[0]
    organisation = Organisation.objects.create(
        slug=_slug_organisation_unique(nom),
        nom=nom,
        email=utilisateur.email or '',
        telephone='',
    )
    MembreOrganisation.objects.create(
        utilisateur=utilisateur,
        organisation=organisation,
        role=MembreOrganisation.ROLE_PROPRIETAIRE,
    )
    return True


def get_organisation_active(request):
    """Organisation active de l'utilisateur connecté (première pour l'instant)."""
    if not request.user.is_authenticated:
        return None, None
    membre = (
        request.user.membres_organisations
        .filter(actif=True)
        .select_related('organisation')
        .first()
    )
    if not membre:
        return None, None
    return membre.organisation, membre


def utilisateur_a_organisation(request):
    if not request.user.is_authenticated:
        return False
    return MembreOrganisation.objects.filter(
        utilisateur_id=request.user.pk,
        actif=True,
    ).exists()


def assurer_espace_utilisateur(utilisateur) -> bool:
    """Crée une organisation minimale si besoin. Retourne True si créée à l'instant."""
    if MembreOrganisation.objects.filter(utilisateur=utilisateur, actif=True).exists():
        return False
    provisionner_organisation_si_absente(utilisateur)
    return True


def nom_affichage_utilisateur(user):
    nom = user.get_full_name().strip()
    return nom or user.email
