from django.db import migrations, models


def migrer_fcfa_vers_xof(apps, schema_editor):
    Organisation = apps.get_model('comptes', 'Organisation')
    Organisation.objects.filter(libelle_devise__iexact='FCFA').update(libelle_devise='XOF')
    Organisation.objects.filter(libelle_devise__iexact='CFA').update(libelle_devise='XOF')


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0004_organisation_categories_produits'),
    ]

    operations = [
        migrations.AlterField(
            model_name='organisation',
            name='libelle_devise',
            field=models.CharField(default='XOF', max_length=16),
        ),
        migrations.RunPython(migrer_fcfa_vers_xof, migrations.RunPython.noop),
    ]
