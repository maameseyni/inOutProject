from django.contrib import messages
from django.urls import reverse

from allauth.account.adapter import DefaultAccountAdapter
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter

from comptes.utils import assurer_espace_utilisateur


class XalissAccountAdapter(DefaultAccountAdapter):
    def get_login_redirect_url(self, request):
        return reverse('finances:application')


class XalissSocialAccountAdapter(DefaultSocialAccountAdapter):
    def get_login_redirect_url(self, request):
        nouvel_espace = assurer_espace_utilisateur(request.user)
        if nouvel_espace:
            messages.info(
                request,
                'Vous pouvez compléter votre profil dans Paramètres.',
            )
        else:
            messages.success(request, 'Connexion réussie.')
        return reverse('finances:application')

    def is_auto_signup_allowed(self, request, sociallogin):
        return True

    def save_user(self, request, sociallogin, form=None):
        """Google : compte actif immédiatement, sans confirmation e-mail."""
        utilisateur = super().save_user(request, sociallogin, form)
        if not utilisateur.is_active:
            utilisateur.is_active = True
            utilisateur.save(update_fields=['is_active'])
        return utilisateur
