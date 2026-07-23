# Xaliss — Backend Django

## Base de données : `xaliss`

| Paramètre | Valeur |
|-----------|--------|
| Hôte | `localhost:5432` |
| Utilisateur | `postgres` |
| Mot de passe | `postgres` |

## Modèle validé

### `organisations` (tout-en-un)
`nom`, `slug`, `telephone`, `email`, `adresse`, `site_web`, `libelle_devise`, `rafraichissement_auto`

### `transactions` — traçabilité
| Colonne | Description |
|---------|-------------|
| `cree_par_id` | Utilisateur créateur |
| `cree_par_nom` | Nom affiché (« Fatou Diallo ») |
| `cree_par_role` | `proprietaire` / `admin` / `membre` |

Affichage : **Par : Nom · Rôle** sous chaque transaction.

### Connexion
- **E-mail** = identifiant (plus de login `inout`)
- **Mot de passe** hashé (Django PBKDF2)
- **Google** via `django-allauth`

---

## Démarrage

```powershell
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver
```

| URL | Page |
|-----|------|
| http://127.0.0.1:8000/inscription/ | Créer un compte |
| http://127.0.0.1:8000/connexion/ | Se connecter |
| http://127.0.0.1:8000/tableau-de-bord/ | Tableau de bord |

---

## Compte KaayPrint / InOut (données importées)

**Étape obligatoire** — remplacez l'e-mail par le vôtre :

```powershell
python manage.py initialiser_kaayprint --email VOTRE@gmail.com --password "VotreMotDePasseFort"
```

Cette commande :
1. Crée le compte propriétaire (mot de passe **hashé**)
2. Lie l'organisation `inout` / KaayPrint
3. Enregistre `login_legacy = inout`
4. Attribue **toutes les 134 transactions** au propriétaire

`--password` est **obligatoire**. Connexion ensuite : **votre e-mail** + ce mot de passe (ou Google si configuré).

---

## Google OAuth

1. [Google Cloud Console](https://console.cloud.google.com/) → Créer des identifiants OAuth
2. URI de redirection : `http://127.0.0.1:8000/auth/google/login/callback/`
3. Variables d'environnement :

```powershell
$env:GOOGLE_CLIENT_ID="votre-client-id"
$env:GOOGLE_CLIENT_SECRET="votre-secret"
python manage.py runserver
```

---

## Inscription (nouveau business)

Champs demandés :
1. Nom de l'entreprise *
2. Téléphone de l'entreprise *
3. E-mail (connexion) *
4. Mot de passe *
5. Prénom / nom (optionnel)

→ Crée : `utilisateur` + `organisation` + `membre` (propriétaire)

---

## Inviter des membres (phase suivante)

Le modèle `membres_organisation` est prêt (`proprietaire`, `admin`, `membre`).
L'interface d'invitation sera ajoutée ensuite.
