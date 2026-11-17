"""
Überwacht die geteilte Excel und pusht Änderungen als data.json auf GitHub.

Start sichtbar:   python sync.py
Start unsichtbar: Doppelklick auf autostart_einrichten.bat (startet bei jedem Login automatisch)
Protokoll:        sync.log im selben Ordner
"""
import json
import logging
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path

import openpyxl

# Pfad zur Excel (das 'r' vor den Anführungszeichen muss bleiben!)
EXCEL_PATH = Path(r"C:\Users\loale\OneDrive - PHSG\Shortcuts\High Score _Singen&Begleiten üben_ - General\High Score LG26.xlsx")
REPO_PATH = Path(__file__).resolve().parent
JSON_PATH = REPO_PATH / "data.json"
LOG_PATH = REPO_PATH / "sync.log"
POLL = 15    # alle 15 s nur den Zeitstempel der Excel anschauen (kostet nichts)
QUIET = 120  # erst pushen, wenn die Excel 2 Minuten lang nicht mehr verändert wurde

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    datefmt="%d.%m.%Y %H:%M:%S",
    handlers=[logging.FileHandler(LOG_PATH, encoding="utf-8"), logging.StreamHandler()],
)
log = logging.getLogger("sync")

# Unter pythonw kein schwarzes Fenster für jeden git-Aufruf öffnen
NO_WINDOW = 0x08000000 if os.name == "nt" else 0


def git(*args, check=True):
    return subprocess.run(
        ["git", *args], cwd=REPO_PATH, check=check,
        capture_output=True, text=True, creationflags=NO_WINDOW,
    )


def read_excel():
    # data_only=True liest die berechneten Formel-Ergebnisse (Spalte B & C)
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True, read_only=True)
    sheet = wb.active
    entries = []
    # Ab Zeile 3 stehen die Pseudonyme (Zeile 1 & 2 sind Header)
    for row in sheet.iter_rows(min_row=3, values_only=True):
        name = row[0] if row else None
        if not name or str(name).strip() == "":
            continue
        entries.append({
            "name": str(name).strip(),
            "minuten": int(row[1] or 0),
            "einheiten": int(row[2] or 0),
        })
    wb.close()
    return entries


def published_entries():
    """Was aktuell in data.json steht (= was online ist)."""
    try:
        return json.loads(JSON_PATH.read_text(encoding="utf-8")).get("entries")
    except Exception:
        return None


def unpushed_commits():
    """Liegen lokale Commits herum, die noch nicht auf GitHub sind?"""
    r = git("rev-list", "--count", "@{u}..HEAD", check=False)
    return r.returncode == 0 and r.stdout.strip() not in ("", "0")


def publish(entries):
    # 1. Zuerst Änderungen von GitHub holen (z. B. neues Design)
    git("pull", "--rebase", "--autostash")

    # 2. data.json schreiben
    payload = {"updated_at": datetime.now().strftime("%d.%m.%Y %H:%M:%S"), "entries": entries}
    JSON_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")

    # 3. Nur committen, wenn sich wirklich etwas geändert hat
    git("add", "data.json")
    if git("diff", "--cached", "--quiet", check=False).returncode != 0:
        git("commit", "-m", "Auto-Update Scoreboard")

    # 4. Pushen (auch Commits, die beim letzten Mal hängen geblieben sind)
    git("push")
    log.info("Update gepusht (Stand %s)", payload["updated_at"])


def main():
    log.info("Überwache %s (Push %d s nach der letzten Änderung)", EXCEL_PATH.name, QUIET)
    last_mtime = None
    changed_at = time.time() - QUIET   # beim Start sofort einmal abgleichen
    pending = True
    retry = unpushed_commits()  # hängengebliebene Commits vom letzten Mal?
    while True:
        try:
            mtime = EXCEL_PATH.stat().st_mtime
            if mtime != last_mtime:
                if last_mtime is not None and not pending:
                    log.info("Excel wird bearbeitet – warte, bis 2 Minuten Ruhe ist")
                last_mtime = mtime
                changed_at = time.time()
                pending = True

            quiet_long_enough = time.time() - changed_at >= QUIET
            if (pending and quiet_long_enough) or retry:
                entries = read_excel()
                if entries != published_entries() or retry:
                    retry = True   # bleibt True, bis der Push geklappt hat
                    publish(entries)
                    retry = False
                pending = False
        except PermissionError:
            pass  # OneDrive schreibt gerade -> beim nächsten Durchlauf
        except subprocess.CalledProcessError as e:
            log.error("git %s fehlgeschlagen: %s", " ".join(e.cmd[1:]), (e.stderr or e.stdout or "").strip())
            time.sleep(60)  # bei Netz-/Git-Problemen nicht im Sekundentakt hämmern
        except Exception as e:
            log.error("Fehler: %r", e)
        time.sleep(POLL)


if __name__ == "__main__":
    main()
