# Xaliss — Documentation du projet

**Xaliss** est la plateforme de gestion financière multi-entreprises qui fait tourner **KaayPrint** (et d'autres organisations). Elle remplace l'ancienne application HTML/Firebase par un **vrai projet Django** connecté à **PostgreSQL**.

Ce document décrit l'architecture, la base de données, les fonctionnalités et le fonctionnement du système.

---

## 1. Qu'est-ce que Xaliss ?

Xaliss permet à chaque entreprise de :

- Enregistrer les **entrants** (paiements clients) et **sortants** (dépenses)
- Gérer un **carnet de clients** avec provenance (WhatsApp, Instagram, etc.)
- Suivre les **paiements partiels** et le reste à payer
- Générer des **factures** (aperçu, impression, export PNG/PDF)
- Visualiser des **statistiques** et graphiques
- Exporter les données en **Excel** ou **PDF**
- Configurer le **profil entreprise** (coordonnées sur les factures, QR code site/WhatsApp)

Chaque inscription crée **une organisation isolée** : les données d'une entreprise ne sont jamais visibles par une autre.

---

## 2. Stack technique

| Couche | Technologie |
|--------|-------------|
| Backend | Django 5+ (Python) |
| Base de données | PostgreSQL (`xaliss`) |
| Auth | Django Auth + `django-allauth` (Google OAuth optionnel) |
| Frontend | HTML/CSS/JS (interface historique KaayPrint, servie par Django) |
| Pont données | `static/js/django-bridge.js` → API REST JSON |
| Fuseau horaire | `Africa/Dakar` |
| Langue | Français (`fr-fr`) |

---

## 3. Structure du projet

```
InOut KaayPrint/
├── manage.py                 # Commandes Django (runserver, migrate…)
├── config/                   # settings.py, urls.py, wsgi.py
├── comptes/                  # Utilisateurs, organisations, membres
├── finances/                 # Transactions, clients, paiements, API
├── templates/                # Pages HTML (connexion, application)
├── static/                   # CSS, JS, images
│   ├── css/style.css
│   ├── js/script.js          # Logique UI (graphiques, factures…)
│   ├── js/django-bridge.js   # Appels API à la place de Firebase
│   └── images/
├── scripts/                  # Import PostgreSQL, sauvegardes JSON
├── requirements.txt
├── XALISS.md                 # Ce document
├── DJANGO.md                 # Guide démarrage rapide
├── SCHEMA_UTILISATEURS.md    # Détail auth / membres
└── EXPORT_DATA.md            # Import données historiques
```

---

## 4. URLs principales

| URL | Description |
|-----|-------------|
| `/` | Redirige vers connexion ou tableau de bord |
| `/connexion/` | Page de connexion (e-mail + mot de passe) |
| `/inscription/` | Créer un compte + une organisation |
| `/completer-inscription/` | Après Google : nommer l'entreprise |
| `/deconnexion/` | Déconnexion (POST) |
| `/tableau-de-bord/` | Redirige vers `/app/` |
| `/app/` | **Application complète** (transactions, stats, paramètres) |
| `/admin/` | Interface d'administration Django |
| `/auth/google/login/` | Connexion Google (si configurée) |

---

## 5. Multi-tenant : organisations et membres

### Principe

1. **Une inscription** = 1 utilisateur Django + 1 organisation + 1 membre (rôle `proprietaire`)
2. Toutes les transactions, clients et paiements sont rattachés à une **organisation**
3. Un utilisateur peut appartenir à plusieurs organisations via `membres_organisation` (prévu pour la suite)

### Rôles

| Rôle | Description |
|------|-------------|
| `proprietaire` | Créateur de l'organisation, accès total |
| `admin` | Administrateur (invitations futures) |
| `membre` | Collaborateur avec accès limité (futur) |

### Règle importante : pas de doublon e-mail/mot de passe

L'e-mail et le mot de passe hashé sont stockés **une seule fois** dans `auth_user` (Django).  
La table `membres_organisation` ne contient que le **lien** utilisateur ↔ organisation + le **rôle**.

```
auth_user                    organisations
├── email (login)            ├── nom
├── password (hashé)         ├── slug (identifiant unique)
├── first_name / last_name   ├── telephone, email, adresse
                             ├── site_web
membres_organisation         ├── libelle_devise (ex. FCFA)
├── utilisateur_id ─────────►├── rafraichissement_auto
├── organisation_id ───────►└── …
├── role
└── login_legacy (traçabilité ancien compte « inout »)
```

---

## 6. Base de données PostgreSQL

### Connexion par défaut

| Paramètre | Valeur |
|-----------|--------|
| Base | `xaliss` |
| Hôte | `localhost:5432` |
| Utilisateur | `postgres` |
| Mot de passe | `postgres` |

Configuration dans `config/settings.py` → `DATABASES`.

### Schéma relationnel

```
organisations
    │
    ├── clients ── alias_clients
    │       │
    │       └── transactions ── paiements
    │               │
    └── membres_organisation ── auth_user
```

---

## 7. Tables détaillées

### `organisations`

Fusion de l'ancien profil entreprise + paramètres app.

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | entier | Clé primaire |
| `slug` | texte | Identifiant unique (`inout` pour KaayPrint) |
| `nom` | texte | Nom affiché (ex. KaayPrint) |
| `telephone` | texte | Téléphone entreprise |
| `email` | texte | E-mail entreprise (sur facture) |
| `adresse` | texte | Adresse multi-lignes |
| `site_web` | texte | Site ou lien WhatsApp (QR code) |
| `libelle_devise` | texte | Devise affichée (défaut : FCFA) |
| `rafraichissement_auto` | booléen | Rafraîchissement auto des données |
| `cree_le` / `modifie_le` | datetime | Horodatage |

### `clients`

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | texte | Identifiant (`cli_…`) |
| `organisation_id` | FK | Organisation propriétaire |
| `nom` | texte | Nom du contact |
| `telephone` | texte | Numéro |
| `note` | texte | Notes libres |
| `provenance` | texte | WhatsApp, Instagram, bouche-à-oreille… |
| `cree_le` | datetime | Date de création |
| `id_compte_legacy` | texte | Ancien identifiant Firebase |

### `alias_clients`

Noms alternatifs pour lier automatiquement les transactions à un client (ex. ancien nom après renommage).

| Colonne | Type |
|---------|------|
| `client_id` | FK → clients |
| `alias_nom` | texte |

### `transactions`

| Colonne | Type | Description |
|---------|------|-------------|
| `id` | texte | Identifiant unique |
| `organisation_id` | FK | Organisation |
| `type` | texte | `entrant` ou `sortant` |
| `montant` | décimal | Montant total de la transaction |
| `description` | texte | Libellé |
| `date` | datetime | Date principale |
| `montant_restant` | décimal | Reste à payer (paiement partiel) |
| `nom_client_facture` | texte | Nom client sur facture (texte libre) |
| `client_id` | FK | Lien vers le carnet clients (optionnel) |
| `cree_par_id` | FK | Utilisateur créateur |
| `cree_par_nom` | texte | Nom affiché sous la transaction |
| `cree_par_role` | texte | Rôle au moment de la création |
| `id_compte_legacy` | texte | Ancien compte Firebase |

**Mapping interface JS ↔ base :**

| Interface (JS) | Base (PostgreSQL) |
|----------------|-------------------|
| `income` | `entrant` |
| `expense` | `sortant` |
| `amount` | `montant` |
| `remainingAmount` | `montant_restant` |
| `invoiceClient` | `nom_client_facture` |
| `invoiceClientId` | `client_id` |

### `paiements`

Historique des encaissements (utile pour la recette du jour et les totaux par client).

| Colonne | Type | Description |
|---------|------|-------------|
| `transaction_id` | FK | Transaction parente |
| `client_id` | FK | Client (copié pour agrégations) |
| `montant` | décimal | Montant encaissé |
| `paye_le` | datetime | Date réelle du paiement |

Chaque complétion de paiement partiel ajoute une ligne. Le bénéfice du jour est calculé sur la **date de chaque paiement**, pas seulement la date de la transaction.

### `membres_organisation`

| Colonne | Type | Description |
|---------|------|-------------|
| `utilisateur_id` | FK | `auth_user` |
| `organisation_id` | FK | `organisations` |
| `role` | texte | `proprietaire`, `admin`, `membre` |
| `login_legacy` | texte | Ancien login (`inout` pour KaayPrint) |
| `actif` | booléen | Membre actif ou désactivé |

---

## 8. Données KaayPrint (importées)

Organisation historique issue de la migration Firebase → PostgreSQL :

| Élément | Valeur |
|---------|--------|
| Organisation | KaayPrint (`slug: inout`) |
| Transactions | 134 |
| Clients | 43 |
| Paiements | 135 |
| Membres | 1 propriétaire |

**Compte de connexion :**

```
E-mail    : contact@kaayprint.com
Mot de passe : inout2#
```

Pour rattacher le compte à **votre** e-mail :

```powershell
python manage.py initialiser_kaayprint --email VOTRE@gmail.com --password "inout2#"
```

Cette commande crée ou met à jour le propriétaire, lie l'organisation `inout`, et attribue toutes les transactions importées au propriétaire.

---

## 9. Application web (`/app/`)

L'interface utilisateur est celle de l'ancienne app KaayPrint, servie par Django :

- **Onglet Transactions** : ajout entrant/sortant, filtres, pagination, édition, suppression
- **Onglet Statistiques** : graphiques Chart.js, bénéfice jour/période
- **Onglet Paramètres** : profil entreprise, liste clients, QR code
- **Devise** : définie à l'inscription (`libelle_devise` en base), chargée via l'API

### Pont Django (`django-bridge.js`)

L'ancien code utilisait Firebase Firestore et `localStorage`. En mode Django :

1. `window.XALISS_DJANGO` injecte l'URL API, le token CSRF et l'e-mail utilisateur
2. `django-bridge.js` intercepte les opérations CRUD et appelle l'API REST
3. Firebase est désactivé ; les données viennent de PostgreSQL

### Affichage auteur

Sous chaque transaction : **Par : Nom · Rôle** (ex. « Par : contact@kaayprint.com · Propriétaire »).

---

## 10. API REST

Préfixe : `/app/api/` — authentification session Django + organisation active requises.

### Transactions

| Méthode | URL | Action |
|---------|-----|--------|
| `GET` | `/app/api/transactions/` | Liste toutes les transactions |
| `POST` | `/app/api/transactions/` | Créer une transaction |
| `PATCH` | `/app/api/transactions/<id>/` | Modifier |
| `DELETE` | `/app/api/transactions/<id>/` | Supprimer |
| `POST` | `/app/api/transactions/<id>/completer/` | Compléter un paiement partiel |

Corps JSON (exemple création) :

```json
{
  "type": "income",
  "amount": 15000,
  "description": "Impression flyers",
  "date": "2026-07-12T10:00:00.000Z",
  "remainingAmount": 5000,
  "invoiceClient": "Mamadou Diop",
  "invoiceClientId": "cli_abc123"
}
```

### Clients

| Méthode | URL | Action |
|---------|-----|--------|
| `GET` | `/app/api/clients/` | Liste des clients |
| `POST` | `/app/api/clients/` | Créer un client |
| `PATCH` | `/app/api/clients/<id>/` | Modifier |
| `DELETE` | `/app/api/clients/<id>/` | Supprimer |

### Organisation

| Méthode | URL | Action |
|---------|-----|--------|
| `GET` | `/app/api/organisation/profil/` | Lire le profil |
| `PATCH` | `/app/api/organisation/profil/` | Mettre à jour |

Réponses d'erreur : `{ "erreur": "Message en français" }`.

---

## 11. Flux utilisateur

### Nouvelle entreprise

```
Inscription → Création auth_user + organisation (nom, téléphone, libelle_devise) + membre (propriétaire)
           → Redirection /app/
           → Organisation vide, prête à l'emploi
```

### Connexion existante

```
Connexion (e-mail + mot de passe ou Google)
        → Vérification membre_organisation actif
        → Redirection /app/
        → Chargement transactions, clients, profil via API
```

### Création d'une transaction

```
Formulaire UI → django-bridge.js → POST /app/api/transactions/
              → Service Python enregistre en base
              → Remplit cree_par_nom / cree_par_role
              → Crée les lignes paiements
              → Retour JSON → mise à jour affichage
```

---

## 12. Démarrage du projet

### Installation

```powershell
cd "chemin\vers\InOut KaayPrint"
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Ou double-cliquez sur **`start-local-server.bat`**.

### Google OAuth (optionnel)

1. [Google Cloud Console](https://console.cloud.google.com/) → identifiants OAuth 2.0
2. URI de redirection : `http://127.0.0.1:8000/auth/google/login/callback/`
3. Variables d'environnement :

```powershell
$env:GOOGLE_CLIENT_ID="votre-client-id"
$env:GOOGLE_CLIENT_SECRET="votre-secret"
python manage.py runserver
```

---

## 13. Commandes utiles

```powershell
# Serveur de développement
python manage.py runserver

# Migrations base de données
python manage.py migrate

# Compte admin Django
python manage.py createsuperuser

# Initialiser / réinitialiser le propriétaire KaayPrint
python manage.py initialiser_kaayprint --email contact@kaayprint.com --password "inout2#"

# Réimporter un export JSON historique
python scripts/migrate_export_to_postgres.py scripts/backups/kaayprint-export-2026-07-09.json --data-only
```

### Vérifications SQL

```sql
SELECT COUNT(*) FROM transactions;
SELECT COUNT(*) FROM clients;
SELECT COUNT(*) FROM paiements;
SELECT type, COUNT(*), SUM(montant) FROM transactions GROUP BY type;

SELECT o.nom, COUNT(t.id) AS nb_transactions
FROM organisations o
LEFT JOIN transactions t ON t.organisation_id = o.id
GROUP BY o.id;
```

---

## 14. Migration depuis Firebase

L'ancienne app stockait les données dans Firestore et `localStorage`. La migration a :

1. Exporté tout en JSON (`scripts/backups/kaayprint-export-2026-07-09.json`)
2. Importé dans PostgreSQL via `scripts/migrate_export_to_postgres.py`
3. Converti les types `income`/`expense` → `entrant`/`sortant`
4. Fusionné profils entreprise et paramètres dans `organisations`
5. Rattaché toutes les données à l'organisation KaayPrint (`slug: inout`)

Voir **`EXPORT_DATA.md`** pour réimporter ou restaurer.

---

## 15. Évolutions prévues

| Fonctionnalité | État |
|----------------|------|
| Application complète KaayPrint | ✅ En place |
| Multi-organisations (1 user → N orgs) | 🔧 Modèle prêt, UI à venir |
| Invitation de membres (admin, membre) | 🔧 Modèle prêt, UI à venir |
| Permissions par rôle | ✅ API + interface (proprietaire, admin, membre) |
| Hébergement production | 📋 `PRODUCTION.md` (Gunicorn, HTTPS, backups) |
| Sync paramètres devise/rafraîchissement en base | ✅ Devise à l'inscription + chargement API ; refresh via `rafraichissement_auto` |
| Montée en charge (50k+ utilisateurs) | 📋 Feuille de route — section 16 |

---

## 16. Montée en charge (feuille de route scale)

Objectif : savoir **quand** et **quoi** changer avant d'atteindre des dizaines de milliers d'utilisateurs.

### 16.1 Deux métriques différentes

| Métrique | Exemple | Impact |
|----------|---------|--------|
| **Utilisateurs inscrits** | 50 000 comptes | Stockage PostgreSQL, index — **gérable** |
| **Utilisateurs connectés en même temps** | 500 à 2 500 en pic | Charge CPU, requêtes/s — **critique** |

En SaaS, en pic on observe souvent **1 à 5 %** des inscrits connectés simultanément.

```
Requêtes polling / seconde ≈ utilisateurs_connectés ÷ intervalle_secondes
```

| Connectés | Polling 30 s | Polling 60 s |
|-----------|--------------|--------------|
| 100 | ~3 req/s | ~2 req/s |
| 1 500 | ~50 req/s | ~25 req/s |
| 2 500 | ~83 req/s | ~42 req/s |
| 50 000 (irréaliste) | ~1 667 req/s | ~833 req/s |

Le polling **toutes les 30 s** qui recharge **toute** la liste des transactions est acceptable pour **KaayPrint aujourd'hui** (1 org, peu d'utilisateurs). Il devient un goulot d'étranglement seulement avec **beaucoup** de connexions simultanées.

