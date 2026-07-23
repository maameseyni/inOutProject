from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('finances', '0010_note_rappel_email'),
        ('comptes', '0009_rename_envoiemailjournalier_index'),
    ]

    operations = [
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.CharField(max_length=64, primary_key=True, serialize=False)),
                ('message', models.TextField()),
                ('type_notif', models.CharField(
                    choices=[
                        ('success', 'Succès'),
                        ('error', 'Erreur'),
                        ('info', 'Info'),
                        ('warning', 'Avertissement'),
                    ],
                    default='info',
                    max_length=20,
                )),
                ('system_id', models.CharField(blank=True, default='', max_length=160)),
                ('cree_le', models.DateTimeField(default=django.utils.timezone.now)),
                ('organisation', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='notifications',
                    to='comptes.organisation',
                )),
                ('utilisateur', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='notifications',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'notification',
                'verbose_name_plural': 'notifications',
                'db_table': 'notifications',
                'ordering': ['-cree_le'],
            },
        ),
        migrations.CreateModel(
            name='NotificationIgnoree',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('system_id', models.CharField(max_length=160)),
                ('ignoree_le', models.DateTimeField(default=django.utils.timezone.now)),
                ('organisation', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='notifications_ignorees',
                    to='comptes.organisation',
                )),
                ('utilisateur', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='notifications_ignorees',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'verbose_name': 'notification ignorée',
                'verbose_name_plural': 'notifications ignorées',
                'db_table': 'notifications_ignorees',
            },
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(
                fields=['organisation', 'utilisateur', '-cree_le'],
                name='notificatio_organis_0c8b1a_idx',
            ),
        ),
        migrations.AddIndex(
            model_name='notification',
            index=models.Index(
                fields=['organisation', 'utilisateur', 'system_id'],
                name='notificatio_organis_1a2b3c_idx',
            ),
        ),
        migrations.AddConstraint(
            model_name='notificationignoree',
            constraint=models.UniqueConstraint(
                fields=('organisation', 'utilisateur', 'system_id'),
                name='uniq_notif_ignoree_org_user_system',
            ),
        ),
    ]
