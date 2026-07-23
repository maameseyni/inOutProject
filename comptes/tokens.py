from django.contrib.auth.tokens import PasswordResetTokenGenerator

from comptes.models import ProfilUtilisateur


class ConfirmationEmailTokenGenerator(PasswordResetTokenGenerator):
    def _make_hash_value(self, user, timestamp):
        email = getattr(user, 'email', '') or ''
        return f'{user.pk}{timestamp}{user.is_active}{email}'


class ChangementEmailTokenGenerator(PasswordResetTokenGenerator):
    def _make_hash_value(self, user, timestamp):
        profil = ProfilUtilisateur.objects.filter(utilisateur_id=user.pk).first()
        pending = (profil.email_en_attente if profil else '') or ''
        current = getattr(user, 'email', '') or ''
        return f'{user.pk}{timestamp}{current}{pending}'


confirmation_email_token = ConfirmationEmailTokenGenerator()
changement_email_token = ChangementEmailTokenGenerator()