### 16.2 État actuel (développement)

| Composant | État | Limite pratique |
|-----------|------|-----------------|
| `runserver` Django | Dev uniquement | 1 développeur |
| API `GET /transactions/` (liste complète) | Fonctionnel | OK si < 5 000 lignes / org |
| Polling 30 s | Activé si `rafraichissement_auto` | OK < ~50 connectés simultanés |
| Isolation `organisation_id` | ✅ Serveur | Scalable |
| Auth session Django | ✅ Serveur | Scalable |
| Static JS/CSS | Django | CDN recommandé dès la prod |
| Cache (Redis) | ❌ Absent | — |
| Pagination API | ❌ Absente | — |
| Temps réel (WebSocket) | ❌ Absent | — |

### 16.3 Ce qui tient bien même à grande échelle

- **Multi-tenant par organisation** : chaque requête ne lit que les données d'une org (`filter(organisation=org)`).
- **PostgreSQL** : millions de lignes avec index sur `organisation_id`, `date`, `client_id`.
- **Auth centralisée** (`auth_user` + `membres_organisation`) : modèle standard SaaS.
- **Logique métier côté serveur** : le navigateur ne décide plus des règles d'accès (contrairement à Firebase/localStorage).
- **Assets statiques** : `script.js`, `style.css`, images → servis par CDN (coût faible).

