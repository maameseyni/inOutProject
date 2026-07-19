from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0009_rename_envoiemailjournalier_index'),
        ('finances', '0006_transaction_categorie_produit'),
    ]

    operations = [
        migrations.CreateModel(
            name='Note',
            fields=[
                ('id', models.CharField(max_length=64, primary_key=True, serialize=False)),
                ('titre', models.CharField(max_length=200)),
                ('contenu', models.TextField(blank=True, default='')),
                ('cree_le', models.DateTimeField(blank=True, null=True)),
                ('modifie_le', models.DateTimeField(auto_now=True)),
                (
                    'organisation',
                    models.ForeignKey(
                        on_delete=django.db.models.deletion.CASCADE,
                        related_name='notes',
                        to='comptes.organisation',
                    ),
                ),
            ],
            options={
                'verbose_name': 'note',
                'verbose_name_plural': 'notes',
                'db_table': 'notes',
                'ordering': ['-modifie_le', '-cree_le'],
            },
        ),
    ]
