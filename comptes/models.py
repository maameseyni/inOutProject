from datetime import datetime, timedelta
from decimal import Decimal

from django.conf import settings
from django.db import models
from django.utils import timezone
from django.utils.dateparse import parse_date, parse_datetime


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


class PlanAbonnement(models.Model):
    CODE_PRO = 'pro'
    CODE_PREMIUM = 'premium'

    CODE_CHOICES = [
        (CODE_PRO, 'Pro'),
        (CODE_PREMIUM, 'Premium'),
    ]

    code = models.CharField(max_length=32, unique=True, choices=CODE_CHOICES)
    nom = models.CharField(max_length=80)
    description = models.TextField(blank=True, default='')
    prix_mensuel = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal('0.00'),
        help_text='Prix mensuel (à définir). 0 = non publié.',
    )
    devise = models.CharField(max_length=16, default='XOF')
    actif = models.BooleanField(default=True)
    ordre = models.PositiveSmallIntegerField(default=0)
    cree_le = models.DateTimeField(auto_now_add=True)
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'plans_abonnement'
        verbose_name = 'plan abonnement'
        verbose_name_plural = 'plans abonnement'
        ordering = ['ordre', 'code']

    def __str__(self):
        return self.nom or self.code

    @classmethod
    def get_by_code(cls, code):
        return cls.objects.filter(code=code, actif=True).first() or cls.objects.filter(code=code).first()


class AbonnementOrganisation(models.Model):
    STATUT_PRELAUNCH = 'prelaunch'
    STATUT_ESSAI = 'essai'
    STATUT_ACTIF = 'actif'
    STATUT_EN_RETARD = 'en_retard'
    STATUT_EXPIRE = 'expire'
    STATUT_ANNULE = 'annule'

    STATUT_CHOICES = [
        (STATUT_PRELAUNCH, 'Prélaunch'),
        (STATUT_ESSAI, 'Essai'),
        (STATUT_ACTIF, 'Actif'),
        (STATUT_EN_RETARD, 'En retard'),
        (STATUT_EXPIRE, 'Expiré'),
        (STATUT_ANNULE, 'Annulé'),
    ]

    organisation = models.OneToOneField(
        Organisation,
        on_delete=models.CASCADE,
        related_name='abonnement',
    )
    plan = models.ForeignKey(
        PlanAbonnement,
        on_delete=models.PROTECT,
        related_name='abonnements',
    )
    statut = models.CharField(
        max_length=20,
        choices=STATUT_CHOICES,
        default=STATUT_PRELAUNCH,
        db_index=True,
    )
    essai_debut = models.DateTimeField(null=True, blank=True)
    essai_fin = models.DateTimeField(null=True, blank=True)
    periode_debut = models.DateTimeField(null=True, blank=True)
    periode_fin = models.DateTimeField(null=True, blank=True)
    renouvellement_auto = models.BooleanField(default=True)
    lancement_applique_le = models.DateTimeField(
        null=True,
        blank=True,
        help_text='Date à laquelle l’essai officiel de 3 mois a été activé.',
    )
    fournisseur = models.CharField(max_length=64, blank=True, default='')
    id_externe = models.CharField(max_length=120, blank=True, default='')
    cree_le = models.DateTimeField(auto_now_add=True)
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'abonnements_organisation'
        verbose_name = 'abonnement organisation'
        verbose_name_plural = 'abonnements organisation'

    def __str__(self):
        return f'{self.organisation} — {self.plan.code} ({self.statut})'

    @staticmethod
    def duree_essai():
        jours = getattr(settings, 'XALISS_DUREE_ESSAI_JOURS', 90)
        try:
            jours = int(jours)
        except (TypeError, ValueError):
            jours = 90
        return timedelta(days=max(1, jours))

    @staticmethod
    def duree_grace_retard():
        jours = getattr(settings, 'XALISS_JOURS_GRACE_RETARD', 3)
        try:
            jours = int(jours)
        except (TypeError, ValueError):
            jours = 3
        return timedelta(days=max(0, jours))

    @staticmethod
    def date_lancement_officielle():
        raw = getattr(settings, 'XALISS_LANCEMENT_LE', None)
        if not raw:
            return None
        if hasattr(raw, 'tzinfo'):
            dt = raw
            if timezone.is_naive(dt):
                return timezone.make_aware(dt, timezone.get_current_timezone())
            return dt
        text = str(raw).strip()
        if not text:
            return None
        dt = parse_datetime(text)
        if dt is None:
            d = parse_date(text)
            if d is None:
                return None
            dt = datetime(d.year, d.month, d.day)
        if timezone.is_naive(dt):
            dt = timezone.make_aware(dt, timezone.get_current_timezone())
        return dt

    def _now(self):
        return timezone.now()

    def fin_grace_retard(self):
        """Fin de la fenêtre d'accès en retard (= periode_fin + N jours)."""
        if not self.periode_fin:
            return None
        return self.periode_fin + self.duree_grace_retard()

    def synchroniser_statut(self, maintenant=None, save=True):
        """
        Aligne le statut sur les dates :
        - essai dépassé → expire
        - actif dépassé → en_retard
        - en_retard hors grâce (periode_fin + 3j) → expire
        """
        maintenant = maintenant or self._now()
        ancien = self.statut
        nouveau = ancien

        if self.statut == self.STATUT_ESSAI:
            if self.essai_fin is not None and maintenant > self.essai_fin:
                nouveau = self.STATUT_EXPIRE
        elif self.statut == self.STATUT_ACTIF:
            if self.periode_fin is not None and maintenant > self.periode_fin:
                nouveau = self.STATUT_EN_RETARD
        elif self.statut == self.STATUT_EN_RETARD:
            fin_grace = self.fin_grace_retard()
            if fin_grace is None or maintenant > fin_grace:
                nouveau = self.STATUT_EXPIRE

        if nouveau != ancien:
            self.statut = nouveau
            if save and self.pk:
                self.save(update_fields=['statut', 'modifie_le'])
        return self.statut != ancien

    def est_acces_pro_actif(self, maintenant=None):
        """Accès Pro (inclut Premium) : prélaunch, essai, actif, ou en_retard (3j max)."""
        maintenant = maintenant or self._now()
        self.synchroniser_statut(maintenant=maintenant, save=True)

        if self.statut == self.STATUT_PRELAUNCH:
            return True
        if self.statut == self.STATUT_ESSAI:
            if self.essai_fin is None:
                return True
            return maintenant <= self.essai_fin
        if self.statut == self.STATUT_ACTIF:
            if self.periode_fin is None:
                return True
            return maintenant <= self.periode_fin
        if self.statut == self.STATUT_EN_RETARD:
            fin_grace = self.fin_grace_retard()
            if fin_grace is None:
                return False
            return maintenant <= fin_grace
        return False

    def est_premium(self, maintenant=None):
        if not self.plan_id:
            return False
        if self.plan.code != PlanAbonnement.CODE_PREMIUM:
            return False
        return self.est_acces_pro_actif(maintenant=maintenant)

    def demarrer_essai(self, debut=None, save=True):
        """Active l’essai Pro de 3 mois à partir de `debut` (lancement ou inscription)."""
        debut = debut or self._now()
        if timezone.is_naive(debut):
            debut = timezone.make_aware(debut, timezone.get_current_timezone())
        plan_pro = PlanAbonnement.get_by_code(PlanAbonnement.CODE_PRO)
        if plan_pro is None:
            raise ValueError('Plan Pro introuvable. Exécutez les migrations.')
        self.plan = plan_pro
        self.statut = self.STATUT_ESSAI
        self.essai_debut = debut
        self.essai_fin = debut + self.duree_essai()
        self.lancement_applique_le = debut
        if save:
            self.save(
                update_fields=[
                    'plan',
                    'statut',
                    'essai_debut',
                    'essai_fin',
                    'lancement_applique_le',
                    'modifie_le',
                ]
            )
        return self

    @classmethod
    def creer_pour_organisation(cls, organisation, save=True):
        """Crée l’abonnement : prelaunch si pas encore lancé, sinon essai 3 mois."""
        try:
            return organisation.abonnement
        except cls.DoesNotExist:
            pass

        plan_pro = PlanAbonnement.get_by_code(PlanAbonnement.CODE_PRO)
        if plan_pro is None:
            raise ValueError('Plan Pro introuvable. Exécutez les migrations.')

        abo = cls(
            organisation=organisation,
            plan=plan_pro,
            statut=cls.STATUT_PRELAUNCH,
        )
        lancement = cls.date_lancement_officielle()
        maintenant = timezone.now()
        if lancement is not None:
            debut = max(maintenant, lancement)
            abo.demarrer_essai(debut=debut, save=False)
        if save:
            abo.save()
        return abo


