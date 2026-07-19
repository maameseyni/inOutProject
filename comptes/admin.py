from django.contrib import admin

from .models import MembreOrganisation, Organisation


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


@admin.register(Organisation)
class OrganisationAdmin(admin.ModelAdmin):
    list_display = ('nom', 'slug', 'telephone', 'email', 'cree_le')
    search_fields = ('nom', 'slug', 'telephone', 'email')
    inlines = [MembreOrganisationInline]


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
