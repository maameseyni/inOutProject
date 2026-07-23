"""Helpers rate limiting (django-ratelimit)."""
from django.contrib import messages
from django.http import JsonResponse
from django_ratelimit.core import is_ratelimited

MESSAGE_429 = 'Trop de tentatives. Réessayez dans quelques minutes.'


def limited(request, *, group: str, rate: str, key: str = 'ip', method=None) -> bool:
    """Incrémente le compteur et retourne True si la limite est dépassée."""
    if key == 'user' and (
        not getattr(request, 'user', None) or not request.user.is_authenticated
    ):
        key = 'ip'
    return is_ratelimited(
        request,
        group=group,
        key=key,
        rate=rate,
        method=method or request.method,
        increment=True,
    )


def flash_429(request, message: str = MESSAGE_429) -> None:
    messages.error(request, message)


def json_429(message: str = MESSAGE_429) -> JsonResponse:
    return JsonResponse({'erreur': message}, status=429)
