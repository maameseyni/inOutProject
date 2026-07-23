from django.conf import settings
from django.contrib import auth
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils.text import slugify

from .models import MembreOrganisation, Organisation, ProfilUtilisateur

User = get_user_model()


def normaliser_email(email: str) -> str:
    return str(email or '').strip().lower()


def email_deja_utilise(email: str, *, exclude_user=None) -> bool:
    """True si l'e-mail (ou username) est déjà pris par un autre compte."""
    email = normaliser_email(email)
    if not email:
        return False

    qs = User.objects.filter(Q(email__iexact=email) | Q(username__iexact=email))
    if exclude_user is not None:
        qs = qs.exclude(pk=exclude_user.pk)
    if qs.exists():
        return True

    pending = ProfilUtilisateur.objects.filter(email_en_attente__iexact=email)
    if exclude_user is not None:
        pending = pending.exclude(utilisateur_id=exclude_user.pk)
    if pending.exists():
        return True

    try:
        from allauth.account.models import EmailAddress

        addr = EmailAddress.objects.filter(email__iexact=email)
        if exclude_user is not None:
            addr = addr.exclude(user_id=exclude_user.pk)
        if addr.exists():
            return True
    except Exception:
        pass

    return False


def synchroniser_email_allauth(utilisateur, email: str, *, verified: bool = True) -> None:
    """Met à jour EmailAddress allauth après confirmation / changement."""
    email = normaliser_email(email)
    if not email:
        return
    try:
        from allauth.account.models import EmailAddress
    except Exception:
        return

    EmailAddress.objects.filter(user=utilisateur, primary=True).exclude(
        email__iexact=email
    ).update(primary=False)

    existing = EmailAddress.objects.filter(user=utilisateur, email__iexact=email).first()
    if existing:
        existing.email = email
        existing.verified = verified or existing.verified
        existing.primary = True
        existing.save(update_fields=['email', 'verified', 'primary'])
    else:
        EmailAddress.objects.create(
            user=utilisateur,
            email=email,
            verified=verified,
            primary=True,
        )


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
