from django.contrib import messages
from django.contrib.auth import get_user_model
from django.urls import reverse

from allauth.account.adapter import DefaultAccountAdapter
from allauth.account.models import EmailAddress
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter

from comptes.utils import assurer_espace_utilisateur

User = get_user_model()


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

    def pre_social_login(self, request, sociallogin):
        """
        Si l’e-mail Google correspond déjà à un compte local, on marque
        l’adresse comme vérifiée pour éviter que allauth efface le mot de passe
        (wipe_password) lors de EMAIL_AUTHENTICATION.
        """
        if sociallogin.is_existing:
            return

        email = ''
        for addr in sociallogin.email_addresses:
            if addr.email:
                email = addr.email.strip()
                if getattr(addr, 'verified', False):
                    break
        if not email:
            return

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            return

        existing = EmailAddress.objects.filter(user=user, email__iexact=email).first()
        if existing:
            if not existing.verified or not existing.primary:
                existing.verified = True
                existing.primary = True
                existing.save(update_fields=['verified', 'primary'])
        else:
            EmailAddress.objects.create(
                user=user,
                email=user.email or email,
                verified=True,
                primary=True,
            )

    def save_user(self, request, sociallogin, form=None):
        """Google : compte actif immédiatement, sans confirmation e-mail."""
        utilisateur = super().save_user(request, sociallogin, form)
        if not utilisateur.is_active:
            utilisateur.is_active = True
            utilisateur.save(update_fields=['is_active'])
        return utilisateur
