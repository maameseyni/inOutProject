import secrets
import time

from django.db import IntegrityError
from django.db import transaction as db_transaction
from django.utils import timezone

from finances.models import (
    Notification,
    NotificationIgnoree,
    Sondage,
    SondageOption,
    SondageReponse,
)
from finances.serializers import format_iso_date

MAX_NOTIFICATIONS = 60
ALLOWED_TYPES = {
    Notification.TYPE_SUCCESS,
    Notification.TYPE_ERROR,
    Notification.TYPE_INFO,
    Notification.TYPE_WARNING,
}


class NotificationServiceError(Exception):
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)


def _generate_id() -> str:
    ts = format(int(time.time() * 1000), 'x')
    rnd = secrets.token_hex(3)
    return f'notif_{ts}_{rnd}'


POLL_SYSTEM_PREFIX = 'bo_poll:'


def notification_to_js(notif: Notification, poll_data=None) -> dict:
    data = {
        'id': notif.id,
        'message': notif.message,
        'type': notif.type_notif,
        'systemId': notif.system_id or None,
        'createdAt': format_iso_date(notif.cree_le),
        'read': bool(notif.lu),
    }
    if poll_data is not None:
        data['poll'] = poll_data
    return data


def list_notifications(org, user) -> dict:
    notifications = list(
        Notification.objects.filter(organisation=org, utilisateur=user)
        .order_by('-cree_le')[:MAX_NOTIFICATIONS]
    )
    poll_ids = []
    for notif in notifications:
        if notif.system_id.startswith(POLL_SYSTEM_PREFIX):
            raw_id = notif.system_id[len(POLL_SYSTEM_PREFIX):]
            if raw_id.isdigit():
                poll_ids.append(int(raw_id))

    polls = {
        poll.pk: poll
        for poll in Sondage.objects.filter(pk__in=poll_ids).prefetch_related('options')
    }
    answers = {
        answer.sondage_id: answer.option_id
        for answer in SondageReponse.objects.filter(
            sondage_id__in=poll_ids,
            utilisateur=user,
        )
    }

    serialized = []
    for notif in notifications:
        poll_data = None
        if notif.system_id.startswith(POLL_SYSTEM_PREFIX):
            raw_id = notif.system_id[len(POLL_SYSTEM_PREFIX):]
            poll = polls.get(int(raw_id)) if raw_id.isdigit() else None
            if poll:
                selected_option_id = answers.get(poll.pk)
                poll_data = {
                    'id': poll.pk,
                    'question': poll.question,
                    'active': bool(poll.actif),
                    'answered': selected_option_id is not None,
                    'selectedOptionId': selected_option_id,
                    'options': [
                        {'id': option.pk, 'text': option.texte}
                        for option in poll.options.all()
                    ],
                }
        serialized.append(notification_to_js(notif, poll_data))

    ignored = list(
        NotificationIgnoree.objects.filter(
            organisation=org,
            utilisateur=user,
        ).values_list('system_id', flat=True)
    )
    return {
        'notifications': serialized,
        'ignoredSystemIds': ignored,
    }


def _trim_overflow(org, user) -> None:
    ids = list(
        Notification.objects.filter(organisation=org, utilisateur=user)
        .order_by('-cree_le')
        .values_list('id', flat=True)
    )
    if len(ids) <= MAX_NOTIFICATIONS:
        return
    overflow = ids[MAX_NOTIFICATIONS:]
    Notification.objects.filter(id__in=overflow).delete()


def create_notification(org, user, data: dict) -> dict | None:
    message = str(data.get('message') or '').strip()
    if not message:
        raise NotificationServiceError('Le message est obligatoire.')

    type_notif = str(data.get('type') or Notification.TYPE_INFO).strip().lower()
    if type_notif not in ALLOWED_TYPES:
        type_notif = Notification.TYPE_INFO

    system_id = str(data.get('systemId') or '').strip()[:160]
    notif_id = str(data.get('id') or '').strip() or _generate_id()

    if system_id:
        if NotificationIgnoree.objects.filter(
            organisation=org,
            utilisateur=user,
            system_id=system_id,
        ).exists():
            return None
        existing = Notification.objects.filter(
            organisation=org,
            utilisateur=user,
            system_id=system_id,
        ).first()
        if existing:
            return notification_to_js(existing)

    already_read = bool(data.get('read'))

    with db_transaction.atomic():
        notif = Notification.objects.create(
            id=notif_id,
            organisation=org,
            utilisateur=user,
            message=message[:2000],
            type_notif=type_notif,
            system_id=system_id,
            lu=already_read,
            cree_le=timezone.now(),
        )
        _trim_overflow(org, user)

    return notification_to_js(notif)


