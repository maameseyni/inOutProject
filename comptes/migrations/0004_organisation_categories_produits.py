from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0003_organisation_sync_seq'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.AddField(
                    model_name='organisation',
                    name='categories_produits',
                    field=models.JSONField(blank=True, default=list),
                ),
            ],
            database_operations=[
                migrations.RunSQL(
                    sql="""
                        ALTER TABLE organisations
                        ADD COLUMN IF NOT EXISTS categories_produits JSONB NOT NULL DEFAULT '[]'::jsonb;
                        ALTER TABLE organisations
                        ALTER COLUMN categories_produits SET DEFAULT '[]'::jsonb;
                        UPDATE organisations
                        SET categories_produits = '[]'::jsonb
                        WHERE categories_produits IS NULL;
                    """,
                    reverse_sql=migrations.RunSQL.noop,
                ),
            ],
        ),
    ]
