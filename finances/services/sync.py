from django.db.models import F

from comptes.models import Organisation


def get_sync_seq(org: Organisation) -> int:
    return Organisation.objects.filter(pk=org.pk).values_list('sync_seq', flat=True).first() or 0


def notifier_changement_organisation(org: Organisation) -> int:
    Organisation.objects.filter(pk=org.pk).update(sync_seq=F('sync_seq') + 1)
    return get_sync_seq(org)
