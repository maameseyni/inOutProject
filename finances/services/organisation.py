from io import BytesIO

from django.core.files.base import ContentFile
from django.urls import reverse
from PIL import Image, UnidentifiedImageError

from finances.serializers import organisation_profile_from_js, organisation_profile_to_js
from finances.services.sync import notifier_changement_organisation

LOGO_MAX_UPLOAD_BYTES = 500 * 1024
LOGO_MAX_DIMENSION = 800
LOGO_MIN_RECOMMENDED = 200
LOGO_ALLOWED_CONTENT_TYPES = frozenset({
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
})


class OrganisationServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def has_custom_logo(org) -> bool:
    return bool(org.logo_facture)


def logo_warnings(width: int, height: int) -> list[str]:
    warnings = []
    if max(width, height) < LOGO_MIN_RECOMMENDED:
        warnings.append(
            'Résolution faible : pour un rendu net sur la facture, privilégiez au moins 200 px de large.'
        )
    if height > width * 2:
        warnings.append(
            'Logo très vertical : un format horizontal ou carré sera plus lisible sur la facture.'
        )
    return warnings


def build_logo_url(org, request) -> str:
    if not org.logo_facture:
        return ''
    base = request.build_absolute_uri(reverse('finances:api_organisation_logo'))
    version = int(org.modifie_le.timestamp()) if org.modifie_le else 0
    return f'{base}?v={version}'


def get_profile(org, request=None) -> dict:
    profil = organisation_profile_to_js(org)
    profil['hasCustomLogo'] = has_custom_logo(org)
    profil['logoUrl'] = build_logo_url(org, request) if request and has_custom_logo(org) else ''
    return profil


def update_profile(org, data: dict, request=None) -> dict:
    parsed = organisation_profile_from_js(data)
    org.nom = parsed['nom']
    org.adresse = parsed['adresse']
    org.telephone = parsed['telephone']
    org.email = parsed['email']
    org.site_web = parsed['site_web']
    if parsed['libelle_devise'] is not None:
        org.libelle_devise = parsed['libelle_devise']
    if parsed['rafraichissement_auto'] is not None:
        org.rafraichissement_auto = parsed['rafraichissement_auto']
    org.save()
    notifier_changement_organisation(org)
    return get_profile(org, request=request)


def _delete_logo_file(org) -> None:
    if not org.logo_facture:
        return
    org.logo_facture.delete(save=False)
    org.logo_facture = None


def delete_logo(org, request=None) -> dict:
    if org.logo_facture:
        _delete_logo_file(org)
        org.save(update_fields=['logo_facture', 'modifie_le'])
        notifier_changement_organisation(org)
    return get_profile(org, request=request)


def upload_logo(org, uploaded_file, request=None) -> tuple[dict, list[str]]:
    if not uploaded_file:
        raise OrganisationServiceError('Fichier logo manquant.')

    size = getattr(uploaded_file, 'size', 0) or 0
    if size > LOGO_MAX_UPLOAD_BYTES:
        raise OrganisationServiceError('Logo trop lourd (max 500 Ko).')

    content_type = (getattr(uploaded_file, 'content_type', '') or '').lower()
    if content_type and content_type not in LOGO_ALLOWED_CONTENT_TYPES:
        raise OrganisationServiceError('Format non supporté. Utilisez PNG, JPG ou WebP.')

    try:
        uploaded_file.seek(0)
        image = Image.open(uploaded_file)
        image.load()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise OrganisationServiceError('Fichier image invalide.') from exc

    original_width, original_height = image.size
    warnings = logo_warnings(original_width, original_height)

    if image.mode not in ('RGB', 'RGBA'):
        image = image.convert('RGBA')
    elif image.mode == 'RGB':
        image = image.convert('RGBA')

    max_side = max(original_width, original_height)
    if max_side > LOGO_MAX_DIMENSION:
        ratio = LOGO_MAX_DIMENSION / max_side
        image = image.resize(
            (max(1, int(original_width * ratio)), max(1, int(original_height * ratio))),
            Image.Resampling.LANCZOS,
        )

    buffer = BytesIO()
    image.save(buffer, format='PNG', optimize=True)
    if buffer.tell() > LOGO_MAX_UPLOAD_BYTES:
        raise OrganisationServiceError(
            'Logo trop lourd après traitement. Utilisez une image plus simple ou plus petite.'
        )

    _delete_logo_file(org)
    buffer.seek(0)
    org.logo_facture.save('logo.png', ContentFile(buffer.read()), save=True)
    org.save(update_fields=['logo_facture', 'modifie_le'])
    notifier_changement_organisation(org)
    return get_profile(org, request=request), warnings
