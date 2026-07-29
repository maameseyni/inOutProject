from decimal import Decimal

import django.db.models.deletion
from django.db import migrations, models


def seed_plans_et_backfill_abonnements(apps, schema_editor):
    PlanAbonnement = apps.get_model('comptes', 'PlanAbonnement')
    Organisation = apps.get_model('comptes', 'Organisation')
    AbonnementOrganisation = apps.get_model('comptes', 'AbonnementOrganisation')

    pro, _ = PlanAbonnement.objects.get_or_create(
        code='pro',
        defaults={
            'nom': 'Pro',
            'description': 'Accès à toutes les fonctionnalités actuelles.',
            'prix_mensuel': Decimal('0.00'),
            'devise': 'XOF',
            'actif': True,
            'ordre': 1,
        },
    )
    PlanAbonnement.objects.get_or_create(
        code='premium',
        defaults={
            'nom': 'Premium',
            'description': 'Pro + fonctionnalités avancées à venir.',
            'prix_mensuel': Decimal('0.00'),
            'devise': 'XOF',
            'actif': True,
            'ordre': 2,
        },
    )

    for org in Organisation.objects.all().iterator():
        if AbonnementOrganisation.objects.filter(organisation_id=org.pk).exists():
            continue
        AbonnementOrganisation.objects.create(
            organisation=org,
            plan=pro,
            statut='prelaunch',
            renouvellement_auto=True,
        )


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0010_profilutilisateur_email_en_attente'),
    ]

    operations = [
        migrations.CreateModel(
            name='PlanAbonnement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('code', models.CharField(choices=[('pro', 'Pro'), ('premium', 'Premium')], max_length=32, unique=True)),
                ('nom', models.CharField(max_length=80)),
                ('description', models.TextField(blank=True, default='')),
                ('prix_mensuel', models.DecimalField(decimal_places=2, default=Decimal('0.00'), help_text='Prix mensuel (à définir). 0 = non publié.', max_digits=12)),
                ('devise', models.CharField(default='XOF', max_length=16)),
                ('actif', models.BooleanField(default=True)),
                ('ordre', models.PositiveSmallIntegerField(default=0)),
                ('cree_le', models.DateTimeField(auto_now_add=True)),
                ('modifie_le', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'plan abonnement',
                'verbose_name_plural': 'plans abonnement',
                'db_table': 'plans_abonnement',
                'ordering': ['ordre', 'code'],
            },
        ),
        migrations.CreateModel(
            name='AbonnementOrganisation',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('statut', models.CharField(choices=[('prelaunch', 'Prélaunch'), ('essai', 'Essai'), ('actif', 'Actif'), ('en_retard', 'En retard'), ('expire', 'Expiré'), ('annule', 'Annulé')], db_index=True, default='prelaunch', max_length=20)),
                ('essai_debut', models.DateTimeField(blank=True, null=True)),
                ('essai_fin', models.DateTimeField(blank=True, null=True)),
                ('periode_debut', models.DateTimeField(blank=True, null=True)),
                ('periode_fin', models.DateTimeField(blank=True, null=True)),
                ('renouvellement_auto', models.BooleanField(default=True)),
                ('lancement_applique_le', models.DateTimeField(blank=True, help_text='Date à laquelle l’essai officiel de 3 mois a été activé.', null=True)),
                ('fournisseur', models.CharField(blank=True, default='', max_length=64)),
                ('id_externe', models.CharField(blank=True, default='', max_length=120)),
                ('cree_le', models.DateTimeField(auto_now_add=True)),
                ('modifie_le', models.DateTimeField(auto_now=True)),
                ('organisation', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='abonnement', to='comptes.organisation')),
                ('plan', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='abonnements', to='comptes.planabonnement')),
            ],
            options={
                'verbose_name': 'abonnement organisation',
                'verbose_name_plural': 'abonnements organisation',
                'db_table': 'abonnements_organisation',
            },
        ),
        migrations.CreateModel(
            name='PaiementAbonnement',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('montant', models.DecimalField(decimal_places=2, max_digits=12)),
                ('devise', models.CharField(default='XOF', max_length=16)),
                ('statut', models.CharField(choices=[('en_attente', 'En attente'), ('reussi', 'Réussi'), ('echec', 'Échec'), ('rembourse', 'Remboursé')], db_index=True, default='en_attente', max_length=20)),
                ('methode', models.CharField(blank=True, default='', max_length=64)),
                ('reference_externe', models.CharField(blank=True, db_index=True, default='', max_length=120)),
                ('periode_couverte_debut', models.DateTimeField(blank=True, null=True)),
                ('periode_couverte_fin', models.DateTimeField(blank=True, null=True)),
                ('brut_webhook', models.JSONField(blank=True, default=dict)),
                ('paye_le', models.DateTimeField(blank=True, null=True)),
                ('cree_le', models.DateTimeField(auto_now_add=True)),
                ('modifie_le', models.DateTimeField(auto_now=True)),
                ('abonnement', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='paiements', to='comptes.abonnementorganisation')),
                ('organisation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='paiements_abonnement', to='comptes.organisation')),
            ],
            options={
                'verbose_name': 'paiement abonnement',
                'verbose_name_plural': 'paiements abonnement',
                'db_table': 'paiements_abonnement',
                'ordering': ['-cree_le'],
            },
        ),
        migrations.RunPython(seed_plans_et_backfill_abonnements, noop_reverse),
    ]
