from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0016_organisation_logo_facture'),
    ]

    operations = [
        migrations.AddField(
            model_name='organisation',
            name='theme_facture',
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text='Personnalisation visuelle des factures (couleurs, cadre logo).',
            ),
        ),
    ]
