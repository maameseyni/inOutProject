from django.conf import settings
from django.contrib import auth
from django.contrib.auth import get_user_model
from django.db.models import Q
from django.utils.text import slugify

from .models import AbonnementOrganisation, MembreOrganisation, Organisation, ProfilUtilisateur

User = get_user_model()


def assurer_abonnement_organisation(organisation):
    """Garantit qu'une organisation a un abonnement SaaS (idempotent)."""
    return AbonnementOrganisation.creer_pour_organisation(organisation)


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
        return

    if verified:
        # Contrainte unique_verified_email : un seul verified=True par adresse.
        EmailAddress.objects.filter(email__iexact=email, verified=True).exclude(
            user=utilisateur,
        ).update(verified=False)

    try:
        EmailAddress.objects.create(
            user=utilisateur,
            email=email,
            verified=verified,
            primary=True,
        )
    except Exception:
        row = EmailAddress.objects.filter(email__iexact=email).first()
        if row is None:
            return
        if row.user_id != utilisateur.pk:
            # Autre compte porte déjà la ligne : on ne force pas le transfert ici.
            return
        row.verified = verified or row.verified
        row.primary = True
        row.save(update_fields=['verified', 'primary'])


def connecter_utilisateur(request, user):
    """Connexion session — backend requis avec plusieurs AUTHENTICATION_BACKENDS."""
    backend = getattr(user, 'backend', None) or settings.AUTHENTICATION_BACKENDS[0]
    auth.login(request, user, backend=backend)
    # Répare les comptes confirmés avant sync allauth (EmailAddress manquant).
    if user.is_active and (user.email or user.username or '').strip():
        try:
            from allauth.account.models import EmailAddress
        except Exception:
            return
        email = normaliser_email(user.email or user.username)
        if email and not EmailAddress.objects.filter(user=user, email__iexact=email).exists():
            synchroniser_email_allauth(user, email, verified=True)


def _slug_organisation_unique(nom: str) -> str:
    base = slugify(nom) or 'entreprise'
    slug = base
    n = 2
    while Organisation.objects.filter(slug=slug).exists():
        slug = f'{base}-{n}'
        n += 1
    return slug


def provisionner_organisation_si_absente(utilisateur):
    """Crée une organisation minimale (ex. première connexion Google).

    Si le compte a déjà des memberships inactives, on réactive celle qui a
    le plus de données — on ne crée JAMAIS une org vide par-dessus.
    """
    if utilisateur.membres_organisations.filter(actif=True).exists():
        return False

    inactifs = list(
        utilisateur.membres_organisations
        .select_related('organisation')
        .order_by('id')
    )
    if inactifs:
        try:
            from finances.models import Transaction
        except Exception:
            Transaction = None
        def _score(m):
            if Transaction is None:
                return 0
            return Transaction.objects.filter(organisation_id=m.organisation_id).count()
        best = max(inactifs, key=_score)
        if not best.actif:
            best.actif = True
            best.save(update_fields=['actif'])
        return False

    nom = utilisateur.get_full_name().strip() or (utilisateur.email or 'entreprise').split('@')[0]
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
    assurer_abonnement_organisation(organisation)
    return True


def get_organisation_active(request):
    """Organisation active de l'utilisateur connecté.

    S'il y a plusieurs memberships actives, on préfère celle qui a le plus
    de transactions (évite d'afficher une org vide créée par erreur).
    """
    if not request.user.is_authenticated:
        return None, None
    membres = list(
        request.user.membres_organisations
        .filter(actif=True)
        .select_related('organisation')
        .order_by('id')
    )
    if not membres:
        return None, None
    if len(membres) == 1:
        return membres[0].organisation, membres[0]

    try:
        from finances.models import Transaction
    except Exception:
        return membres[0].organisation, membres[0]

    best = membres[0]
    best_n = -1
    for m in membres:
        n = Transaction.objects.filter(organisation_id=m.organisation_id).count()
        if n > best_n:
            best_n = n
            best = m
    return best.organisation, best


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
    return bool(provisionner_organisation_si_absente(utilisateur))


def nom_affichage_utilisateur(user):
    nom = user.get_full_name().strip()
    return nom or user.email
