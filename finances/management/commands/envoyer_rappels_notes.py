from django.core.management.base import BaseCommand

from finances.services.note_reminders import process_due_note_reminder_emails


class Command(BaseCommand):
    help = 'Envoie les e-mails de rappel pour les notes arrivées à échéance.'

    def handle(self, *args, **options):
        sent = process_due_note_reminder_emails()
        self.stdout.write(self.style.SUCCESS(f'{sent} e-mail(s) de rappel envoyé(s).'))
