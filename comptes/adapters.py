from django.contrib import messages
from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.urls import reverse

from allauth.account.adapter import DefaultAccountAdapter
from allauth.account.models import EmailAddress
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter

from comptes.utils import assurer_espace_utilisateur, email_deja_utilise, normaliser_email

User = get_user_model()


class XalissAccountAdapter(DefaultAccountAdapter):
    def get_login_redirect_url(self, request):
        return reverse('finances:application')

    def clean_email(self, email):
        email = normaliser_email(super().clean_email(email) or '')
        if not email:
            return email
        if email_deja_utilise(email):
            raise ValidationError('Un compte existe déjà avec cet e-mail.')
        return email


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
        Si l’e-mail Google correspond déjà à un compte local, on rattache
        le social login (un e-mail = un compte) et on marque l’adresse vérifiée.
        """
        if sociallogin.is_existing:
            return

        email = ''
        for addr in sociallogin.email_addresses:
            if addr.email:
                email = normaliser_email(addr.email)
                if getattr(addr, 'verified', False):
                    break
        if not email:
            return

        user = User.objects.filter(email__iexact=email).first()
        if not user:
            user = User.objects.filter(username__iexact=email).first()
        if not user:
            return

        sociallogin.connect(request, user)

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
        email = ''
        for addr in sociallogin.email_addresses:
            if addr.email:
                email = normaliser_email(addr.email)
                break
        if email and email_deja_utilise(email) and not sociallogin.is_existing:
            existing = (
                User.objects.filter(email__iexact=email).first()
                or User.objects.filter(username__iexact=email).first()
            )
            if existing is not None:
                sociallogin.connect(request, existing)
                return existing

        utilisateur = super().save_user(request, sociallogin, form)
        if utilisateur.email:
            norm = normaliser_email(utilisateur.email)
            if utilisateur.email != norm:
                utilisateur.email = norm
                utilisateur.save(update_fields=['email'])
        if not utilisateur.is_active:
            utilisateur.is_active = True
            utilisateur.save(update_fields=['is_active'])
        return utilisateur
