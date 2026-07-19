from functools import wraps

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import redirect

from comptes.utils import get_organisation_active, utilisateur_a_organisation


def organisation_required(view_func):
    """Décorateur API : attache organisation et membre à la requête, sinon 403 JSON."""

    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        organisation, membre = get_organisation_active(request)
        if not organisation:
            return JsonResponse(
                {'erreur': 'Organisation introuvable ou accès refusé.'},
                status=403,
            )
        request.organisation = organisation
        request.membre = membre
        return view_func(request, *args, **kwargs)

    return wrapper


def login_organisation_required(view_func):
    """Décorateur vues page : connexion + organisation active requises."""

    @wraps(view_func)
    @login_required
    def wrapper(request, *args, **kwargs):
        if not utilisateur_a_organisation(request):
            return redirect('completer_inscription')
        organisation, membre = get_organisation_active(request)
        if not organisation:
            return redirect('completer_inscription')
        request.organisation = organisation
        request.membre = membre
        return view_func(request, *args, **kwargs)

    return wrapper
