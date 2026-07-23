# Schéma données Xaliss — Utilisateurs & membres

## Principe : ne pas dupliquer e-mail / mot de passe

| Information | Où c'est stocké | Table SQL |
|-------------|-----------------|-----------|
| **E-mail** (login) | Utilisateur Django | `auth_user.email` |
| **Mot de passe** (hashé) | Utilisateur Django | `auth_user.password` |
| **Prénom / nom** | Utilisateur Django | `auth_user.first_name`, `last_name` |
| **Lien à l'entreprise** | Membre organisation | `membres_organisation` |
| **Rôle** (propriétaire, admin, membre) | Membre organisation | `membres_organisation.role` |
| **ID organisation** | Membre organisation | `membres_organisation.organisation_id` |

Le **mot de passe ne doit jamais** être dans `membres_organisation` — une seule copie hashée sur `auth_user`.

---

## Schéma relationnel

```
auth_user (utilisateur)
├── id
├── email          ← connexion
├── password       ← hashé (jamais en clair)
├── first_name     ← prénom
└── last_name      ← nom

organisations
├── id
├── nom            ← KaayPrint, Ma Boutique…
├── telephone
└── …

membres_organisation (table de liaison)
├── id
├── utilisateur_id     → auth_user.id
├── organisation_id    → organisations.id   (= id_organisation)
├── role               → proprietaire | admin | membre
├── login_legacy       → "inout" (traçabilité ancien compte)
└── actif
```

---

## Exemple : KaayPrint aujourd'hui

```
auth_user
  id: 1
  email: contact@kaayprint.com
  password: pbkdf2_sha256$…   (hash du mot de passe fourni à initialiser_kaayprint)
  first_name: (vide ou prénom)
  last_name: (vide ou nom)

organisations
  id: 1
  slug: inout
  nom: KaayPrint

membres_organisation
  utilisateur_id: 1
  organisation_id: 1
  role: proprietaire
  login_legacy: inout
```

**Connexion :** e-mail + mot de passe → Django vérifie `auth_user` → puis on charge les orgs via `membres_organisation`.

---

## Ajouter un membre à l'organisation (futur)

```
1. Créer auth_user (email + mot de passe hashé + prénom/nom)
   OU l'utilisateur s'inscrit lui-même

2. Créer membres_organisation
   utilisateur_id = …
   organisation_id = …
   role = admin | membre
```

Le membre se connecte avec **son e-mail** et **son mot de passe** — pas besoin de les stocker une 2e fois.

---

## Requête SQL : voir membres avec e-mail et nom

```sql
SELECT
    m.id,
    m.organisation_id AS id_organisation,
    o.nom AS organisation,
    u.email,
    TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS nom,
    m.role,
    m.actif
FROM membres_organisation m
JOIN auth_user u ON u.id = m.utilisateur_id
JOIN organisations o ON o.id = m.organisation_id;
```

---

## Propriétés Python (lecture seule)

Sur `MembreOrganisation` :

```python
membre.get_email()           # e-mail de connexion
membre.get_nom_affichage()   # prénom nom ou e-mail
membre.id_organisation       # = organisation_id
membre.role                  # proprietaire, admin, membre
```

Le mot de passe : `membre.utilisateur.password` (hash, accès admin uniquement).
