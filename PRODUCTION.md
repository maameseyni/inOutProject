# Mise en production — Xaliss / KaayPrint

Guide pour déployer l'application en conditions réelles (HTTPS, Gunicorn, sauvegardes).

---

## 1. Prérequis serveur

- Python 3.11+
- PostgreSQL 15+
- Nginx (recommandé devant Gunicorn)
- Nom de domaine + certificat SSL (Let's Encrypt)

---

## 2. Configuration environnement

```bash
cp .env.example .env
# Éditer .env — valeurs obligatoires en production :
```

| Variable | Production |
|----------|------------|
| `DJANGO_DEBUG` | `false` |
| `DJANGO_SECRET_KEY` | Chaîne aléatoire 50+ caractères |
| `DJANGO_ALLOWED_HOSTS` | `votre-domaine.com,www.votre-domaine.com` |
| `DJANGO_CSRF_TRUSTED_ORIGINS` | `https://votre-domaine.com` |
| `POSTGRES_PASSWORD` | Mot de passe fort |

Générer une clé secrète :

```powershell
python -c "import secrets; print(secrets.token_urlsafe(50))"
```

---

## 3. Installation

```powershell
cd "chemin\vers\InOut KaayPrint"
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python manage.py migrate
python manage.py collectstatic --noinput
python manage.py initialiser_kaayprint --email admin@votredomaine.com --password "MotDePasseFort#"
```

---

## 4. Lancer avec Gunicorn

### Windows (test)

```powershell
scripts\start-production.bat
```

### Linux (systemd)

```ini
# /etc/systemd/system/xaliss.service
[Unit]
Description=Xaliss Gunicorn
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/xaliss
EnvironmentFile=/opt/xaliss/.env
ExecStart=/opt/xaliss/.venv/bin/gunicorn config.wsgi:application \
    --bind 127.0.0.1:8000 \
    --workers 3 \
    --timeout 120
Restart=always

[Install]
WantedBy=multi-user.target
```

---

## 5. Nginx (exemple)

```nginx
server {
    listen 443 ssl http2;
    server_name votre-domaine.com;

    ssl_certificate     /etc/letsencrypt/live/votre-domaine.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/votre-domaine.com/privkey.pem;

    client_max_body_size 10M;

    location /static/ {
        alias /opt/xaliss/staticfiles/;
        expires 30d;
    }

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## 6. Sauvegardes PostgreSQL

### Windows

```powershell
scripts\backup-postgres.bat
```

### Linux (cron quotidien)

```bash
0 2 * * * pg_dump -U postgres xaliss | gzip > /backups/xaliss-$(date +\%F).sql.gz
```

Conserver les sauvegardes hors du serveur (cloud, disque externe).

---

## 7. Permissions par rôle

| Action | Propriétaire | Admin | Membre |
|--------|:------------:|:-----:|:------:|
| Voir transactions / stats | ✅ | ✅ | ✅ |
| Ajouter / modifier transactions | ✅ | ✅ | ✅ |
| Supprimer transactions | ✅ | ✅ | ❌ |
| Gérer clients (ajout / édition) | ✅ | ✅ | ✅ |
| Supprimer clients / vider liste | ✅ | ✅ | ❌ |
| Modifier coordonnées entreprise | ✅ | ✅ | ❌ |

Les refus sont appliqués **côté serveur** (API 403) et **côté interface** (boutons masqués).

---

## 8. Checklist avant mise en ligne

- [ ] `DJANGO_DEBUG=false`
- [ ] `SECRET_KEY` unique en `.env`
- [ ] HTTPS actif
- [ ] `collectstatic` exécuté
- [ ] Sauvegarde PostgreSQL testée
- [ ] Compte admin Django (`createsuperuser`) si besoin
- [ ] Google OAuth : URI callback en `https://`

---

## 9. Développement local (inchangé)

```powershell
python manage.py runserver
```

Ou `start-local-server.bat` — `DJANGO_DEBUG=true` dans `.env` ou par défaut.

---

*Voir aussi `XALISS.md` §16 pour la montée en charge à long terme.*
