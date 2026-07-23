from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.template.loader import render_to_string
from django.urls import reverse
from django.utils import timezone
from django.utils.encoding import force_bytes
from django.utils.html import strip_tags
from django.utils.http import urlsafe_base64_encode

from .models import EnvoiEmailJournalier
from .tokens import changement_email_token, confirmation_email_token

APP_NAME = 'Xaliss'


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


def envoyer_mail(
    sujet: str,
    message: str,
    destinataires: list[str],
    html_message: str | None = None,
) -> None:
    """Envoi texte (+ HTML) — même canal SMTP que confirmation / mot de passe oublié."""
    destinataires = [str(e or '').strip() for e in destinataires if str(e or '').strip()]
    if not destinataires:
        raise ValueError('Aucun destinataire e-mail.')
    sujet = ' '.join(str(sujet or '').splitlines()).strip()
    email = EmailMultiAlternatives(
        sujet,
        message,
        getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        destinataires,
    )
    if html_message:
        email.attach_alternative(html_message, 'text/html')
    email.send(fail_silently=False)


# Compatibilité anciens appels
def envoyer_mail_texte(sujet: str, message: str, destinataires: list[str]) -> None:
    envoyer_mail(sujet, message, destinataires)


def envoyer_confirmation_email(request, utilisateur) -> None:
    uidb64 = urlsafe_base64_encode(force_bytes(utilisateur.pk))
    token = confirmation_email_token.make_token(utilisateur)
    path = reverse('confirmer_email', args=[uidb64, token])
    confirmation_url = request.build_absolute_uri(path)
    context = {
        'user': utilisateur,
        'utilisateur': utilisateur,
        'confirmation_url': confirmation_url,
        'app_name': APP_NAME,
    }

    subject = _rendre_template_ou_defaut(
        'comptes/email_confirmation_compte_sujet.txt',
        context,
        f'Confirmez votre compte {APP_NAME}',
    )
    message = _rendre_template_ou_defaut(
        'comptes/email_confirmation_compte.txt',
        context,
        (
            f'Bienvenue sur {APP_NAME}.\n\n'
            'Confirmez votre compte en ouvrant ce lien :\n'
            f'{confirmation_url}\n'
        ),
    )
    html_message = _rendre_template_ou_defaut(
        'comptes/email_confirmation_compte.html',
        context,
        '',
    ) or None

    envoyer_mail(subject, message, [utilisateur.email], html_message=html_message)
    _marquer_email_envoye(utilisateur.email, EnvoiEmailJournalier.TYPE_CONFIRMATION)


def envoyer_confirmation_changement_email(request, utilisateur, nouvel_email: str) -> None:
    nouvel_email = _email_normalise(nouvel_email)
    uidb64 = urlsafe_base64_encode(force_bytes(utilisateur.pk))
    token = changement_email_token.make_token(utilisateur)
    path = reverse('confirmer_changement_email', args=[uidb64, token])
    confirmation_url = request.build_absolute_uri(path)
    context = {
        'user': utilisateur,
        'utilisateur': utilisateur,
        'nouvel_email': nouvel_email,
        'ancien_email': utilisateur.email or '',
        'confirmation_url': confirmation_url,
        'app_name': APP_NAME,
    }

    subject = _rendre_template_ou_defaut(
        'comptes/email_confirmation_changement_sujet.txt',
        context,
        f'Confirmez votre nouvel e-mail — {APP_NAME}',
    )
    message = _rendre_template_ou_defaut(
        'comptes/email_confirmation_changement.txt',
        context,
        (
            f'Bonjour,\n\n'
            f'Vous avez demandé à utiliser {nouvel_email} sur {APP_NAME}.\n'
            f'Confirmez en ouvrant ce lien :\n{confirmation_url}\n'
        ),
    )
    html_message = _rendre_template_ou_defaut(
        'comptes/email_confirmation_changement.html',
        context,
        '',
    ) or None

    envoyer_mail(subject, message, [nouvel_email], html_message=html_message)
    _marquer_email_envoye(nouvel_email, EnvoiEmailJournalier.TYPE_CONFIRMATION)


def envoyer_rappel_note_email(note, utilisateur) -> None:
    """Rappel de note — même design / canal que confirmation et mot de passe oublié."""
    email = (utilisateur.email or '').strip() if utilisateur else ''
    if not email or not note.rappel_le:
        raise ValueError('Destinataire ou date de rappel manquant.')

    titre = (note.titre or 'Note').strip() or 'Note'
    when = timezone.localtime(note.rappel_le)
    when_label = when.strftime('%d/%m/%Y à %H:%M')
    apercu = ' '.join(strip_tags(note.contenu or '').split())
    if len(apercu) > 280:
        apercu = apercu[:279].rstrip() + '…'

    context = {
        'user': utilisateur,
        'utilisateur': utilisateur,
        'note': note,
        'titre': titre,
        'when_label': when_label,
        'apercu': apercu,
        'app_name': APP_NAME,
    }

    subject = _rendre_template_ou_defaut(
        'finances/email_rappel_note_sujet.txt',
        context,
        f'Rappel : {titre} — {APP_NAME}',
    )
    message = _rendre_template_ou_defaut(
        'finances/email_rappel_note.txt',
        context,
        (
            f'Bonjour,\n\n'
            f'Rappel pour votre note « {titre} » ({when_label}).\n\n'
            f'{apercu}\n\n'
            f"L'équipe {APP_NAME}\n"
        ),
    )
    html_message = _rendre_template_ou_defaut(
        'finances/email_rappel_note.html',
        context,
        '',
    ) or None

    envoyer_mail(subject, message, [email], html_message=html_message)
