-- Schéma PostgreSQL Xaliss (noms en français, organisation unifiée)
-- Référence : modèles Django comptes + finances (juillet 2026)
--
-- Prérequis pour une install complète (auth, sessions, allauth) :
--   python manage.py migrate
--
-- Ce fichier couvre les tables métier. Utilisable seul pour import legacy
-- (scripts/migrate_export_to_postgres.py) ou documentation.

BEGIN;

-- ---------------------------------------------------------------------------
-- Organisations (profil + paramètres fusionnés dans une seule table)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organisations (
    id                      BIGSERIAL PRIMARY KEY,
    slug                    VARCHAR(120) NOT NULL UNIQUE,
    nom                     VARCHAR(200) NOT NULL DEFAULT '',
    telephone               VARCHAR(40) NOT NULL DEFAULT '',
    email                   VARCHAR(80) NOT NULL DEFAULT '',
    adresse                 TEXT NOT NULL DEFAULT '',
    site_web                VARCHAR(120) NOT NULL DEFAULT '',
    libelle_devise          VARCHAR(16) NOT NULL DEFAULT 'FCFA',
    categories_produits     JSONB NOT NULL DEFAULT '[]'::jsonb,
    rafraichissement_auto   BOOLEAN NOT NULL DEFAULT TRUE,
    sync_seq                BIGINT NOT NULL DEFAULT 0,
    cree_le                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    modifie_le              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Membres (lien utilisateur Django ↔ organisation)
-- FK auth_user : créée par django.contrib.auth (manage.py migrate)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS membres_organisation (
    id                  BIGSERIAL PRIMARY KEY,
    utilisateur_id      INTEGER NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    organisation_id     BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    role                VARCHAR(20) NOT NULL DEFAULT 'proprietaire'
                        CHECK (role IN ('proprietaire', 'admin', 'membre')),
    login_legacy        VARCHAR(120) NOT NULL DEFAULT '',
    actif               BOOLEAN NOT NULL DEFAULT TRUE,
    cree_le             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (utilisateur_id, organisation_id)
);

-- ---------------------------------------------------------------------------
-- Clients & alias
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
    id                  VARCHAR(64) PRIMARY KEY,
    organisation_id     BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    nom                 VARCHAR(200) NOT NULL,
    telephone           VARCHAR(40) NOT NULL DEFAULT '',
    note                TEXT NOT NULL DEFAULT '',
    provenance          VARCHAR(40) NOT NULL DEFAULT '',
    cree_le             TIMESTAMPTZ,
    modifie_le          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    id_compte_legacy    VARCHAR(120) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS alias_clients (
    id              BIGSERIAL PRIMARY KEY,
    client_id       VARCHAR(64) NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    alias_nom       VARCHAR(200) NOT NULL,
    UNIQUE (client_id, alias_nom)
);

-- ---------------------------------------------------------------------------
-- Transactions & paiements
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
    id                  VARCHAR(128) PRIMARY KEY,
    organisation_id     BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    type                VARCHAR(16) NOT NULL CHECK (type IN ('entrant', 'sortant')),
    montant             NUMERIC(14, 2) NOT NULL,
    description         TEXT NOT NULL DEFAULT '',
    date                TIMESTAMPTZ NOT NULL,
    montant_restant     NUMERIC(14, 2),
    nom_client_facture  VARCHAR(200) NOT NULL DEFAULT '',
    client_id           VARCHAR(64) REFERENCES clients(id) ON DELETE SET NULL,
    id_compte_legacy    VARCHAR(120) NOT NULL DEFAULT '',
    cree_par_id         INTEGER REFERENCES auth_user(id) ON DELETE SET NULL,
    cree_par_nom        VARCHAR(200) NOT NULL DEFAULT '',
    cree_par_role       VARCHAR(20) NOT NULL DEFAULT '',
    modifie_le          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS paiements (
    id              BIGSERIAL PRIMARY KEY,
    transaction_id  VARCHAR(128) NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    client_id       VARCHAR(64) REFERENCES clients(id) ON DELETE SET NULL,
    montant         NUMERIC(14, 2) NOT NULL,
    paye_le         TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS notes (
    id                  VARCHAR(64) PRIMARY KEY,
    organisation_id     BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    titre               VARCHAR(200) NOT NULL,
    contenu             TEXT NOT NULL DEFAULT '',
    client_id           VARCHAR(64) REFERENCES clients(id) ON DELETE SET NULL,
    categorie_produit   VARCHAR(120) NOT NULL DEFAULT '',
    cree_le             TIMESTAMPTZ,
    modifie_le          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Verrous d'édition (concurrence multi-utilisateurs)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS verrous_edition (
    id                  BIGSERIAL PRIMARY KEY,
    organisation_id     BIGINT NOT NULL REFERENCES organisations(id) ON DELETE CASCADE,
    ressource_type      VARCHAR(32) NOT NULL CHECK (ressource_type IN ('transaction', 'client')),
    ressource_id        VARCHAR(128) NOT NULL,
    utilisateur_id      INTEGER NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
    utilisateur_nom     VARCHAR(200) NOT NULL,
    expire_le           TIMESTAMPTZ NOT NULL,
    UNIQUE (organisation_id, ressource_type, ressource_id)
);

-- ---------------------------------------------------------------------------
-- Index
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notes_org_modifie ON notes(organisation_id, modifie_le DESC);
CREATE INDEX IF NOT EXISTS idx_paiements_client ON paiements(client_id, paye_le);
CREATE INDEX IF NOT EXISTS idx_paiements_transaction ON paiements(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transactions_org_date ON transactions(organisation_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_clients_org_nom ON clients(organisation_id, nom);
CREATE INDEX IF NOT EXISTS idx_verrous_expire ON verrous_edition(expire_le);
CREATE INDEX IF NOT EXISTS idx_membres_org ON membres_organisation(organisation_id);
CREATE INDEX IF NOT EXISTS idx_membres_user ON membres_organisation(utilisateur_id);

COMMIT;
