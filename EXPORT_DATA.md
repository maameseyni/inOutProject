# Export et import des données KaayPrint / Xaliss

Guide pour importer un export JSON historique dans PostgreSQL (migration depuis l'ancienne app Firebase).

> Les données KaayPrint sont déjà importées dans la base `xaliss`.  
> Sauvegarde archivée : `scripts/backups/kaayprint-export-2026-07-09.json`

---

## 1. Import dans PostgreSQL

### Prérequis

```bash
pip install psycopg2-binary
pip install -r requirements.txt
```

### Créer la base (si nécessaire)

```powershell
$env:PGPASSWORD='postgres'
psql -U postgres -c "CREATE DATABASE xaliss ENCODING 'UTF8';"
```

### Appliquer le schéma Django

```bash
python manage.py migrate
```

Alternative SQL seul : `scripts/postgres_schema.sql`

### Importer l'export JSON

```bash
python scripts/migrate_export_to_postgres.py scripts/backups/kaayprint-export-2026-07-09.json --data-only

python scripts/migrate_export_to_postgres.py mon-export.json \
  --data-only \
  --dsn "postgresql://postgres:postgres@localhost:5432/xaliss"
```

### Initialiser le compte propriétaire

```bash
python manage.py initialiser_kaayprint --email contact@kaayprint.com --password "inout2#"
```

---

## 2. Tables PostgreSQL

| Table | Contenu |
|-------|---------|
| `organisations` | Entreprise + paramètres |
| `clients` / `alias_clients` | Carnet de contacts |
| `transactions` | Entrants / sortants |
| `paiements` | Historique des encaissements |
| `membres_organisation` | Utilisateurs ↔ organisation |

Schéma : `scripts/postgres_schema.sql`  
Doc utilisateurs : `SCHEMA_UTILISATEURS.md`

---

## 3. Vérifier l'import

```sql
SELECT COUNT(*) FROM transactions;
SELECT COUNT(*) FROM clients;
SELECT COUNT(*) FROM paiements;
SELECT type, COUNT(*), SUM(montant) FROM transactions GROUP BY type;
```

---

## Fichiers utiles

| Fichier | Rôle |
|---------|------|
| `scripts/postgres_schema.sql` | Schéma PostgreSQL |
| `scripts/migrate_export_to_postgres.py` | Import JSON → Postgres |
| `scripts/backups/` | Exports JSON archivés |

---

*Dernière mise à jour : juillet 2026*
