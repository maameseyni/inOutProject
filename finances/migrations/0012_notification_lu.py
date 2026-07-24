from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('finances', '0011_notification'),
    ]

    operations = [
        migrations.AddField(
            model_name='notification',
            name='lu',
            field=models.BooleanField(default=False),
        ),
    ]
