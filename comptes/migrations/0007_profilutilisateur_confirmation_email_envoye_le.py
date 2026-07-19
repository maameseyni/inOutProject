from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0006_profilutilisateur'),
    ]

    operations = [
        migrations.AddField(
            model_name='profilutilisateur',
            name='confirmation_email_envoye_le',
            field=models.DateTimeField(blank=True, null=True),
        ),
    ]
