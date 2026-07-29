from django.contrib import admin

from .models import (
    AbonnementOrganisation,
    MembreOrganisation,
    Organisation,
    PaiementAbonnement,
    PlanAbonnement,
)


class MembreOrganisationInline(admin.TabularInline):
    model = MembreOrganisation
    extra = 0
    readonly_fields = ('afficher_email', 'afficher_nom', 'cree_le')
    fields = ('utilisateur', 'afficher_email', 'afficher_nom', 'role', 'login_legacy', 'actif', 'cree_le')
    autocomplete_fields = ('utilisateur',)

    @admin.display(description='E-mail (connexion)')
    def afficher_email(self, obj):
        return obj.get_email() if obj.pk else '—'

    @admin.display(description='Nom')
    def afficher_nom(self, obj):
        return obj.get_nom_affichage() if obj.pk else '—'


class AbonnementOrganisationInline(admin.StackedInline):
    model = AbonnementOrganisation
    extra = 0
    max_num = 1
    can_delete = False
    autocomplete_fields = ('plan',)
    fields = (
        'plan',
        'statut',
        'essai_debut',
        'essai_fin',
        'periode_debut',
        'periode_fin',
        'renouvellement_auto',
        'lancement_applique_le',
        'fournisseur',
        'id_externe',
    )
    readonly_fields = ('lancement_applique_le',)


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ('nom', 'slug', 'telephone', 'email', 'cree_le')
    search_fields = ('nom', 'slug', 'telephone', 'email')
    inlines = [AbonnementOrganisationInline, MembreOrganisationInline]


@admin.register(MembreOrganisation)
class MembreOrganisationAdmin(admin.ModelAdmin):
    list_display = (
        'afficher_nom', 'afficher_email', 'organisation',
        'id_organisation', 'role', 'login_legacy', 'actif', 'cree_le',
    )
    list_filter = ('role', 'actif', 'organisation')
    search_fields = (
        'utilisateur__email', 'utilisateur__username',
        'utilisateur__first_name', 'utilisateur__last_name',
        'organisation__nom',
    )
    autocomplete_fields = ('utilisateur', 'organisation')

    @admin.display(description='E-mail (connexion)', ordering='utilisateur__email')
    def afficher_email(self, obj):
        return obj.get_email()

    @admin.display(description='Nom', ordering='utilisateur__first_name')
    def afficher_nom(self, obj):
        return obj.get_nom_affichage()

    @admin.display(description='ID organisation', ordering='organisation_id')
    def id_organisation(self, obj):
        return obj.organisation_id


@admin.register(PlanAbonnement)
class PlanAbonnementAdmin(admin.ModelAdmin):
    list_display = ('code', 'nom', 'prix_mensuel', 'devise', 'actif', 'ordre')
    list_filter = ('actif', 'code')
    search_fields = ('code', 'nom')
    ordering = ('ordre', 'code')


@admin.register(AbonnementOrganisation)
class AbonnementOrganisationAdmin(admin.ModelAdmin):
    list_display = (
        'organisation',
        'plan',
        'statut',
        'essai_debut',
        'essai_fin',
        'periode_fin',
        'lancement_applique_le',
        'renouvellement_auto',
    )
    list_filter = ('statut', 'plan', 'renouvellement_auto')
    search_fields = ('organisation__nom', 'organisation__slug', 'id_externe')
    autocomplete_fields = ('organisation', 'plan')
    readonly_fields = ('cree_le', 'modifie_le', 'lancement_applique_le')


@admin.register(PaiementAbonnement)
class PaiementAbonnementAdmin(admin.ModelAdmin):
    list_display = (
        'organisation',
        'montant',
        'devise',
        'statut',
        'methode',
        'reference_externe',
        'paye_le',
        'cree_le',
    )
    list_filter = ('statut', 'devise', 'methode')
    search_fields = (
        'organisation__nom',
        'organisation__slug',
        'reference_externe',
    )
    autocomplete_fields = ('organisation', 'abonnement')
    readonly_fields = ('cree_le', 'modifie_le')
