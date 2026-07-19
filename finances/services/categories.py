from comptes.models import Organisation
from finances.services.sync import notifier_changement_organisation


class CategorieServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def _normaliser_nom(value) -> str:
    return ' '.join(str(value or '').strip().split())[:120]


def _normaliser_description(value) -> str:
    return ' '.join(str(value or '').strip().split())[:500]


def _normaliser_categorie(item) -> dict:
    if isinstance(item, dict):
        name = _normaliser_nom(item.get('name') or item.get('nom'))
        description = _normaliser_description(item.get('description') or item.get('note'))
    else:
        name = _normaliser_nom(item)
        description = ''

    return {'name': name, 'description': description}


def _normaliser_liste(raw) -> list[dict]:
    items = raw if isinstance(raw, list) else []
    categories = []
    seen = set()

    for item in items:
        categorie = _normaliser_categorie(item)
        key = categorie['name'].casefold()
        if not categorie['name'] or key in seen:
            continue
        seen.add(key)
        categories.append(categorie)

    return sorted(categories, key=lambda item: item['name'].casefold())


def list_categories(org: Organisation) -> list[dict]:
    return _normaliser_liste(org.categories_produits)


def replace_categories(org: Organisation, data: dict) -> list[dict]:
    categories = _normaliser_liste(data.get('categories') if isinstance(data, dict) else data)
    org.categories_produits = categories
    org.save(update_fields=['categories_produits', 'modifie_le'])
    notifier_changement_organisation(org)
    return categories


def create_category(org: Organisation, data: dict) -> list[dict]:
    categorie = _normaliser_categorie(data)
    if not categorie['name']:
        raise CategorieServiceError('Le nom de la catégorie est obligatoire.')

    categories = list_categories(org)
    if any(existing['name'].casefold() == categorie['name'].casefold() for existing in categories):
        raise CategorieServiceError('Cette catégorie existe déjà.', status=409)

    categories = _normaliser_liste(categories + [categorie])
    org.categories_produits = categories
    org.save(update_fields=['categories_produits', 'modifie_le'])
    notifier_changement_organisation(org)
    return categories


def delete_category(org: Organisation, nom: str) -> list[dict]:
    name = _normaliser_nom(nom)
    categories = list_categories(org)
    next_categories = [item for item in categories if item['name'].casefold() != name.casefold()]
    if len(next_categories) == len(categories):
        raise CategorieServiceError('Catégorie introuvable.', status=404)

    org.categories_produits = next_categories
    org.save(update_fields=['categories_produits', 'modifie_le'])
    notifier_changement_organisation(org)
    return next_categories
