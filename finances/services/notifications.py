import secrets
import time

from django.db import transaction as db_transaction
from django.utils import timezone

from finances.models import Notification, NotificationIgnoree
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


def notification_to_js(notif: Notification) -> dict:
    return {
        'id': notif.id,
        'message': notif.message,
        'type': notif.type_notif,
        'systemId': notif.system_id or None,
        'createdAt': format_iso_date(notif.cree_le),
    }


def list_notifications(org, user) -> dict:
    qs = (
        Notification.objects.filter(organisation=org, utilisateur=user)
        .order_by('-cree_le')[:MAX_NOTIFICATIONS]
    )
    ignored = list(
        NotificationIgnoree.objects.filter(
            organisation=org,
            utilisateur=user,
        ).values_list('system_id', flat=True)
    )
    return {
        'notifications': [notification_to_js(n) for n in qs],
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

    with db_transaction.atomic():
        notif = Notification.objects.create(
            id=notif_id,
            organisation=org,
            utilisateur=user,
            message=message[:2000],
            type_notif=type_notif,
            system_id=system_id,
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
            })
            if result:
                created += 1
        except NotificationServiceError:
            continue
    return list_notifications(org, user) | {'migrated': created}
