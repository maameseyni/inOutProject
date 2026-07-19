from django.conf import settings
from django.core.mail import send_mail
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.http import urlsafe_base64_encode

from .models import EnvoiEmailJournalier
from .tokens import confirmation_email_token


def _email_normalise(email: str) -> str:
    return str(email or '').strip().lower()


def _journal(email: str, type_email: str):
    return EnvoiEmailJournalier.objects.filter(
        email=_email_normalise(email),
        type_email=type_email,
        date=timezone.localdate(),
    ).first()


def _marquer_email_envoye(email: str, type_email: str) -> None:
    email = _email_normalise(email)
    if not email:
        return

    journal, _created = EnvoiEmailJournalier.objects.get_or_create(
        email=email,
        type_email=type_email,
        date=timezone.localdate(),
        defaults={'nombre': 0},
    )
    journal.nombre += 1
    journal.save(update_fields=['nombre', 'modifie_le'])


def confirmation_email_envoyee_aujourdhui(utilisateur) -> bool:
    journal = _journal(utilisateur.email, EnvoiEmailJournalier.TYPE_CONFIRMATION)
    return bool(journal and journal.nombre > 0)


def quota_mot_de_passe_atteint(email: str) -> bool:
    journal = _journal(email, EnvoiEmailJournalier.TYPE_MOT_DE_PASSE)
    return bool(journal and journal.nombre > 0)


def marquer_mot_de_passe_email_envoye(email: str) -> None:
    _marquer_email_envoye(email, EnvoiEmailJournalier.TYPE_MOT_DE_PASSE)


def _rendre_template_ou_defaut(template_name: str, context: dict, fallback: str) -> str:
    try:
        return render_to_string(template_name, context).strip()
    except Exception:
        return fallback


def envoyer_confirmation_email(request, utilisateur) -> None:
    uidb64 = urlsafe_base64_encode(force_bytes(utilisateur.pk))
    token = confirmation_email_token.make_token(utilisateur)
    path = reverse('confirmer_email', args=[uidb64, token])
    confirmation_url = request.build_absolute_uri(path)
    context = {
        'user': utilisateur,
        'utilisateur': utilisateur,
        'confirmation_url': confirmation_url,
        'app_name': 'Xaliss',
    }

    subject = _rendre_template_ou_defaut(
        'comptes/email_confirmation_compte_sujet.txt',
        context,
        'Confirmez votre compte Xaliss',
    )
    subject = ' '.join(subject.splitlines()).strip()
    message = _rendre_template_ou_defaut(
        'comptes/email_confirmation_compte.txt',
        context,
        (
            'Bienvenue sur Xaliss.\n\n'
            'Confirmez votre compte en ouvrant ce lien :\n'
            f'{confirmation_url}\n'
        ),
    )

    send_mail(
        subject,
        message,
        getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        [utilisateur.email],
        fail_silently=False,
    )
    _marquer_email_envoye(utilisateur.email, EnvoiEmailJournalier.TYPE_CONFIRMATION)
