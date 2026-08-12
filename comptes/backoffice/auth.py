"""Auth garde-barrière backoffice."""
from functools import wraps

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.core.cache import cache
from django.shortcuts import render

_CACHE_KEY = 'bo_acces_emails_db'
_CACHE_TTL = 60


def emails_backoffice_env():
    """E-mails bootstrap via BACKOFFICE_ALLOWED_EMAILS (.env)."""
    raw = getattr(settings, 'BACKOFFICE_ALLOWED_EMAILS', '') or ''
    if isinstance(raw, (list, tuple, set)):
        return {str(e).strip().lower() for e in raw if str(e).strip()}
    return {e.strip().lower() for e in str(raw).split(',') if e.strip()}


def emails_backoffice_db(*, use_cache=True):
    """E-mails actifs gérés depuis le backoffice (table AccesBackoffice)."""
    if use_cache:
        cached = cache.get(_CACHE_KEY)
        if cached is not None:
            return set(cached)
    try:
        from comptes.models import AccesBackoffice

        emails = set(
            AccesBackoffice.objects.filter(actif=True)
            .values_list('email', flat=True)
        )
        emails = {str(e).strip().lower() for e in emails if str(e).strip()}
    except Exception:
        # Migration pas encore appliquée, etc.
        emails = set()
    if use_cache:
        cache.set(_CACHE_KEY, list(emails), _CACHE_TTL)
    return emails


def invalider_cache_acces_backoffice():
    cache.delete(_CACHE_KEY)


def emails_backoffice_autorises():
    """Union .env + base : un seul endroit pour la garde d’accès."""
    return emails_backoffice_env() | emails_backoffice_db()


def backoffice_required(view_func):
    """Accès réservé aux e-mails autorisés (.env et/ou AccesBackoffice)."""

    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return redirect_to_login(request.get_full_path(), login_url='connexion')
        email = (getattr(user, 'email', None) or user.get_username() or '').strip().lower()
        if email not in emails_backoffice_autorises():
            return render(
                request,
                'backoffice/acces_refuse.html',
                {'email': email},
                status=403,
            )
        return view_func(request, *args, **kwargs)

    return _wrapped
