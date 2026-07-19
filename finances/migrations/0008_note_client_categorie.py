import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finances', '0007_note'),
    ]

    operations = [
        migrations.AddField(
            model_name='note',
            name='categorie_produit',
            field=models.CharField(blank=True, default='', max_length=120),
        ),
        migrations.AddField(
            model_name='note',
            name='client',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='notes',
                to='finances.client',
            ),
        ),
    ]
