DEVISE_CHOICES = [
    ('XOF', 'XOF (FCFA)'),
    ('EUR', 'EUR (Euro)'),
    ('USD', 'USD (Dollar US)'),
    ('GBP', 'GBP (Livre sterling)'),
    ('MAD', 'MAD (Dirham)'),
    ('GNF', 'GNF (Franc guinéen)'),
    ('CHF', 'CHF (Franc suisse)'),
    ('CAD', 'CAD (Dollar canadien)'),
]

DEVISE_CHOICES_AVEC_PLACEHOLDER = [('', 'Choisir une devise'), *DEVISE_CHOICES]

_DEVISES_VALIDES = {code for code, _label in DEVISE_CHOICES}

_DEVISE_ALIAS = {
    'FCFA': 'XOF',
    'CFA': 'XOF',
}


def normaliser_code_devise(value) -> str:
    code = str(value or '').strip().upper()
    code = _DEVISE_ALIAS.get(code, code)
    return code if code in _DEVISES_VALIDES else 'XOF'
