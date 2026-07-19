# Xaliss — Fiche produit SaaS

> Note de référence — juillet 2026  
> Produit : **Xaliss** · Premier client / tenant : **KaayPrint** (imprimerie, slug `inout`)

---

## En une phrase

**Xaliss** est un SaaS de gestion financière pour les petites entreprises : entrants, sortants, clients, factures, statistiques — chaque entreprise a son espace isolé.

---

## Positionnement

| | |
|---|---|
| **Cible** | Commerçants, artisans, freelances, PME (boutique, atelier, prestataire…) |
| **Besoin** | Suivre l'argent qui entre et sort, facturer, connaître sa recette et son bénéfice |
| **Différenciation** | Simple, en français, adapté au contexte local (FCFA, WhatsApp, mobile-first, PWA) |
| **Modèle** | Multi-tenant : 1 inscription = 1 organisation + 1 propriétaire ; invitations membres prévues |

---

## Parcours utilisateur

```
Inscription (e-mail, prénom, nom, entreprise, devise)
    → Connexion
    → /app/ : Transactions · Statistiques · Paramètres
    → (optionnel) Google OAuth + compléter l'entreprise
```

- **Identité sidebar** : prénom + nom de l'utilisateur (saisi à l'inscription), pas le nom de l'entreprise.
- **Nom entreprise** : Paramètres → coordonnées facture (`organisations.nom`).
- **Auteur transaction** : copie figée en base (`cree_par_nom`, `cree_par_role`) au moment de la création.

---

## Fonctionnalités livrées

| Module | Contenu |
|--------|---------|
| **Transactions** | Entrants / sortants, paiement partiel, compléments, filtres, recherche, pagination |
| **Clients** | Carnet, provenance, alias, export Excel, lien factures |
| **Factures** | Aperçu, impression, PNG/PDF, QR site / WhatsApp |
| **Statistiques** | Recette, bénéfice, graphiques (évolution, Top 5, périodes) |
| **Paramètres** | Coordonnées entreprise, devise, clients, install PWA |
| **Technique** | API REST Django, PostgreSQL, sync SSE, verrous d'édition, mode hors ligne (PWA) |
| **Sécurité** | Auth session, CSRF, isolation par `organisation_id`, permissions par rôle |

---

## État UI / UX (juillet 2026)

### Fait

- Navigation **sidebar** desktop (repliable) + **barre bas** mobile
- Profil sidebar : prénom/nom utilisateur
- Polish **Paramètres** (cartes, boutons 48px, grille, marges `--app-layout-gutter`)
- Polish **Transactions** (même niveau que Paramètres)
- Messages vides (liste transactions / clients)
- Branding texte **Xaliss** (templates, PWA, exports — pas encore l'image logo)
- Inscription : prénom et nom **obligatoires**

### À faire (priorité)

| Priorité | Sujet |
|----------|--------|
| Haute | Logo image Xaliss (remplacer asset KaayPrint) |
| Haute | Statistiques — libellés Top 5 + tooltips |
| Moyenne | Polish page Statistiques (cartes, espacements) |
| Moyenne | Mobile — revue Paramètres + Statistiques |
| Moyenne | Afficher « Propriétaire » au lieu de `proprietaire` sous les transactions |
| Basse | Mettre à jour `cree_par_nom` historique en base (imports « KaayPrint ») |
| Prod | Checklist PWA, hors ligne, permissions, PDF |
| Prod | Découper `script.js` (~6000 lignes) |
| Prod | Tests sur téléphone réel |

---

## Architecture (résumé)

```
Navigateur (/app/)
    → django-bridge.js → API /app/api/*
    → finances/services/*.py → PostgreSQL (base xaliss)
```

| Couche | Techno |
|--------|--------|
| Backend | Django 5+, Python |
| Base | PostgreSQL |
| Auth | Django + django-allauth (Google optionnel) |
| Frontend | HTML/CSS/JS (PWA) |
| Fuseau | Africa/Dakar |

Doc technique détaillée : **`XALISS.md`**  
Démarrage : **`DJANGO.md`** · Production : **`PRODUCTION.md`**

---

## Données de référence (dev)

| Élément | Valeur |
|---------|--------|
| Organisation test | KaayPrint (`slug: inout`) |
| Compte test | `contact@kaayprint.com` / `inout2#` |
| Transactions importées | ~134 |
| Clients importés | ~43 |

---

## Évolutions produit (backlog)

- **Multi-org** : un utilisateur, plusieurs entreprises (modèle DB prêt)
- **Invitations** : admin, membre avec permissions
- **Abonnements** : limites free / premium (à définir côté business)
- **Scale** : pagination API, Redis, WebSocket — voir section 16 de `XALISS.md`

---

## Fichiers clés

| Fichier | Rôle |
|---------|------|
| `templates/finances/application.html` | Interface principale |
| `static/js/script.js` | UI (graphiques, factures, listes) |
| `static/js/django-bridge.js` | Pont API, sync, verrous |
| `static/css/style.css` | Design system (gutter, cartes, boutons) |
| `comptes/` | Auth, organisations, inscription |
| `finances/` | Transactions, clients, API |

---

*Dernière mise à jour : juillet 2026*
