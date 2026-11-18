-- Einmal in der D1-Konsole ausführen
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT    NOT NULL,
  week       TEXT    NOT NULL,          -- z. B. 2026-W47
  kw         INTEGER NOT NULL,          -- 47
  minuten    INTEGER NOT NULL,
  einheiten  INTEGER NOT NULL,
  created_at TEXT    NOT NULL,
  token      TEXT    NOT NULL,          -- nur wer den Token hat, kann löschen
  ip         TEXT
);
CREATE INDEX IF NOT EXISTS idx_entries_ip ON entries (ip, created_at);

CREATE TABLE IF NOT EXISTS names (
  name       TEXT PRIMARY KEY COLLATE NOCASE,
  created_at TEXT NOT NULL
);
