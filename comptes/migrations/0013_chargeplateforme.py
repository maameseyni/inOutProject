from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('comptes', '0012_user_email_unique'),
    ]

    operations = [
        migrations.CreateModel(
            name='ChargePlateforme',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date_charge', models.DateField(db_index=True)),
                ('montant', models.DecimalField(decimal_places=2, max_digits=12)),
                ('devise', models.CharField(default='XOF', max_length=16)),
                ('categorie', models.CharField(
                    choices=[
                        ('pub', 'Publicité'),
                        ('infra', 'Infrastructure'),
                        ('outils', 'Outils & services'),
                        ('banque', 'Frais bancaires'),
                        ('autre', 'Autre'),
                    ],
                    db_index=True,
                    default='autre',
                    max_length=20,
                )),
                ('libelle', models.CharField(max_length=200)),
                ('notes', models.TextField(blank=True, default='')),
                ('cree_le', models.DateTimeField(auto_now_add=True)),
                ('modifie_le', models.DateTimeField(auto_now=True)),
                ('cree_par', models.ForeignKey(
                    blank=True,
                    null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name='charges_plateforme_creees',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'charge plateforme',
                'verbose_name_plural': 'charges plateforme',
                'db_table': 'charges_plateforme',
                'ordering': ['-date_charge', '-cree_le'],
            },
        ),
    ]
