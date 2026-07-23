from django.conf import settings
from django.db import models


class Organisation(models.Model):
    slug = models.SlugField(max_length=120, unique=True)
    nom = models.CharField(max_length=200, default='')
    telephone = models.CharField(max_length=40, default='')
    email = models.EmailField(max_length=80, blank=True, default='')
    adresse = models.TextField(blank=True, default='')
    site_web = models.CharField(max_length=120, blank=True, default='')
    libelle_devise = models.CharField(max_length=16, default='XOF')
    categories_produits = models.JSONField(default=list, blank=True)
    rafraichissement_auto = models.BooleanField(default=True)
    sync_seq = models.PositiveBigIntegerField(default=0)
    cree_le = models.DateTimeField(auto_now_add=True)
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'organisations'
        verbose_name = 'organisation'
        verbose_name_plural = 'organisations'

    def __str__(self):
        return self.nom or self.slug


class ProfilUtilisateur(models.Model):
    """Données personnelles complémentaires (hors modèle User Django)."""

    utilisateur = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='profil',
    )
    pays = models.CharField(max_length=100, blank=True, default='')
    ville = models.CharField(max_length=100, blank=True, default='')
    email_en_attente = models.EmailField(max_length=254, blank=True, default='')
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'profils_utilisateur'
        verbose_name = 'profil utilisateur'
        verbose_name_plural = 'profils utilisateur'

    def __str__(self):
        return f'Profil {self.utilisateur_id}'

    @classmethod
    def get_or_create_for(cls, utilisateur):
        profil, _ = cls.objects.get_or_create(utilisateur=utilisateur)
        return profil


class EnvoiEmailJournalier(models.Model):
    TYPE_CONFIRMATION = 'confirmation'
    TYPE_MOT_DE_PASSE = 'mot_de_passe'

    TYPE_CHOICES = [
        (TYPE_CONFIRMATION, 'Confirmation e-mail'),
        (TYPE_MOT_DE_PASSE, 'Mot de passe oublié'),
    ]

    email = models.EmailField(max_length=254)
    type_email = models.CharField(max_length=32, choices=TYPE_CHOICES)
    date = models.DateField()
    nombre = models.PositiveSmallIntegerField(default=0)
    cree_le = models.DateTimeField(auto_now_add=True)
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'envois_email_journaliers'
        verbose_name = 'envoi e-mail journalier'
        verbose_name_plural = 'envois e-mail journaliers'
        constraints = [
            models.UniqueConstraint(
                fields=['email', 'type_email', 'date'],
                name='uniq_envoi_email_journalier',
            ),
        ]
        indexes = [
            models.Index(
                fields=['email', 'type_email', 'date'],
                name='idx_email_journalier_quota',
            ),
        ]

    def __str__(self):
        return f'{self.email} - {self.type_email} - {self.date} ({self.nombre})'


class MembreOrganisation(models.Model):
    ROLE_PROPRIETAIRE = 'proprietaire'
    ROLE_ADMIN = 'admin'
    ROLE_MEMBRE = 'membre'

    ROLE_CHOICES = [
        (ROLE_PROPRIETAIRE, 'Propriétaire'),
        (ROLE_ADMIN, 'Administrateur'),
        (ROLE_MEMBRE, 'Membre'),
    ]

    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='membres_organisations',
    )
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name='membres',
    )
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default=ROLE_PROPRIETAIRE)
    login_legacy = models.CharField(max_length=120, blank=True, default='')
    actif = models.BooleanField(default=True)
    cree_le = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = 'membres_organisation'
        verbose_name = 'membre organisation'
        verbose_name_plural = 'membres organisation'
        constraints = [
            models.UniqueConstraint(
                fields=['utilisateur', 'organisation'],
                name='uniq_membre_utilisateur_organisation',
            ),
        ]

    def __str__(self):
        return f'{self.get_nom_affichage()} ({self.get_email()}) → {self.organisation.nom} ({self.role})'

    def get_role_display_label(self):
        return dict(self.ROLE_CHOICES).get(self.role, self.role)

    @property
    def email(self):
        """E-mail de connexion — stocké sur l'utilisateur Django, pas ici."""
        return self.utilisateur.email

    @property
    def nom_complet(self):
        """Prénom + nom — stockés sur l'utilisateur Django."""
        return self.utilisateur.get_full_name().strip()

    def get_email(self):
        return self.utilisateur.email or self.utilisateur.username

    def get_nom_affichage(self):
        return self.nom_complet or self.get_email()

    def get_nom_profil(self):
        """Prénom et nom de l'utilisateur pour l'interface (jamais l'e-mail ni l'organisation)."""
        return self.nom_complet

    @property
    def id_organisation(self):
        return self.organisation_id

    @classmethod
    def get_membre_actif(cls, utilisateur, organisation):
        return cls.objects.filter(
            utilisateur=utilisateur,
            organisation=organisation,
            actif=True,
        ).first()
