from django.db import migrations, models


TYPE_ENTRANT = 'entrant'
TYPE_SORTANT = 'sortant'
PREFIX_MAP = {
    TYPE_ENTRANT: ('fac', 'FAC'),
    TYPE_SORTANT: ('pay', 'PAY'),
}


def format_document_number(prefix_label, year, counter):
    width = max(5, len(str(counter)))
    return f'{prefix_label}-{year}-{counter:0{width}d}'


def backfill_document_numbers(apps, schema_editor):
    Transaction = apps.get_model('finances', 'Transaction')
    SequenceDocument = apps.get_model('finances', 'SequenceDocument')

    counters = {}
    txs = Transaction.objects.all().order_by('organisation_id', 'type', 'date', 'id')

    for tx in txs:
        prefix_type, prefix_label = PREFIX_MAP.get(tx.type, PREFIX_MAP[TYPE_ENTRANT])
        year = tx.date.year
        key = (tx.organisation_id, prefix_type, year)
        counters[key] = counters.get(key, 0) + 1
        numero = format_document_number(prefix_label, year, counters[key])
        Transaction.objects.filter(pk=tx.pk).update(numero_document=numero)

    for (org_id, prefix_type, year), count in counters.items():
        SequenceDocument.objects.update_or_create(
            organisation_id=org_id,
            prefix_type=prefix_type,
            annee=year,
            defaults={'compteur': count},
        )


class Migration(migrations.Migration):

    dependencies = [
        ('finances', '0014_sondage_sondageoption_sondagereponse_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='SequenceDocument',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('prefix_type', models.CharField(choices=[('fac', 'Facture'), ('pay', 'Paiement')], max_length=8)),
                ('annee', models.PositiveSmallIntegerField()),
                ('compteur', models.PositiveIntegerField(default=0)),
                (
                    'organisation',
                    models.ForeignKey(
                        on_delete=models.deletion.CASCADE,
                        related_name='sequences_documents',
                        to='comptes.organisation',
                    ),
                ),
            ],
            options={
                'verbose_name': 'séquence document',
                'verbose_name_plural': 'séquences documents',
                'db_table': 'sequences_documents',
            },
        ),
        migrations.AddField(
            model_name='transaction',
            name='numero_document',
            field=models.CharField(blank=True, db_index=True, default='', max_length=32),
        ),
        migrations.AddConstraint(
            model_name='sequencedocument',
            constraint=models.UniqueConstraint(
                fields=('organisation', 'prefix_type', 'annee'),
                name='uniq_sequence_document_org_prefix_year',
            ),
        ),
        migrations.AddConstraint(
            model_name='transaction',
            constraint=models.UniqueConstraint(
                condition=models.Q(('numero_document__gt', '')),
                fields=('organisation', 'numero_document'),
                name='uniq_transaction_numero_document_org',
            ),
        ),
        migrations.RunPython(backfill_document_numbers, migrations.RunPython.noop),
    ]
