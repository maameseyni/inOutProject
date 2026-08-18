"""Middleware abonnements SaaS."""
from comptes.models import AbonnementOrganisation
from comptes.utils import get_organisation_active


class SynchroniserAbonnementMiddleware:
    """
    À chaque requête authentifiée, aligne le statut d'abonnement de l'orga active
    (essai → expire, actif → en_retard, grâce 3j → expire).

    Suffit pour les orgas actives sans cron. Le cron reste utile pour les comptes
    inactifs et l'admin.
    """

    SKIP_PREFIXES = (
        '/static/',
        '/media/',
        '/favicon',
        '/robots.txt',
        '/sitemap.xml',
        '/__debug__/',
    )

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        self._maybe_sync(request)
        return self.get_response(request)

    def _maybe_sync(self, request):
        path = getattr(request, 'path', '') or ''
        for prefix in self.SKIP_PREFIXES:
            if path.startswith(prefix):
                return

        user = getattr(request, 'user', None)
        if not user or not user.is_authenticated:
            return

        try:
            organisation, _membre = get_organisation_active(request)
        except Exception:
            return
        if not organisation:
            return

        try:
            abo = organisation.abonnement
        except AbonnementOrganisation.DoesNotExist:
            return
        except Exception:
            return

        try:
            abo.synchroniser_statut(save=True)
        except Exception:
            # Ne jamais bloquer la requête pour un échec de sync abo
            return
