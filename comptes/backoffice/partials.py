"""Helpers partial / soft-nav (HTML fragments & JSON)."""


def request_wants_ajax(request):
    """True si appel fetch/XHR (soft-nav, partials, actions JSON)."""
    if request.headers.get('X-Requested-With') == 'XMLHttpRequest':
        return True
    if (request.headers.get('X-BO-Partial') or '').strip() in ('1', 'true', 'yes'):
        return True
    accept = (request.headers.get('Accept') or '').lower()
    if 'application/json' in accept and 'text/html' not in accept:
        return True
    return False


def partial_kind(request):
    """
    Kind de fragment demandé :
    - users / payments : partials légers (listes seules)
    - refresh : tous les panneaux (changement de période)
    - '' : page HTML complète
    """
    raw = (request.GET.get('partial') or '').strip().lower()
    if raw in ('users', 'user', 'utilisateurs'):
        return 'users'
    if raw in ('payments', 'payment', 'paiements', 'pay'):
        return 'payments'
    if raw in ('finances', 'finance', 'charges', 'charge'):
        return 'finances'
    if raw in ('refresh', 'main', '1', 'all', 'shell'):
        return 'refresh'
    if (request.headers.get('X-BO-Partial') or '').strip() in ('1', 'true', 'yes'):
        return 'refresh'
    return ''
