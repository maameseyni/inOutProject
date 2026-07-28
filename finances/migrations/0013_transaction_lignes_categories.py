from decimal import Decimal

from django.db import migrations, models


def backfill_lignes_categories(apps, schema_editor):
    Transaction = apps.get_model('finances', 'Transaction')
    for tx in Transaction.objects.all().iterator():
        lines = tx.lignes_categories if isinstance(tx.lignes_categories, list) else []
        if lines:
            continue
        category = (tx.categorie_produit or '').strip()
        if not category:
            continue
        remaining = tx.montant_restant if tx.montant_restant is not None else Decimal('0')
        total = (tx.montant or Decimal('0')) + remaining
        tx.lignes_categories = [{
            'category': category[:120],
            'amount': float(total),
        }]
        tx.save(update_fields=['lignes_categories'])


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('finances', '0012_notification_lu'),
    ]

    operations = [
        migrations.AddField(
            model_name='transaction',
            name='lignes_categories',
            field=models.JSONField(blank=True, default=list),
        ),
        migrations.RunPython(backfill_lignes_categories, noop_reverse),
    ]
