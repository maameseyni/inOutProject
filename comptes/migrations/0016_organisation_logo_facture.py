from django.db import migrations, models

import comptes.models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0015_accesbackoffice'),
    ]

    operations = [
        migrations.AddField(
            model_name='organisation',
            name='logo_facture',
            field=models.ImageField(
                blank=True,
                help_text='Logo affiché sur les factures de l’organisation.',
                null=True,
                upload_to=comptes.models.organisation_logo_upload_to,
            ),
        ),
    ]
