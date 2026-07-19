# Grow up my SaaS — Xaliss

> Feuille de route pour passer de **6,5/10** à **8/10** puis **9/10**  
> Dernière mise à jour : juillet 2026

---

## Note actuelle : 6,5 / 10

**MVP avancé / beta privée** — très bon pour KaayPrint, pas encore un SaaS commercial prêt pour le grand public.

| Critère | Note |
|---------|------|
| Produit / métier | 8/10 |
| Architecture | 7/10 |
| UI / UX | 6,5/10 |
| Identité produit | 5/10 |
| Maturité SaaS | 5/10 |
| Prêt production | 5,5/10 |
| Scalabilité | 4/10 |

Voir aussi **`SAAS.md`** (fiche produit) et **`XALISS.md`** (doc technique).

---

## Viser 8/10 — SaaS prêt pour de vrais clients (beta publique)

**Objectif :** un produit cohérent, fiable et présentable, même avec peu d'utilisateurs.

### 1. Identité & première impression (1–2 jours)

- [ ] Logo **Xaliss** (header, PWA, factures, favicon)
- [ ] Harmoniser les derniers restes visuels KaayPrint
- [ ] Page connexion / inscription au même niveau que l'app

### 2. Polish UI sur toute l'app (2–3 jours)

- [ ] **Statistiques** : cartes, espacements, Top 5 lisibles + tooltips
- [ ] **Mobile** : test réel sur téléphone (barre du bas, scroll, formulaires, modales)
- [ ] Rôle auteur : afficher « Propriétaire » au lieu de `proprietaire`
- [ ] Messages d'erreur / succès homogènes

### 3. Mise en production propre (2–3 jours)

- [ ] `DEBUG=False`, `SECRET_KEY` en variable d'environnement
- [ ] HTTPS (Let's Encrypt)
- [ ] Gunicorn + Nginx (ou équivalent)
- [ ] Backups PostgreSQL automatiques
- [ ] Test complet : connexion, ajout transaction, facture PDF, export Excel, PWA install

Voir **`PRODUCTION.md`**.

### 4. Onboarding minimal (1 jour)

- [x] Inscription : prénom, nom, entreprise (déjà en place)
- [ ] Petit texte d'aide au premier lancement (« Ajoutez votre première transaction »)
- [ ] Devise et coordonnées entreprise claires dès le départ

### 5. Qualité perçue (1 jour)

Tester 5 parcours critiques sans bug bloquant :

- [ ] Inscription → 1er entrant → facture
- [ ] Sortant + prestataire
- [ ] Ajout client → réutilisation dans formulaire
- [ ] Export PDF / Excel
- [ ] Déconnexion / reconnexion

**→ À 8/10 :** tu peux montrer Xaliss à d'autres commerçants sans te excuser pour l'UI ou la stabilité.

**Effort estimé :** ~1–2 semaines

---

## Viser 9/10 — SaaS crédible sur le marché

**Objectif :** passer d'un très bon outil perso à un vrai produit SaaS que des inconnus paieraient ou recommanderaient.

### 6. Fonctions SaaS essentielles (1–2 semaines)

- [ ] **Inviter un membre** (admin / collaborateur) par e-mail
- [ ] **Permissions** visibles en UI (qui peut supprimer, modifier l'org)
- [ ] **Multi-organisation** : un user, plusieurs entreprises (modèle DB prêt, UI à faire)
- [ ] Paramètres compte : changer mot de passe, e-mail

### 7. Fiabilité & confiance (1 semaine)

- [ ] Tests automatisés sur l'API (transactions, clients, auth)
- [ ] Monitoring basique (erreurs 500, uptime)
- [ ] Politique de confidentialité + mentions légales (page simple)
- [ ] RGPD minimal : export / suppression compte (même basique)

### 8. Performance & technique (1 semaine)

- [ ] Découper `script.js` en modules (`transactions.js`, `clients.js`, `charts.js`…)
- [ ] Pagination API des transactions (si listes longues)
- [ ] Cache léger (totaux, profil org) si besoin
- [ ] Rate limiting sur login / API

Voir section 16 de **`XALISS.md`** (montée en charge).

### 9. Expérience produit (continu)

- [ ] Onboarding guidé (3 étapes : entreprise → 1er client → 1ère transaction)
- [ ] Notifications utiles (transaction en attente de complément)
- [ ] Rappels clients incomplets (renforcer l'existant)
- [ ] Facture / export encore plus pro (logo Xaliss, mise en page soignée)

### 10. Business & croissance (hors code, mais note 9/10)

- [ ] Offre claire : gratuit vs payant (même simple)
- [ ] 3–5 **beta testeurs** hors KaayPrint (boutique, freelance, artisan)
- [ ] Retours intégrés en 1–2 itérations
- [ ] Landing page Xaliss (1 page : problème, solution, inscription)

**→ À 9/10 :** produit défendable commercialement, pas seulement techniquement solide.

**Effort estimé :** ~1–2 mois après le 8/10

---

## Synthèse

| Niveau | En une phrase | Effort |
|--------|----------------|--------|
| **6,5** (aujourd'hui) | MVP avancé, bon pour KaayPrint | — |
| **8/10** | Propre, en prod, montrable à des clients | ~1–2 semaines |
| **9/10** | Vrai SaaS multi-users, fiable, vendable | ~1–2 mois |

---

## Ordre recommandé (impact maximal)

1. Logo + polish Statistiques + mobile
2. Mise en prod HTTPS + backups
3. Beta testeurs externes
4. Invitations membres + permissions UI
5. Tests API + découpage JS

Le chemin le plus rentable : **8/10 en ~2 semaines** en enchaînant branding → mobile → prod → 3 beta testeurs.

---

## Déjà fait (juillet 2026)

- [x] Django + PostgreSQL multi-tenant
- [x] Navigation sidebar + barre mobile
- [x] Profil utilisateur (prénom/nom à l'inscription, sidebar)
- [x] Polish Paramètres et Transactions
- [x] Messages vides (clients / transactions)
- [x] Branding texte Xaliss (templates, PWA, exports)
- [x] Type-ahead sur les selects personnalisés
- [x] PWA, sync SSE, verrous d'édition, mode hors ligne (base)
- [x] Fiche produit **`SAAS.md`**
