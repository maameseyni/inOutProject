from datetime import datetime, timedelta, timezone as dt_timezone

from django.utils import timezone

from finances.serializers import parse_iso_date


class OptimisticLockError(Exception):
    def __init__(self, message: str = 'Quelqu\'un d\'autre a modifié cette donnée. Rechargez avant de réenregistrer.'):
        self.message = message
        self.status = 409
        super().__init__(message)


def _normaliser_ts(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=dt_timezone.utc)
    return dt.astimezone(dt_timezone.utc)


def verifier_verrou_optimiste(instance, data: dict) -> None:
    """Rejette si modifie_le serveur est plus récent que updatedAt client."""
    if 'updatedAt' not in data:
        return

    client_ts = parse_iso_date(data.get('updatedAt'))
    server_ts = getattr(instance, 'modifie_le', None)
    if not client_ts or not server_ts:
        return

    # Les timestamps envoyés au navigateur sont généralement arrondis à la
    # milliseconde, alors que Django/PostgreSQL conservent les microsecondes.
    # Sans tolérance, une donnée fraîchement chargée peut déclencher un faux
    # conflit à cause de quelques microsecondes.
    if _normaliser_ts(server_ts) > _normaliser_ts(client_ts) + timedelta(milliseconds=1):
        raise OptimisticLockError()
