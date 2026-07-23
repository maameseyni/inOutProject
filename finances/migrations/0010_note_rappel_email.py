from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('finances', '0009_note_pin_archive_reminder'),
    ]

    operations = [
        migrations.AddField(
            model_name='note',
            name='rappel_email_envoye_le',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='note',
            name='rappel_email_utilisateur',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='notes_rappel_email',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='note',
            name='rappel_par_email',
            field=models.BooleanField(default=False),
        ),
    ]
