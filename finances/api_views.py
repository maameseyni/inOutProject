import json
import time

from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse, StreamingHttpResponse
from django.views.decorators.csrf import csrf_protect
from django.views.decorators.http import require_http_methods

from comptes.permissions import (
    PERM_CLIENT_ECRIRE,
    PERM_CLIENT_SUPPRIMER,
    PERM_ORGANISATION_MODIFIER,
    PERM_TRANSACTION_ECRIRE,
    PERM_TRANSACTION_SUPPRIMER,
    membre_a_permission,
)
from finances.decorators import organisation_required
from finances.services import clients as client_service
from finances.services import categories as category_service
from finances.services import locks as lock_service
from finances.services import notes as note_service
from finances.services import organisation as org_service
from finances.services import sync as sync_service
from finances.services import transactions as tx_service
from finances.services import utilisateur as user_service


def _parse_json_body(request):
    if not request.body:
        return {}
    try:
        return json.loads(request.body.decode('utf-8'))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None


def _service_error_response(exc):
    return JsonResponse({'erreur': exc.message}, status=exc.status)


def _permission_denied():
    return JsonResponse(
        {'erreur': 'Vous n\'avez pas la permission pour cette action.'},
        status=403,
    )


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['GET', 'POST'])
def transactions_list_create(request):
    org = request.organisation

    if request.method == 'GET':
        return JsonResponse({'transactions': tx_service.list_transactions(org)})

    if not membre_a_permission(request.membre, PERM_TRANSACTION_ECRIRE):
        return _permission_denied()

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        transaction = tx_service.create_transaction(
            org, request.user, request.membre, data,
        )
    except tx_service.TransactionServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'transaction': transaction}, status=201)


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['PATCH', 'DELETE'])
def transaction_detail(request, transaction_id):
    org = request.organisation

    if request.method == 'DELETE':
        if not membre_a_permission(request.membre, PERM_TRANSACTION_SUPPRIMER):
            return _permission_denied()
        try:
            tx_service.delete_transaction(org, transaction_id)
        except tx_service.TransactionServiceError as exc:
            return _service_error_response(exc)
        return JsonResponse({'succes': True})

    if not membre_a_permission(request.membre, PERM_TRANSACTION_ECRIRE):
        return _permission_denied()

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        transaction = tx_service.update_transaction(org, transaction_id, data)
    except tx_service.TransactionServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'transaction': transaction})


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['POST'])
def transaction_completer(request, transaction_id):
    org = request.organisation
    if not membre_a_permission(request.membre, PERM_TRANSACTION_ECRIRE):
        return _permission_denied()
    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        transaction = tx_service.complete_transaction(
            org,
            request.user,
            request.membre,
            transaction_id,
            data.get('amount'),
            data.get('date'),
            data,
        )
    except tx_service.TransactionServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'transaction': transaction})


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['GET', 'POST'])
def clients_list_create(request):
    org = request.organisation

    if request.method == 'GET':
        return JsonResponse({'clients': client_service.list_clients(org)})

    if not membre_a_permission(request.membre, PERM_CLIENT_ECRIRE):
        return _permission_denied()

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        client = client_service.create_client(org, data)
    except client_service.ClientServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'client': client}, status=201)


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['PATCH', 'DELETE'])
def client_detail(request, client_id):
    org = request.organisation

    if request.method == 'DELETE':
        if not membre_a_permission(request.membre, PERM_CLIENT_SUPPRIMER):
            return _permission_denied()
        try:
            client_service.delete_client(org, client_id)
        except client_service.ClientServiceError as exc:
            return _service_error_response(exc)
        return JsonResponse({'succes': True})

    if not membre_a_permission(request.membre, PERM_CLIENT_ECRIRE):
        return _permission_denied()

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        client = client_service.update_client(org, client_id, data)
    except client_service.ClientServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'client': client})


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['GET', 'POST'])
def notes_list_create(request):
    org = request.organisation

    if request.method == 'GET':
        return JsonResponse({'notes': note_service.list_notes(org)})

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        note = note_service.create_note(org, data)
    except note_service.NoteServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'note': note}, status=201)


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['PATCH', 'DELETE'])
def note_detail(request, note_id):
    org = request.organisation

    if request.method == 'DELETE':
        try:
            note_service.delete_note(org, note_id)
        except note_service.NoteServiceError as exc:
            return _service_error_response(exc)
        return JsonResponse({'succes': True})

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        note = note_service.update_note(org, note_id, data)
    except note_service.NoteServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'note': note})


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['GET', 'PATCH'])
def categories_list_replace(request):
    org = request.organisation

    if request.method == 'GET':
        return JsonResponse({'categories': category_service.list_categories(org)})

    if not membre_a_permission(request.membre, PERM_ORGANISATION_MODIFIER):
        return _permission_denied()

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        categories = category_service.replace_categories(org, data)
    except category_service.CategorieServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'categories': categories})


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['GET', 'PATCH'])
def organisation_profil(request):
    org = request.organisation

    if request.method == 'GET':
        return JsonResponse({'profil': org_service.get_profile(org)})

    if not membre_a_permission(request.membre, PERM_ORGANISATION_MODIFIER):
        return _permission_denied()

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        profil = org_service.update_profile(org, data)
    except org_service.OrganisationServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'profil': profil})


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['GET', 'PATCH'])
def utilisateur_profil(request):
    org = request.organisation
    membre = request.membre
    user = request.user

    if request.method == 'GET':
        return JsonResponse({'profil': user_service.get_profil(user, org, membre)})

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        profil = user_service.update_profil(user, org, membre, data)
    except user_service.UtilisateurServiceError as exc:
        return _service_error_response(exc)

    return JsonResponse({'profil': profil})


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['POST'])
def utilisateur_mot_de_passe(request):
    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    try:
        user_service.changer_mot_de_passe(request.user, data)
    except user_service.UtilisateurServiceError as exc:
        return _service_error_response(exc)

    update_session_auth_hash(request, request.user)
    return JsonResponse({'succes': True, 'hasPassword': True})


