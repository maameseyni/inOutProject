"""Rate limiting des écritures API /app/api/."""
from comptes.ratelimit_utils import json_429, limited


class ApiWriteRateLimitMiddleware:
    """
    Limite les POST/PATCH/DELETE sur /app/api/ par utilisateur authentifié.
    Les lectures (GET) et le sync restent libres.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if (
            request.path.startswith('/app/api/')
            and request.method not in ('GET', 'HEAD', 'OPTIONS')
            and getattr(request, 'user', None)
            and request.user.is_authenticated
        ):
            path = request.path
            if 'rappels-email' in path:
                group, rate = 'api_note_reminders', '10/h'
            elif 'mot-de-passe' in path:
                group, rate = 'api_password_change', '5/h'
            else:
                group, rate = 'api_writes', '120/m'

            if limited(request, group=group, rate=rate, key='user'):
                return json_429()

        return self.get_response(request)