### 16.4 Ce qui devra changer

| Problème | Symptôme | Solution |
|----------|----------|----------|
| Polling global 30 s | Trop de requêtes si milliers connectés | WebSocket/SSE, ou sync à la demande |
| Liste transactions non paginée | Réponses lentes (Mo de JSON) | `?page=` + `?since=` (delta) |
| Pas de cache | DB sollicitée à chaque refresh | Redis (totaux, profil org) |
| `runserver` | 1 processus | Gunicorn + N workers |
| 1 PostgreSQL sans pool | Connexions épuisées | PgBouncer |
| Exports PDF/Excel en JS | OK côté client | Option serveur async (Celery) pour gros volumes |
| Pas de rate limiting | Abus / brute-force | Nginx ou `django-ratelimit` |

### 16.5 Phases recommandées

#### Phase 0 — Aujourd'hui (KaayPrint, < 20 users actifs)

**Rien à changer.** Architecture adaptée.

- [x] Django + PostgreSQL
- [x] Isolation organisation
- [x] API sécurisée (session + CSRF)
- [x] Polling 30 s
- [ ] `DEBUG=False`, `SECRET_KEY` env, HTTPS (avant mise en prod)

#### Phase 1 — Première production (50–500 inscrits, < 50 connectés)

| Action | Priorité |
|--------|----------|
| Hébergement : Gunicorn + Nginx + PostgreSQL managé | Haute |
| `DEBUG=False`, variables d'environnement | Haute |
| HTTPS (Let's Encrypt) | Haute |
| CDN pour `/static/` | Moyenne |
| Sauvegardes PostgreSQL automatiques | Haute |
| Monitoring basique (logs, uptime) | Moyenne |

#### Phase 2 — Croissance (500–5 000 inscrits, 50–200 connectés)

| Action | Priorité |
|--------|----------|
| **Pagination API** transactions (`page`, `limit`) | Haute |
| Index SQL vérifiés (`organisation_id`, `date DESC`) | Haute |
| **Redis** : cache profil org + totaux | Moyenne |
| PgBouncer (pool connexions DB) | Moyenne |
| Remplacer polling par **refresh manuel + après chaque écriture** | Moyenne |
| Permissions par rôle (`membre` vs `proprietaire`) | Haute |

#### Phase 3 — Scale intermédiaire (5 000–50 000 inscrits, 200–2 500 connectés)

| Action | Priorité |
|--------|----------|
| **Sync delta** : `GET /transactions/?since=2026-07-12T10:00:00Z` | Haute |
| **WebSockets** (Django Channels) ou SSE pour push multi-utilisateurs | Haute |
| Load balancer + plusieurs instances Django | Haute |
| Réplica PostgreSQL lecture seule (stats lourdes) | Moyenne |
| Exports lourds en **tâche async** (Celery + Redis) | Moyenne |
| Rate limiting API | Haute |

#### Phase 4 — Grande échelle (50 000+ inscrits)

| Action | Priorité |
|--------|----------|
| Sharding ou DB par région (si latence mondiale) | Selon besoin |
| File d'attente pour écritures massives | Moyenne |
| Observabilité (Sentry, Datadog, métriques req/s) | Haute |
| Tests de charge (k6, Locust) avant chaque palier | Haute |
| Désactiver polling ; temps réel uniquement | Haute |

### 16.6 Cibles API futures (à implémenter en Phase 2–3)

```
# Aujourd'hui
GET /app/api/transactions/                    → toute la liste

# Phase 2 — pagination
GET /app/api/transactions/?page=1&limit=50

# Phase 3 — sync incrémentale
GET /app/api/transactions/?since=2026-07-12T10:00:00Z

# Phase 3 — temps réel (exemple)
WS  /app/ws/org/<slug>/   → événement { type: "transaction.created", ... }
```

### 16.7 Index PostgreSQL recommandés (déjà partiels)

```sql
-- Vérifier / ajouter si absent
CREATE INDEX IF NOT EXISTS idx_transactions_org_date
    ON transactions (organisation_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_clients_org_nom
    ON clients (organisation_id, nom);

CREATE INDEX IF NOT EXISTS idx_paiements_client_date
    ON paiements (client_id, paye_le);

CREATE INDEX IF NOT EXISTS idx_membres_user_actif
    ON membres_organisation (utilisateur_id, actif);
```

### 16.8 Verdict par taille

| Taille | Polling 30 s | Action |
|--------|--------------|--------|
| 1–50 connectés | ✅ OK | Phase 0–1 |
| 50–200 connectés | ⚠️ Surveiller | Phase 2 : pagination + moins de polling |
| 200–2 500 connectés | ❌ Insuffisant seul | Phase 3 : delta + WebSocket |
| 50 000 connectés simultanés | ❌ Impossible tel quel | Phase 4 : infra distribuée |

**50 000 comptes inscrits** : compatible avec l'architecture actuelle **si** l'infra prod et les index sont en place.

**50 000 utilisateurs en ligne en même temps** : nécessite une refonte de la synchronisation (pas un simple réglage du polling).

### 16.9 Déclencheurs — quand passer à la phase suivante

| Signal | Passer à |
|--------|----------|
| Temps de réponse API > 500 ms en moyenne | Phase 2 |
| > 50 utilisateurs connectés en pic | Phase 2 |
| Org avec > 5 000 transactions | Pagination API |
| Collègues se plaignent du délai de sync | WebSocket / delta (Phase 3) |
| CPU serveur > 70 % en continu | Scale horizontal (Phase 3) |

---

## 17. Fichiers de référence

| Fichier | Contenu |
|---------|---------|
| `XALISS.md` | Documentation complète (ce fichier) |
| `DJANGO.md` | Guide démarrage rapide |
| `SCHEMA_UTILISATEURS.md` | Auth, membres, requêtes SQL |
| `EXPORT_DATA.md` | Import / sauvegarde données |
| `scripts/postgres_schema.sql` | Schéma SQL brut |
| `README.md` | Présentation projet |

---

*Xaliss — KaayPrint · Dernière mise à jour : juillet 2026*
