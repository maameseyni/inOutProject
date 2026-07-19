from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('finances', '0001_initial'),
        ('comptes', '0002_fusion_organisation_et_auteur'),
    ]

    operations = [
        migrations.AddField(
            model_name='transaction',
            name='cree_par',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='transactions_creees',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='transaction',
            name='cree_par_nom',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='transaction',
            name='cree_par_role',
            field=models.CharField(blank=True, default='', max_length=20),
        ),
    ]
