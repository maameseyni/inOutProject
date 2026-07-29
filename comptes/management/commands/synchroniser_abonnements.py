from django.core.management.base import BaseCommand
from django.db.models import Q

from comptes.models import AbonnementOrganisation


class Command(BaseCommand):
    help = (
        'Synchronise les statuts d’abonnement (essai → expire, actif → en_retard, '
        'en_retard hors grâce 3j → expire). À lancer quotidiennement.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Affiche les changements sans écrire en base.',
        )

    def handle(self, *args, **options):
        dry_run = options.get('dry_run')
        qs = (
            AbonnementOrganisation.objects.filter(
                Q(statut=AbonnementOrganisation.STATUT_ESSAI)
                | Q(statut=AbonnementOrganisation.STATUT_ACTIF)
                | Q(statut=AbonnementOrganisation.STATUT_EN_RETARD)
            )
            .select_related('organisation', 'plan')
            .order_by('id')
        )

        total = qs.count()
        changes = 0
        for abo in qs.iterator():
            ancien = abo.statut
            changed = abo.synchroniser_statut(save=not dry_run)
            if changed:
                changes += 1
                self.stdout.write(
                    f'  {abo.organisation.slug}: {ancien} → {abo.statut}'
                )

        suffix = ' (dry-run)' if dry_run else ''
        self.stdout.write(
            self.style.SUCCESS(
                f'Terminé{suffix} : {changes} mise(s) à jour sur {total} abonnement(s) examinés.'
            )
        )
