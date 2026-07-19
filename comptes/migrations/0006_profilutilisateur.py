import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0005_organisation_devise_iso'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ProfilUtilisateur',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('pays', models.CharField(blank=True, default='', max_length=100)),
                ('ville', models.CharField(blank=True, default='', max_length=100)),
                ('modifie_le', models.DateTimeField(auto_now=True)),
                ('utilisateur', models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='profil',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'profil utilisateur',
                'verbose_name_plural': 'profils utilisateur',
                'db_table': 'profils_utilisateur',
            },
        ),
    ]
