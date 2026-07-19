import json

from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie

from comptes.devises import DEVISE_CHOICES
from comptes.permissions import permissions_pour_frontend
from finances.decorators import login_organisation_required


@login_organisation_required
@ensure_csrf_cookie
def application(request):
    initial_tab = request.GET.get('onglet', 'transactions')
    if initial_tab not in ('transactions', 'statistiques', 'notes', 'parametres'):
        initial_tab = 'transactions'

    return render(request, 'finances/application.html', {
        'organisation': request.organisation,
        'membre': request.membre,
        'permissions_json': json.dumps(permissions_pour_frontend(request.membre)),
        'initial_tab': initial_tab,
        'devise_choices': DEVISE_CHOICES,
    })
