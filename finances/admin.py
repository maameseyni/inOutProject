from django.contrib import admin

from .models import AliasClient, Client, Note, Paiement, Transaction


class AliasClientInline(admin.TabularInline):
    model = AliasClient
    extra = 0


@admin.register(Client)
class ClientAdmin(admin.ModelAdmin):
    list_display = ('nom', 'organisation', 'telephone', 'provenance', 'afficher_total_commande', 'afficher_total_encaisse')
    search_fields = ('nom', 'telephone')
    inlines = [AliasClientInline]

    @admin.display(description='Total commandé')
    def afficher_total_commande(self, obj):
        return obj.get_total_commande()

    @admin.display(description='Total encaissé')
    def afficher_total_encaisse(self, obj):
        return obj.get_total_encaisse()


@admin.register(Note)
class NoteAdmin(admin.ModelAdmin):
    list_display = ('titre', 'organisation', 'client', 'categorie_produit', 'cree_le', 'modifie_le')
    search_fields = ('titre', 'contenu', 'categorie_produit')
    list_filter = ('organisation',)


class PaiementInline(admin.TabularInline):
    model = Paiement
    extra = 0


@admin.register(Transaction)
class TransactionAdmin(admin.ModelAdmin):
    list_display = (
        'description', 'type', 'montant', 'date',
        'cree_par_nom', 'cree_par_role', 'organisation',
    )
    list_filter = ('type', 'organisation', 'cree_par_role')
    search_fields = ('description', 'nom_client_facture', 'cree_par_nom')
    inlines = [PaiementInline]
