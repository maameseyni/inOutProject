# KaayPrint / Xaliss — Gestion financière

Application web Django + PostgreSQL pour la gestion des entrées, sorties, clients et factures.

## Démarrage rapide

```powershell
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

Ou double-cliquez sur **`start-local-server.bat`**.

| URL | Page |
|-----|------|
| http://127.0.0.1:8000/connexion/ | Connexion |
| http://127.0.0.1:8000/inscription/ | Inscription |
| http://127.0.0.1:8000/app/ | Application (transactions, stats, paramètres) |
| http://127.0.0.1:8000/admin/ | Administration Django |

Documentation complète : **`XALISS.md`**  
Fiche produit SaaS : **`SAAS.md`**  
Feuille de route 8→9/10 : **`growupmysaas.md`**  
Guide démarrage rapide : **`DJANGO.md`**  
Mise en production : **`PRODUCTION.md`**

## Structure du projet

```
InOut KaayPrint/
├── manage.py              # Point d'entrée Django
├── config/                # Settings, URLs
├── comptes/               # Auth, organisations, membres
├── finances/              # Transactions, clients, API
├── templates/             # HTML (connexion, app)
├── static/                # CSS, JS, images
├── scripts/               # Import PostgreSQL, sauvegardes
│   └── backups/           # Exports JSON archivés
└── requirements.txt
```

## Compte de test (données importées)

Après import, créez le propriétaire avec **votre** e-mail et un mot de passe fort :

```powershell
python manage.py initialiser_kaayprint --email VOTRE@email.com --password "VotreMotDePasseFort"
```

`--password` est obligatoire (aucun défaut).

## Fonctionnalités

- Transactions entrantes / sortantes, paiements partiels
- Clients, factures PDF/PNG, graphiques, exports Excel
- Profil entreprise, multi-utilisateurs par organisation
- Base PostgreSQL `xaliss`
