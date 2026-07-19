from django.db import migrations, models
import django.db.models.deletion


def remplir_client_paiements(apps, schema_editor):
    Paiement = apps.get_model('finances', 'Paiement')
    for paiement in Paiement.objects.select_related('transaction').iterator():
        tx = paiement.transaction
        if tx and tx.client_id and not paiement.client_id:
            paiement.client_id = tx.client_id
            paiement.save(update_fields=['client_id'])


class Migration(migrations.Migration):

    dependencies = [
        ('finances', '0002_fusion_organisation_et_auteur'),
    ]

    operations = [
        migrations.AddField(
            model_name='paiement',
            name='client',
            field=models.ForeignKey(
                blank=True,
                help_text='Copie du client de la transaction pour les totaux par client.',
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='paiements',
                to='finances.client',
            ),
        ),
        migrations.RunPython(remplir_client_paiements, migrations.RunPython.noop),
        migrations.AddIndex(
            model_name='paiement',
            index=models.Index(fields=['client', 'paye_le'], name='paiements_client_paye_idx'),
        ),
    ]
