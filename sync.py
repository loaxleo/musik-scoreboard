import json
import time
import subprocess
from datetime import datetime
from pathlib import Path
import openpyxl

# HIER DEinen kopierten Pfad einfügen (das 'r' vor den Anführungszeichen muss bleiben!)
EXCEL_PATH = Path(r"C:\Users\loale\OneDrive - PHSG\Shortcuts\High Score _Singen&Begleiten üben_ - General\High Score LG26.xlsx")
REPO_PATH = Path(__file__).parent
JSON_PATH = REPO_PATH / "data.json"

def read_excel():
    # data_only=True liest die berechneten Formel-Ergebnisse (Spalte B & C) aus
    wb = openpyxl.load_workbook(EXCEL_PATH, data_only=True)
    sheet = wb.active

    entries = []
    # Ab Zeile 3 stehen die Pseudonyme (Zeile 1 & 2 sind Header)
    for row in sheet.iter_rows(min_row=3, values_only=True):
        name = row[0]
        if not name or str(name).strip() == "":
            continue  # Leere Zeilen überspringen

        minuten = int(row[1] or 0)
        einheiten = int(row[2] or 0)

        entries.append({
            "name": str(name).strip(),
            "minuten": minuten,
            "einheiten": einheiten
        })

    return entries

def git_push():
    subprocess.run(["git", "add", "data.json"], cwd=REPO_PATH, check=True)
    subprocess.run(["git", "commit", "-m", "Auto-Update Scoreboard"], cwd=REPO_PATH, check=True)
    # Holt Änderungen, die von anderswo gepusht wurden (z. B. neues Design), bevor hochgeladen wird
    subprocess.run(["git", "pull", "--rebase", "--autostash"], cwd=REPO_PATH, check=True)
    subprocess.run(["git", "push"], cwd=REPO_PATH, check=True)

def main():
    last_hash = None
    print("🚀 Überwache Excel-Datei auf Änderungen...")

    while True:
        try:
            entries = read_excel()
            current_hash = json.dumps(entries, sort_keys=True)

            if current_hash != last_hash:
                payload = {
                    "updated_at": datetime.now().strftime("%d.%m.%Y %H:%M:%S"),
                    "entries": entries
                }
                JSON_PATH.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
                git_push()
                last_hash = current_hash
                print(f"[{payload['updated_at']}] ✨ Update erkannt & auf GitHub gepusht!")

        except PermissionError:
            # OneDrive schreibt gerade in die Datei -> beim nächsten Durchlauf probieren
            pass
        except Exception as e:
            print(f"Fehler: {e}")

        time.sleep(10)  # Alle 10 Sekunden prüfen

if __name__ == "__main__":
    main()