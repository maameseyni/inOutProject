"""Auth garde-barrière backoffice."""
from functools import wraps

from django.conf import settings
from django.contrib.auth.views import redirect_to_login
from django.http import HttpResponseForbidden


def emails_backoffice_autorises():
    raw = getattr(settings, 'BACKOFFICE_ALLOWED_EMAILS', '') or ''
    if isinstance(raw, (list, tuple, set)):
        return {str(e).strip().lower() for e in raw if str(e).strip()}
    return {e.strip().lower() for e in str(raw).split(',') if e.strip()}


def backoffice_required(view_func):
    """Accès réservé aux e-mails listés dans BACKOFFICE_ALLOWED_EMAILS."""

    @wraps(view_func)
    def _wrapped(request, *args, **kwargs):
        user = request.user
        if not user.is_authenticated:
            return redirect_to_login(request.get_full_path(), login_url='connexion')
        email = (getattr(user, 'email', None) or user.get_username() or '').strip().lower()
        if email not in emails_backoffice_autorises():
            return HttpResponseForbidden(
                'Accès réservé. Ce compte n’est pas autorisé au backoffice.'
            )
        return view_func(request, *args, **kwargs)

    return _wrapped
