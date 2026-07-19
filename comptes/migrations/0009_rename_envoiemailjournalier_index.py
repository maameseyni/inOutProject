from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('comptes', '0008_envoiemailjournalier_remove_profil_tracking'),
    ]

    operations = [
        migrations.RenameIndex(
            model_name='envoiemailjournalier',
            new_name='idx_email_journalier_quota',
            old_name='envois_emai_email_e_97a79f_idx',
        ),
    ]