def _ignorer_system_ids(org, user, system_ids: list[str]) -> None:
    now = timezone.now()
    for sid in system_ids:
        sid = str(sid or '').strip()[:160]
        if not sid:
            continue
        NotificationIgnoree.objects.get_or_create(
            organisation=org,
            utilisateur=user,
            system_id=sid,
            defaults={'ignoree_le': now},
        )


def mark_notifications_read(org, user) -> int:
    """Marque toutes les notifications comme lues (sans les supprimer)."""
    return Notification.objects.filter(
        organisation=org,
        utilisateur=user,
        lu=False,
    ).update(lu=True)


def clear_notifications(org, user) -> int:
    qs = Notification.objects.filter(organisation=org, utilisateur=user)
    system_ids = [
        sid for sid in qs.exclude(system_id='').values_list('system_id', flat=True)
    ]
    _ignorer_system_ids(org, user, system_ids)
    deleted, _ = qs.delete()
    return deleted


def delete_notification(org, user, notif_id: str) -> None:
    notif = Notification.objects.filter(
        pk=notif_id,
        organisation=org,
        utilisateur=user,
    ).first()
    if not notif:
        raise NotificationServiceError('Notification introuvable.', status=404)
    if notif.system_id:
        _ignorer_system_ids(org, user, [notif.system_id])
    notif.delete()


def remove_by_system_id_prefix(org, user, prefix: str) -> int:
    needle = str(prefix or '').strip()
    if not needle:
        return 0
    qs = Notification.objects.filter(
        organisation=org,
        utilisateur=user,
        system_id__startswith=needle,
    )
    system_ids = list(qs.exclude(system_id='').values_list('system_id', flat=True))
    _ignorer_system_ids(org, user, system_ids)
    deleted, _ = qs.delete()
    # Aussi retirer les ignores du préfixe si on "dismiss because resolved"
    # Non : on garde les ignores. Pour profil complet, on veut juste supprimer
    # les notifs actives ; le préfixe change chaque lundi donc OK.
    return deleted


def migrate_notifications(org, user, items: list) -> dict:
    """Importe un historique local une seule fois (dédupliqué par systemId / id)."""
    created = 0
    for raw in items or []:
        if not isinstance(raw, dict):
            continue
        try:
            result = create_notification(org, user, {
                'id': raw.get('id'),
                'message': raw.get('message'),
                'type': raw.get('type'),
                'systemId': raw.get('systemId'),
                'read': raw.get('read'),
            })
            if result:
                created += 1
        except NotificationServiceError:
            continue
    return list_notifications(org, user) | {'migrated': created}


def _active_notification_targets():
    """Retourne une organisation principale par utilisateur actif."""
    from django.db.models import Case, IntegerField, When

    from comptes.models import MembreOrganisation

    membres = (
        MembreOrganisation.objects.filter(
            actif=True,
            utilisateur__is_active=True,
        )
        .select_related('organisation', 'utilisateur')
        .order_by(
            'utilisateur_id',
            Case(
                When(role=MembreOrganisation.ROLE_PROPRIETAIRE, then=0),
                When(role=MembreOrganisation.ROLE_ADMIN, then=1),
                default=2,
                output_field=IntegerField(),
            ),
            'pk',
        )
    )

    targets = []
    seen_users = set()
    for membre in membres.iterator(chunk_size=500):
        uid = membre.utilisateur_id
        if uid in seen_users:
            continue
        seen_users.add(uid)
        targets.append((membre.organisation_id, uid))
    return targets


def broadcast_notification_to_all_users(*, message: str, type_notif: str = 'info') -> dict:
    """
    Crée une notification in-app pour chaque utilisateur actif membre d’une org.
    Une notif par user (org « principale » : propriétaire > admin > membre).
    """
    text = str(message or '').strip()
    if not text:
        raise NotificationServiceError('Le message est obligatoire.')
    text = text[:2000]

    kind = str(type_notif or Notification.TYPE_INFO).strip().lower()
    if kind not in ALLOWED_TYPES:
        kind = Notification.TYPE_INFO

    targets = _active_notification_targets()

    if not targets:
        return {'created': 0, 'destinataires': 0}

    now = timezone.now()
    batch_id = f'bo_bcast_{format(int(time.time() * 1000), "x")}'
    rows = [
        Notification(
            id=f'{batch_id}_{uid}_{_generate_id()[-8:]}',
            organisation_id=org_id,
            utilisateur_id=uid,
            message=text,
            type_notif=kind,
            system_id=f'{batch_id}_{uid}',
            lu=False,
            cree_le=now,
        )
        for org_id, uid in targets
    ]

    with db_transaction.atomic():
        Notification.objects.bulk_create(rows, batch_size=200)

    return {'created': len(rows), 'destinataires': len(targets), 'batch_id': batch_id}


