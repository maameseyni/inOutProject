from django.core.management.base import BaseCommand
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime

from comptes.models import AbonnementOrganisation


class Command(BaseCommand):
    help = (
        'Active l’essai Pro de 3 mois pour toutes les organisations encore en prélaunch '
        '(idempotent). Utiliser au jour du lancement officiel.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--date',
            dest='date_lancement',
            default=None,
            help='Date/heure de lancement (ISO). Défaut : XALISS_LANCEMENT_LE ou maintenant.',
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Affiche ce qui serait fait sans écrire en base.',
        )

    def handle(self, *args, **options):
        debut = self._resolve_debut(options.get('date_lancement'))
        dry_run = options.get('dry_run')

        qs = AbonnementOrganisation.objects.filter(
            lancement_applique_le__isnull=True,
            statut=AbonnementOrganisation.STATUT_PRELAUNCH,
        ).select_related('organisation', 'plan')

        total = qs.count()
        if total == 0:
            self.stdout.write(self.style.SUCCESS('Aucun abonnement prélaunch à activer.'))
            return

        self.stdout.write(
            f'Activation essai au {debut.isoformat()} pour {total} organisation(s)'
            + (' (dry-run)' if dry_run else '')
        )

        updated = 0
        for abo in qs.iterator():
            if dry_run:
                self.stdout.write(f'  - {abo.organisation.slug}')
            else:
                abo.demarrer_essai(debut=debut, save=True)
            updated += 1

        self.stdout.write(self.style.SUCCESS(f'Terminé : {updated} abonnement(s).'))

    def _resolve_debut(self, raw):
        if raw:
            dt = parse_datetime(raw)
            if dt is None:
                d = parse_date(raw)
                if d is None:
                    raise SystemExit(f'Date invalide : {raw}')
                from datetime import datetime
                dt = datetime(d.year, d.month, d.day)
            if timezone.is_naive(dt):
                dt = timezone.make_aware(dt, timezone.get_current_timezone())
            return dt

        lancement = AbonnementOrganisation.date_lancement_officielle()
        return lancement or timezone.now()