class PaiementAbonnement(models.Model):
    STATUT_EN_ATTENTE = 'en_attente'
    STATUT_REUSSI = 'reussi'
    STATUT_ECHEC = 'echec'
    STATUT_REMBOURSE = 'rembourse'

    STATUT_CHOICES = [
        (STATUT_EN_ATTENTE, 'En attente'),
        (STATUT_REUSSI, 'Réussi'),
        (STATUT_ECHEC, 'Échec'),
        (STATUT_REMBOURSE, 'Remboursé'),
    ]

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name='paiements_abonnement',
    )
    abonnement = models.ForeignKey(
        AbonnementOrganisation,
        on_delete=models.CASCADE,
        related_name='paiements',
    )
    montant = models.DecimalField(max_digits=12, decimal_places=2)
    devise = models.CharField(max_length=16, default='XOF')
    statut = models.CharField(
        max_length=20,
        choices=STATUT_CHOICES,
        default=STATUT_EN_ATTENTE,
        db_index=True,
    )
    methode = models.CharField(max_length=64, blank=True, default='')
    reference_externe = models.CharField(max_length=120, blank=True, default='', db_index=True)
    periode_couverte_debut = models.DateTimeField(null=True, blank=True)
    periode_couverte_fin = models.DateTimeField(null=True, blank=True)
    brut_webhook = models.JSONField(default=dict, blank=True)
    paye_le = models.DateTimeField(null=True, blank=True)
    cree_le = models.DateTimeField(auto_now_add=True)
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'paiements_abonnement'
        verbose_name = 'paiement abonnement'
        verbose_name_plural = 'paiements abonnement'
        ordering = ['-cree_le']

    def __str__(self):
        return f'{self.organisation} — {self.montant} {self.devise} ({self.statut})'


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
