from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0007_profilutilisateur_confirmation_email_envoye_le'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='profilutilisateur',
            name='confirmation_email_envoye_le',
        ),
        migrations.CreateModel(
            name='EnvoiEmailJournalier',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(max_length=254)),
                ('type_email', models.CharField(
                    choices=[
                        ('confirmation', 'Confirmation e-mail'),
                        ('mot_de_passe', 'Mot de passe oublié'),
                    ],
                    max_length=32,
                )),
                ('date', models.DateField()),
                ('nombre', models.PositiveSmallIntegerField(default=0)),
                ('cree_le', models.DateTimeField(auto_now_add=True)),
                ('modifie_le', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'envoi e-mail journalier',
                'verbose_name_plural': 'envois e-mail journaliers',
                'db_table': 'envois_email_journaliers',
                'indexes': [
                    models.Index(
                        fields=['email', 'type_email', 'date'],
                        name='envois_emai_email_e_97a79f_idx',
                    ),
                ],
                'constraints': [
                    models.UniqueConstraint(
                        fields=('email', 'type_email', 'date'),
                        name='uniq_envoi_email_journalier',
                    ),
                ],
            },
        ),
    ]