@login_required
@organisation_required
@require_http_methods(['GET'])
def sync_status(request):
    org = request.organisation
    return JsonResponse({'syncSeq': sync_service.get_sync_seq(org)})


@login_required
@organisation_required
@require_http_methods(['GET'])
def evenements_sync(request):
    org = request.organisation

    def event_stream():
        last_seq = sync_service.get_sync_seq(org)
        yield f'data: {json.dumps({"type": "init", "syncSeq": last_seq})}\n\n'
        while True:
            time.sleep(2)
            current = sync_service.get_sync_seq(org)
            if current != last_seq:
                payload = json.dumps({'type': 'sync', 'syncSeq': current})
                yield f'data: {payload}\n\n'
                last_seq = current

    response = StreamingHttpResponse(event_stream(), content_type='text/event-stream')
    response['Cache-Control'] = 'no-cache'
    response['X-Accel-Buffering'] = 'no'
    return response


@login_required
@organisation_required
@csrf_protect
@require_http_methods(['GET', 'POST', 'DELETE'])
def verrous_edition(request):
    org = request.organisation

    if request.method == 'GET':
        return JsonResponse({'verrous': lock_service.lister_verrous_actifs(org)})

    data = _parse_json_body(request)
    if data is None:
        return JsonResponse({'erreur': 'Corps JSON invalide.'}, status=400)

    ressource_type = str(data.get('ressourceType') or '').strip()
    ressource_id = str(data.get('ressourceId') or '').strip()
    org = request.organisation

    if request.method == 'POST':
        try:
            result = lock_service.acquerir_verrou(
                org, request.user, ressource_type, ressource_id,
            )
        except lock_service.LockServiceError as exc:
            return _service_error_response(exc)
        return JsonResponse(result)

    try:
        lock_service.liberer_verrou(org, request.user, ressource_type, ressource_id)
    except lock_service.LockServiceError as exc:
        return _service_error_response(exc)
    return JsonResponse({'succes': True})
