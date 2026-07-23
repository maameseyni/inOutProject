# Generated manually for email_en_attente

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0009_rename_envoiemailjournalier_index'),
    ]

    operations = [
        migrations.AddField(
            model_name='profilutilisateur',
            name='email_en_attente',
            field=models.EmailField(blank=True, default='', max_length=254),
        ),
    ]
