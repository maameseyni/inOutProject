from finances.serializers import organisation_profile_from_js, organisation_profile_to_js
from finances.services.sync import notifier_changement_organisation


class OrganisationServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def get_profile(org) -> dict:
    return organisation_profile_to_js(org)


def update_profile(org, data: dict) -> dict:
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
    return organisation_profile_to_js(org)