def create_poll_and_broadcast(*, question: str, choices, created_by=None) -> dict:
    """Crée un sondage à choix unique et sa notification pour chaque utilisateur."""
    text = str(question or '').strip()
    if not text:
        raise NotificationServiceError('La question est obligatoire.')
    if len(text) > 300:
        raise NotificationServiceError('La question ne peut pas dépasser 300 caractères.')

    cleaned_choices = []
    seen = set()
    for raw_choice in choices or []:
        choice = str(raw_choice or '').strip()
        if not choice:
            continue
        if len(choice) > 160:
            raise NotificationServiceError(
                'Chaque choix ne peut pas dépasser 160 caractères.'
            )
        normalized = choice.casefold()
        if normalized in seen:
            raise NotificationServiceError('Les choix doivent être différents.')
        seen.add(normalized)
        cleaned_choices.append(choice)

    if not 2 <= len(cleaned_choices) <= 5:
        raise NotificationServiceError('Ajoutez entre 2 et 5 choix.')

    targets = _active_notification_targets()
    if not targets:
        raise NotificationServiceError('Aucun destinataire actif trouvé.')

    now = timezone.now()
    with db_transaction.atomic():
        poll = Sondage.objects.create(
            question=text,
            cree_par=created_by,
            cree_le=now,
        )
        SondageOption.objects.bulk_create(
            [
                SondageOption(sondage=poll, texte=choice, ordre=index)
                for index, choice in enumerate(cleaned_choices, start=1)
            ]
        )
        system_id = f'{POLL_SYSTEM_PREFIX}{poll.pk}'
        rows = [
            Notification(
                id=f'bo_poll_{poll.pk}_{uid}_{_generate_id()[-8:]}',
                organisation_id=org_id,
                utilisateur_id=uid,
                message=text,
                type_notif=Notification.TYPE_INFO,
                system_id=system_id,
                lu=False,
                cree_le=now,
            )
            for org_id, uid in targets
        ]
        Notification.objects.bulk_create(rows, batch_size=200)

    return {
        'poll_id': poll.pk,
        'created': len(rows),
        'destinataires': len(targets),
    }


def vote_poll(*, org, user, poll_id, option_id) -> dict:
    """Crée ou modifie la réponse si le sondage a été reçu par ce compte."""
    notification_exists = Notification.objects.filter(
        organisation=org,
        utilisateur=user,
        system_id=f'{POLL_SYSTEM_PREFIX}{poll_id}',
    ).exists()
    if not notification_exists:
        raise NotificationServiceError('Sondage introuvable.', status=404)

    poll = Sondage.objects.filter(pk=poll_id).first()
    if not poll:
        raise NotificationServiceError('Sondage introuvable.', status=404)
    if not poll.actif:
        raise NotificationServiceError('Ce sondage est terminé.')

    option = SondageOption.objects.filter(pk=option_id, sondage=poll).first()
    if not option:
        raise NotificationServiceError('Choix invalide.')

    existing = SondageReponse.objects.filter(
        sondage=poll,
        utilisateur=user,
    ).select_related('option').first()
    if existing:
        modified = existing.option_id != option.pk
        if modified:
            existing.option = option
            existing.repondu_le = timezone.now()
            existing.save(update_fields=['option', 'repondu_le'])
        return {
            'pollId': poll.pk,
            'answered': True,
            'selectedOptionId': existing.option_id,
            'modified': modified,
            'message': (
                'Votre réponse a été modifiée.'
                if modified
                else 'Cette réponse est déjà sélectionnée.'
            ),
        }

    try:
        with db_transaction.atomic():
            answer = SondageReponse.objects.create(
                sondage=poll,
                option=option,
                utilisateur=user,
            )
    except IntegrityError:
        answer = SondageReponse.objects.get(sondage=poll, utilisateur=user)
        if answer.option_id != option.pk:
            answer.option = option
            answer.repondu_le = timezone.now()
            answer.save(update_fields=['option', 'repondu_le'])

    return {
        'pollId': poll.pk,
        'answered': True,
        'selectedOptionId': answer.option_id,
        'modified': False,
        'message': 'Merci, votre réponse a été enregistrée.',
    }
