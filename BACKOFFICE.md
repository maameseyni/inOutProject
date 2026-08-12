# Backoffice Xaliss — Guide ops

> Console interne pour piloter la plateforme SaaS (utilisateurs, abonnements, revenus, charges Xaliss).  
> Distinct de l’app client `/app/` et de l’admin Django `/admin/`.

---

## Accès

| Élément | Détail |
|---------|--------|
| **URL** | http://127.0.0.1:8000/backoffice/ |
| **Auth** | Compte Django connecté (session) |
| **Autorisation** | E-mail listé dans `BACKOFFICE_ALLOWED_EMAILS` (`.env`) |
| **Refus** | HTTP 403 si connecté mais e-mail non autorisé |

```env
BACKOFFICE_ALLOWED_EMAILS=votre@email.com,autre@email.com
```

---

## Onglets

| Onglet | Rôle |
|--------|------|
| **Vue d'ensemble** | KPIs plateforme, répartition abonnements, alertes, **santé financière** |
| **Statistiques** | Graphiques (géo, encaissements, charges, résultat net, connexions…) |
| **Utilisateurs** | Annuaire, filtres, fiches détail |
| **Paiements** | Paiements d’abonnement clients (entrées) |
| **Finances** | **Charges internes Xaliss** + résultat net sur la période |
| **Outils** | Raccourcis admin Django, export Excel, lien app |

Hash URL : `#finances`, `#paiements`, `#utilisateurs`, `#stats`, etc.

---

## Filtre période (barre du haut)

S’applique à la plupart des **flux** (inscriptions, encaissements, charges, graphiques).

| Mode | Usage |
|------|--------|
| **Jour** | Une date précise |
| **Période** | Du / au + presets (7 j, 30 j, mois, trimestre, année…) |
| **Tout** | Historique complet |

**Stock** (indépendant du filtre) : MRR, répartition abonnements actuels, comptes totaux, « En ligne ».

---

## Finances Xaliss (pilotage éditeur)

Séparé des finances des **organisations clientes**. Sert à suivre la rentabilité de Xaliss en tant que SaaS.

### Indicateurs (période active)

| Indicateur | Calcul |
|------------|--------|
| **Encaissé** | Somme des `PaiementAbonnement` réussis sur la période |
| **Charges** | Somme des `ChargePlateforme` sur la période |
| **Résultat net** | Encaissé − charges |

Affichés dans :
- carte **Santé financière** (vue d’ensemble) ;
- pills de l’onglet **Finances** ;
- pills + graphiques de l’onglet **Statistiques**.

### Enregistrer ou modifier une charge

Onglet **Finances** → formulaire :

- Date, montant (XOF), catégorie, libellé, notes (optionnel)
- Catégories : Publicité, Infrastructure, Outils & services, Frais bancaires, Autre

**POST** → `/backoffice/charges/action/` (`action=create`, `update` ou `delete`).

- **Créer** : formulaire vide → Enregistrer
- **Modifier** : bouton « Modifier » sur une ligne → préremplit le formulaire → Enregistrer les modifications (Annuler pour revenir en mode création)

### Liste des charges

- Filtre par catégorie (chips)
- Recherche libellé / notes
- Pagination (10) ou « Tout afficher »
- **Export Excel** (filtres période + liste appliqués)
- Modification inline (formulaire haut de page) et suppression avec confirmation

### Modèle `ChargePlateforme`

| Champ | Description |
|-------|-------------|
| `date_charge` | Date comptable de la dépense |
| `montant` | Montant positif |
| `devise` | Défaut `XOF` |
| `categorie` | `pub`, `infra`, `outils`, `banque`, `autre` |
| `libelle` | Libellé court (200 car.) |
| `notes` | Détail optionnel |
| `cree_par` | Utilisateur backoffice ayant saisi |
| `cree_le` / `modifie_le` | Horodatage |

Table : `charges_plateforme` · Admin Django : **Charge plateforme**.

Migrations : `comptes.0013_chargeplateforme`, `comptes.0014_chargeplateforme_nature_recurrent`.

---

## Paiements abonnement (entrées)

- Liste des `PaiementAbonnement` (tous statuts)
- Filtres : statut, recherche org / référence / méthode
- Liens vers fiches organisation / utilisateurs

---

## Alertes abonnements (vue d’ensemble)

- Expire bientôt (horizon 7 j)
- En retard
- Paiements échoués récents

---

## Messages & toasts

Les retours d’action (charge enregistrée, erreur validation, actions abonnement…) utilisent le **même toast que l’app** :

- Script : `static/js/xaliss-flash.js`
- Toast fixe haut-droite, vert (succès) / rouge (erreur)
- Données Django messages via `templates/partials/django_messages_data.html`

---

## URLs API backoffice

| Route | Nom |
|-------|-----|
| `/backoffice/` | `backoffice` |
| `/backoffice/charges/action/` | `backoffice_charge_action` |
| `/backoffice/charges/export.xlsx` | `backoffice_export_charges_excel` |
| `/backoffice/export.xlsx` | `backoffice_export_excel` |
| `/backoffice/utilisateurs/<id>/` | `backoffice_user_detail` |
| `/backoffice/organisations/<id>/` | `backoffice_org_detail` |
| `/backoffice/organisations/<id>/abonnement/action/` | `backoffice_org_abo_action` |

---

## Code source

| Chemin | Rôle |
|--------|------|
| `comptes/backoffice/core.py` | Logique dashboard, KPIs, graphiques, charges |
| `comptes/backoffice/views.py` | Exports vues |
| `comptes/backoffice/auth.py` | Garde `BACKOFFICE_ALLOWED_EMAILS` |
| `comptes/models.py` | `ChargePlateforme`, abonnements, paiements |
| `templates/backoffice/` | Dashboard, partials (vue, stats, finances…) |
| `static/js/bo-dashboard.js` | Soft-nav, partials AJAX |
| `static/css/backoffice.css` | Styles backoffice |

### Partials AJAX (soft-nav)

| Paramètre | Fragment |
|-----------|----------|
| `?partial=users` | Liste utilisateurs |
| `?partial=payments` | Liste paiements |
| `?partial=finances` | Onglet finances |
| `?partial=refresh` | JSON tous panneaux + graphiques |

---

## Tests

```powershell
python manage.py test comptes.tests_backoffice_finances -v 2
```

Couvre : accès, cycle CRUD charge (create / update / delete), export Excel, filtres, validation, calcul résultat net (encaissements − charges).

---

## Rappels

- Le backoffice **ne remplace pas** un logiciel comptable légal ; c’est un **pilotage ops**.
- Les charges Xaliss **ne sont pas** visibles dans `/app/` des clients.
- Pour la prod : cron abonnements → voir **`PRODUCTION.md`** §6bis.

---

*Dernière mise à jour : août 2026*
