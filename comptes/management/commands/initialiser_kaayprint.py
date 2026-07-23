from django.contrib.auth import get_user_model
from django.core.management.base import BaseCommand, CommandError

from comptes.models import MembreOrganisation, Organisation
from comptes.utils import nom_affichage_utilisateur
from finances.models import Transaction

User = get_user_model()


class Command(BaseCommand):
    help = (
        'Crée le compte propriétaire KaayPrint (InOut) et attribue '
        'toutes les transactions importées à ce propriétaire.'
    )

    def add_arguments(self, parser):
        parser.add_argument(
            '--email',
            required=True,
            help='E-mail de connexion du propriétaire (ex. votre@gmail.com)',
        )
        parser.add_argument(
            '--password',
            required=True,
            help='Mot de passe du propriétaire (obligatoire, sera hashé)',
        )
        parser.add_argument(
            '--prenom',
            default='',
            help='Prénom du propriétaire (optionnel)',
        )
        parser.add_argument(
            '--nom',
            default='',
            help='Nom du propriétaire (optionnel)',
        )
        parser.add_argument(
            '--slug',
            default='inout',
            help='Slug organisation existante (défaut : inout)',
        )

    def handle(self, *args, **options):
        email = options['email'].strip().lower()
        password = (options['password'] or '').strip()
        slug = options['slug']

        if len(password) < 8:
            raise CommandError('Le mot de passe doit faire au moins 8 caractères.')
        if password.lower() in {'inout2#', 'password', 'motdepasse', 'admin', '12345678'}:
            raise CommandError(
                'Ce mot de passe est trop faible ou est un ancien défaut documenté. '
                'Choisissez un mot de passe unique.'
            )

        try:
            organisation = Organisation.objects.get(slug=slug)
        except Organisation.DoesNotExist:
            raise CommandError(
                f'Organisation « {slug} » introuvable. Importez d\'abord les données.'
            )

        user, created = User.objects.get_or_create(
            username=email,
            defaults={
                'email': email,
                'first_name': options['prenom'],
                'last_name': options['nom'],
            },
        )
        if created:
            user.set_password(password)
            user.save()
            self.stdout.write(self.style.SUCCESS(f'Utilisateur créé : {email}'))
        else:
            if password:
                user.set_password(password)
                user.save()
            self.stdout.write(f'Utilisateur existant mis à jour : {email}')

        membre, m_created = MembreOrganisation.objects.get_or_create(
            utilisateur=user,
            organisation=organisation,
            defaults={
                'role': MembreOrganisation.ROLE_PROPRIETAIRE,
                'login_legacy': 'inout',
            },
        )
        if not m_created:
            membre.role = MembreOrganisation.ROLE_PROPRIETAIRE
            membre.login_legacy = 'inout'
            membre.actif = True
            membre.save()

        nom_affichage = nom_affichage_utilisateur(user)
        if nom_affichage == user.email and organisation.nom:
            nom_affichage = organisation.nom
        if not organisation.email:
            organisation.email = email
            organisation.save(update_fields=['email'])

        nb = Transaction.objects.filter(organisation=organisation).update(
            cree_par=user,
            cree_par_nom=nom_affichage,
            cree_par_role=MembreOrganisation.ROLE_PROPRIETAIRE,
        )

        self.stdout.write(self.style.SUCCESS(
            f'Organisation : {organisation.nom} ({organisation.slug})\n'
            f'Membre : propriétaire (login legacy : inout)\n'
            f'Transactions attribuées : {nb}'
        ))
