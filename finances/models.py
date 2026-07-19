from django.conf import settings
from django.db import models
from django.utils import timezone

from comptes.models import MembreOrganisation, Organisation


class Client(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name='clients',
    )
    nom = models.CharField(max_length=200)
    telephone = models.CharField(max_length=40, blank=True, default='')
    note = models.TextField(blank=True, default='')
    provenance = models.CharField(max_length=40, blank=True, default='')
    cree_le = models.DateTimeField(null=True, blank=True)
    modifie_le = models.DateTimeField(auto_now=True)
    id_compte_legacy = models.CharField(max_length=120, blank=True, default='')

    class Meta:
        db_table = 'clients'
        verbose_name = 'client'
        verbose_name_plural = 'clients'
        ordering = ['-cree_le', 'nom']

    def __str__(self):
        return self.nom

    def get_total_commande(self, type_transaction=None):
        """Somme des montants commandés (transactions liées à ce client)."""
        from django.db.models import Sum
        qs = self.transactions.all()
        if type_transaction:
            qs = qs.filter(type=type_transaction)
        return qs.aggregate(total=Sum('montant'))['total'] or 0

    def get_total_encaisse(self):
        """Somme des paiements enregistrés pour ce client."""
        from django.db.models import Sum
        return self.paiements.aggregate(total=Sum('montant'))['total'] or 0


class AliasClient(models.Model):
    client = models.ForeignKey(
        Client,
        on_delete=models.CASCADE,
        related_name='alias',
    )
    alias_nom = models.CharField(max_length=200)

    class Meta:
        db_table = 'alias_clients'
        verbose_name = 'alias client'
        verbose_name_plural = 'alias clients'
        constraints = [
            models.UniqueConstraint(
                fields=['client', 'alias_nom'],
                name='uniq_alias_client_nom',
            ),
        ]


class Transaction(models.Model):
    TYPE_ENTRANT = 'entrant'
    TYPE_SORTANT = 'sortant'

    TYPE_CHOICES = [
        (TYPE_ENTRANT, 'Entrant'),
        (TYPE_SORTANT, 'Sortant'),
    ]

    id = models.CharField(max_length=128, primary_key=True)
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name='transactions',
    )
    type = models.CharField(max_length=16, choices=TYPE_CHOICES)
    montant = models.DecimalField(max_digits=14, decimal_places=2)
    description = models.TextField(default='')
    date = models.DateTimeField()
    montant_restant = models.DecimalField(
        max_digits=14,
        decimal_places=2,
        null=True,
        blank=True,
    )
    nom_client_facture = models.CharField(max_length=200, blank=True, default='')
    categorie_produit = models.CharField(max_length=120, blank=True, default='')
    client = models.ForeignKey(
        Client,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions',
    )
    id_compte_legacy = models.CharField(max_length=120, blank=True, default='')
    cree_par = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='transactions_creees',
    )
    cree_par_nom = models.CharField(max_length=200, blank=True, default='')
    cree_par_role = models.CharField(max_length=20, blank=True, default='')
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'transactions'
        verbose_name = 'transaction'
        verbose_name_plural = 'transactions'
        ordering = ['-date']

    def __str__(self):
        return f'{self.get_type_display()} {self.montant} — {self.description[:40]}'

    def get_cree_par_affichage(self):
        if not self.cree_par_nom:
            return ''
        role_labels = dict(MembreOrganisation.ROLE_CHOICES)
        role = role_labels.get(self.cree_par_role, self.cree_par_role)
        if role:
            return f'{self.cree_par_nom} · {role}'
        return self.cree_par_nom

    @classmethod
    def remplir_auteur(cls, transaction, utilisateur, membre):
        nom = utilisateur.get_full_name().strip() or utilisateur.email
        transaction.cree_par = utilisateur
        transaction.cree_par_nom = nom
        transaction.cree_par_role = membre.role if membre else MembreOrganisation.ROLE_PROPRIETAIRE


class Paiement(models.Model):
    transaction = models.ForeignKey(
        Transaction,
        on_delete=models.CASCADE,
        related_name='paiements',
    )
    client = models.ForeignKey(
        Client,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='paiements',
        help_text='Copie du client de la transaction pour les totaux par client.',
    )
    montant = models.DecimalField(max_digits=14, decimal_places=2)
    paye_le = models.DateTimeField()

    class Meta:
        db_table = 'paiements'
        verbose_name = 'paiement'
        verbose_name_plural = 'paiements'
        ordering = ['paye_le']
        indexes = [
            models.Index(fields=['client', 'paye_le']),
        ]

    def save(self, *args, **kwargs):
        if self.transaction_id and not self.client_id:
            tx_client_id = (
                Transaction.objects.filter(pk=self.transaction_id)
                .values_list('client_id', flat=True)
                .first()
            )
            if tx_client_id:
                self.client_id = tx_client_id
        super().save(*args, **kwargs)


class Note(models.Model):
    id = models.CharField(max_length=64, primary_key=True)
    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name='notes',
    )
    titre = models.CharField(max_length=200)
    contenu = models.TextField(blank=True, default='')
    client = models.ForeignKey(
        Client,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='notes',
    )
    categorie_produit = models.CharField(max_length=120, blank=True, default='')
    cree_le = models.DateTimeField(null=True, blank=True)
    modifie_le = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = 'notes'
        verbose_name = 'note'
        verbose_name_plural = 'notes'
        ordering = ['-modifie_le', '-cree_le']

    def __str__(self):
        return self.titre


class VerrouEdition(models.Model):
    RESSOURCE_TRANSACTION = 'transaction'
    RESSOURCE_CLIENT = 'client'

    RESSOURCE_CHOICES = [
        (RESSOURCE_TRANSACTION, 'Transaction'),
        (RESSOURCE_CLIENT, 'Client'),
    ]

    organisation = models.ForeignKey(
        Organisation,
        on_delete=models.CASCADE,
        related_name='verrous',
    )
    ressource_type = models.CharField(max_length=32, choices=RESSOURCE_CHOICES)
    ressource_id = models.CharField(max_length=128)
    utilisateur = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='verrous_edition',
    )
    utilisateur_nom = models.CharField(max_length=200)
    expire_le = models.DateTimeField()

    class Meta:
        db_table = 'verrous_edition'
        constraints = [
            models.UniqueConstraint(
                fields=['organisation', 'ressource_type', 'ressource_id'],
                name='uniq_verrou_ressource_org',
            ),
        ]
        indexes = [
            models.Index(fields=['expire_le']),
        ]

    def __str__(self):
        return f'{self.ressource_type}:{self.ressource_id} → {self.utilisateur_nom}'

    @property
    def est_actif(self):
        return self.expire_le > timezone.now()
