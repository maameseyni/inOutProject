from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0013_chargeplateforme'),
    ]

    operations = [
        migrations.AddField(
            model_name='chargeplateforme',
            name='nature',
            field=models.CharField(
                choices=[('fixe', 'Fixe'), ('variable', 'Variable')],
                db_index=True,
                default='variable',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='chargeplateforme',
            name='recurrent',
            field=models.BooleanField(
                default=False,
                help_text='Dépense qui se répète (ex. abonnement mensuel).',
            ),
        ),
    ]
