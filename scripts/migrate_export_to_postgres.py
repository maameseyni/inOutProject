#!/usr/bin/env python3
"""
Importe un export JSON KaayPrint vers PostgreSQL Xaliss (tables en français).

Usage :
  python scripts/migrate_export_to_postgres.py kaayprint-export-2026-07-09.json
  python scripts/migrate_export_to_postgres.py export.json --dsn "postgresql://postgres:postgres@localhost:5432/xaliss"
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any

try:
    import psycopg2
except ImportError:
    print("Erreur : pip install psycopg2-binary", file=sys.stderr)
    sys.exit(1)


DEFAULT_ORG_SLUG = "default"
DEFAULT_ORG_NAME = "Organisation importée"

TYPE_MAP = {
    "income": "entrant",
    "expense": "sortant",
    "entrant": "entrant",
    "sortant": "sortant",
}


def parse_iso_date(value: Any) -> datetime | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    s = str(value).strip()
    if not s:
        return None
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(s)
    except ValueError:
        return None


def slugify(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "_", str(text or "default").strip().lower())
    return (s[:120] or "default").strip("_") or "default"


def decimal_or_none(value: Any) -> Decimal | None:
    if value is None or value == "":
        return None
    return Decimal(str(value))


def map_type(value: Any) -> str:
    return TYPE_MAP.get(str(value or "").strip(), "entrant")


def load_export(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    if data.get("format") != "kaayprint-export-v1":
        print("Avertissement : format d'export non reconnu, tentative d'import quand même.")
    return data


def get_dsn(args: argparse.Namespace) -> str:
    if args.dsn:
        return args.dsn
    host = os.environ.get("PGHOST", "localhost")
    port = os.environ.get("PGPORT", "5432")
    db = os.environ.get("PGDATABASE", "xaliss")
    user = os.environ.get("PGUSER", "postgres")
    password = os.environ.get("PGPASSWORD", "postgres")
    return f"postgresql://{user}:{password}@{host}:{port}/{db}"


def ensure_org(cur, slug: str, nom: str) -> int:
    cur.execute(
        """
        INSERT INTO organisations (slug, nom, cree_le)
        VALUES (%s, %s, NOW())
        ON CONFLICT (slug) DO UPDATE SET nom = EXCLUDED.nom
        RETURNING id
        """,
        (slug, nom),
    )
    return cur.fetchone()[0]


def collect_account_ids(export_data: dict) -> list[str]:
    ids: set[str] = set()
    fs = export_data.get("firestore") or {}
    for doc in fs.get("companyProfiles") or []:
        if doc.get("id"):
            ids.add(str(doc["id"]))
    for doc in fs.get("clientLists") or []:
        if doc.get("id"):
            ids.add(str(doc["id"]))
    ls = export_data.get("localStorage") or {}
    by_acc = ls.get("byAccount") or {}
    for key in (by_acc.get("companyProfiles") or {}):
        ids.add(str(key))
    for key in (by_acc.get("clientLists") or {}):
        ids.add(str(key))
    for key in (by_acc.get("appSettings") or {}):
        ids.add(str(key))
    if not ids:
        ids.add("default")
    return sorted(ids)


def merge_company_profile(firestore_profiles: list, local_profiles: dict, account_id: str) -> dict:
    profile: dict = {}
    for doc in firestore_profiles:
        if str(doc.get("id")) == account_id:
            profile.update(doc.get("data") or {})
    local = (local_profiles or {}).get(account_id)
    if isinstance(local, dict):
        for key, val in local.items():
            if val not in (None, "") and key not in profile:
                profile[key] = val
    return profile


def merge_client_list(firestore_lists: list, local_lists: dict, account_id: str) -> list:
    clients: list = []
    seen_ids: set[str] = set()
    for doc in firestore_lists:
        if str(doc.get("id")) != account_id:
            continue
        data = doc.get("data") or {}
        for c in data.get("clients") or []:
            cid = str(c.get("id") or "")
            if cid and cid not in seen_ids:
                clients.append(c)
                seen_ids.add(cid)
    local = (local_lists or {}).get(account_id)
    if isinstance(local, dict):
        for c in local.get("clients") or []:
            cid = str(c.get("id") or "")
            if cid and cid not in seen_ids:
                clients.append(c)
                seen_ids.add(cid)
    return clients


def collect_transactions(export_data: dict) -> list[dict]:
    fs = export_data.get("firestore") or {}
    result: list[dict] = []
    seen: set[str] = set()
    for doc in fs.get("transactions") or []:
        tid = str(doc.get("id") or "")
        data = doc.get("data")
        if tid and isinstance(data, dict) and tid not in seen:
            result.append({"id": tid, "data": data})
            seen.add(tid)
    ls = export_data.get("localStorage") or {}
    local_tx = (ls.get("keys") or {}).get("kaayprint_transactions")
    if isinstance(local_tx, list):
        for t in local_tx:
            if not isinstance(t, dict):
                continue
            tid = str(t.get("id") or "")
            if tid and tid not in seen:
                result.append({"id": tid, "data": t})
                seen.add(tid)
    return result


def import_company_profile(cur, org_id: int, profile: dict, org_nom: str, dry_run: bool) -> int:
    if not profile and not org_nom:
        return 0
    if not dry_run:
        cur.execute(
            """
            INSERT INTO organisations (id, slug, nom, telephone, email, adresse, site_web, libelle_devise, rafraichissement_auto, cree_le, modifie_le)
            SELECT %s, slug, %s, %s, %s, %s, %s, libelle_devise, rafraichissement_auto, cree_le, NOW()
            FROM organisations WHERE id = %s
            ON CONFLICT (id) DO NOTHING
            """,
            (
                org_id,
                profile.get('name', org_nom) if profile else org_nom,
                profile.get('phone', '') if profile else '',
                profile.get('email', '') if profile else '',
                profile.get('address', '') if profile else '',
                profile.get('website', '') if profile else '',
                org_id,
            ),
        )
        cur.execute(
            """
            UPDATE organisations SET
                nom = COALESCE(NULLIF(%s, ''), nom),
                telephone = COALESCE(NULLIF(%s, ''), telephone),
                email = COALESCE(NULLIF(%s, ''), email),
                adresse = COALESCE(NULLIF(%s, ''), adresse),
                site_web = COALESCE(NULLIF(%s, ''), site_web),
                modifie_le = NOW()
            WHERE id = %s
            """,
            (
                profile.get('name', org_nom) if profile else org_nom,
                profile.get('phone', '') if profile else '',
                profile.get('email', '') if profile else '',
                profile.get('address', '') if profile else '',
                profile.get('website', '') if profile else '',
                org_id,
            ),
        )
    return 1


def import_app_settings(cur, org_id: int, settings: dict, dry_run: bool) -> int:
    if not settings:
        return 0
    if not dry_run:
        cur.execute(
            """
            UPDATE organisations SET
                libelle_devise = %s,
                rafraichissement_auto = %s,
                modifie_le = NOW()
            WHERE id = %s
            """,
            (
                str(settings.get("currencyLabel") or "FCFA")[:16],
                settings.get("autoRefreshLocal", True) is not False,
                org_id,
            ),
        )
    return 1


def import_clients(cur, org_id: int, clients: list, account_id: str, dry_run: bool) -> int:
    count = 0
    for c in clients:
        cid = str(c.get("id") or "")
        if not cid:
            continue
        if not dry_run:
            cur.execute(
                """
                INSERT INTO clients (id, organisation_id, nom, telephone, note, provenance, cree_le, id_compte_legacy)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    organisation_id = EXCLUDED.organisation_id,
                    nom = EXCLUDED.nom,
                    telephone = EXCLUDED.telephone,
                    note = EXCLUDED.note,
                    provenance = EXCLUDED.provenance,
                    cree_le = COALESCE(EXCLUDED.cree_le, clients.cree_le)
                """,
                (
                    cid,
                    org_id,
                    str(c.get("name") or "")[:200],
                    str(c.get("phone") or "")[:40],
                    str(c.get("note") or ""),
                    str(c.get("provenance") or "")[:40],
                    parse_iso_date(c.get("createdAt")),
                    account_id,
                ),
            )
            for alias in c.get("aliases") or []:
                alias_nom = str(alias or "").strip()[:200]
                if not alias_nom:
                    continue
                cur.execute(
                    """
                    INSERT INTO alias_clients (client_id, alias_nom)
                    VALUES (%s, %s)
                    ON CONFLICT (client_id, alias_nom) DO NOTHING
                    """,
                    (cid, alias_nom),
                )
        count += 1
    return count


def import_transactions(cur, org_id: int, transactions: list, account_id: str, dry_run: bool) -> tuple[int, int]:
    tx_count = 0
    pay_count = 0
    for doc in transactions:
        tid = str(doc.get("id") or "")
        t = doc.get("data") if isinstance(doc.get("data"), dict) else doc
        if not tid or not isinstance(t, dict):
            continue
        tx_date = parse_iso_date(t.get("date")) or datetime.now(timezone.utc)
        client_id = str(t.get("invoiceClientId")) if t.get("invoiceClientId") else None

        if not dry_run:
            cur.execute(
                """
                INSERT INTO transactions (
                    id, organisation_id, type, montant, description, date,
                    montant_restant, nom_client_facture, client_id, id_compte_legacy
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    organisation_id = EXCLUDED.organisation_id,
                    type = EXCLUDED.type,
                    montant = EXCLUDED.montant,
                    description = EXCLUDED.description,
                    date = EXCLUDED.date,
                    montant_restant = EXCLUDED.montant_restant,
                    nom_client_facture = EXCLUDED.nom_client_facture,
                    client_id = EXCLUDED.client_id
                """,
                (
                    tid,
                    org_id,
                    map_type(t.get("type")),
                    decimal_or_none(t.get("amount")) or Decimal("0"),
                    str(t.get("description") or ""),
                    tx_date,
                    decimal_or_none(t.get("remainingAmount")),
                    (str(t.get("invoiceClient")).strip()[:200] if t.get("invoiceClient") else ''),
                    client_id,
                    account_id,
                ),
            )
            cur.execute("DELETE FROM paiements WHERE transaction_id = %s", (tid,))
            payments = t.get("payments") or [{"amount": t.get("amount"), "date": t.get("date")}]
            for p in payments:
                paid_at = parse_iso_date(p.get("date")) or tx_date
                amount = decimal_or_none(p.get("amount")) or Decimal("0")
                cur.execute(
                    """
                    INSERT INTO paiements (transaction_id, client_id, montant, paye_le)
                    VALUES (%s, %s, %s, %s)
                    """,
                    (tid, client_id, amount, paid_at),
                )
                pay_count += 1
        tx_count += 1
    return tx_count, pay_count


def main() -> None:
    parser = argparse.ArgumentParser(description="Importer un export KaayPrint vers PostgreSQL Xaliss")
    parser.add_argument("export_file", nargs="?", help="Fichier JSON export-data.html")
    parser.add_argument("--dsn", help="URL PostgreSQL")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--schema-only", action="store_true")
    parser.add_argument("--data-only", action="store_true", help="Importer sans recréer le schéma (après Django migrate)")
    args = parser.parse_args()

    schema_path = os.path.join(os.path.dirname(__file__), "postgres_schema.sql")
    dsn = get_dsn(args)

    conn = psycopg2.connect(dsn)
    conn.autocommit = False
    try:
        with conn.cursor() as cur:
            if os.path.isfile(schema_path) and not args.data_only:
                with open(schema_path, "r", encoding="utf-8") as sf:
                    cur.execute(sf.read())
                conn.commit()
                print(f"Schéma appliqué : {schema_path}")

            if args.schema_only:
                return

            if not args.export_file:
                parser.error("export_file requis sauf avec --schema-only")

            export_data = load_export(args.export_file)
            account_ids = collect_account_ids(export_data)
            fs = export_data.get("firestore") or {}
            ls = export_data.get("localStorage") or {}
            by_acc = ls.get("byAccount") or {}

            print(f"Comptes détectés : {', '.join(account_ids)}")
            totals = {"clients": 0, "transactions": 0, "payments": 0, "profiles": 0, "settings": 0}
            org_by_account: dict[str, int] = {}

            for account_id in account_ids:
                slug = slugify(account_id)
                org_nom = account_id if account_id != "default" else DEFAULT_ORG_NAME
                org_id = ensure_org(cur, slug, org_nom)
                org_by_account[account_id] = org_id

                profile = merge_company_profile(
                    fs.get("companyProfiles") or [],
                    by_acc.get("companyProfiles") or {},
                    account_id,
                )
                totals["profiles"] += import_company_profile(cur, org_id, profile, org_nom, args.dry_run)

                settings = (by_acc.get("appSettings") or {}).get(account_id) or {}
                totals["settings"] += import_app_settings(cur, org_id, settings, args.dry_run)

                clients = merge_client_list(
                    fs.get("clientLists") or [],
                    by_acc.get("clientLists") or {},
                    account_id,
                )
                n_clients = import_clients(cur, org_id, clients, account_id, args.dry_run)
                totals["clients"] += n_clients
                print(f"  [{account_id}] clients={n_clients}")

            tx_org_account = account_ids[0]
            tx_org_id = org_by_account[tx_org_account]
            all_tx = collect_transactions(export_data)
            tx_n, pay_n = import_transactions(cur, tx_org_id, all_tx, tx_org_account, args.dry_run)
            totals["transactions"] = tx_n
            totals["payments"] = pay_n
            print(f"  [transactions] org={tx_org_account} tx={tx_n} paiements={pay_n}")

            if args.dry_run:
                conn.rollback()
                print("\nDry-run terminé (aucune donnée écrite).")
            else:
                conn.commit()
                print("\nImport terminé avec succès.")

            print(f"  Profils entreprise : {totals['profiles']}")
            print(f"  Paramètres app      : {totals['settings']}")
            print(f"  Clients             : {totals['clients']}")
            print(f"  Transactions        : {totals['transactions']}")
            print(f"  Paiements           : {totals['payments']}")
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    main()
