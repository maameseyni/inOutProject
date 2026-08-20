from django.db import migrations


def fix_null_theme_facture(apps, schema_editor):
    Organisation = apps.get_model('comptes', 'Organisation')
    for org in Organisation.objects.filter(theme_facture__isnull=True).iterator():
        org.theme_facture = {}
        org.save(update_fields=['theme_facture'])


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0017_organisation_theme_facture'),
    ]

    operations = [
        migrations.RunPython(fix_null_theme_facture, migrations.RunPython.noop),
    ]
