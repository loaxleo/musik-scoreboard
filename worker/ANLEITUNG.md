# Eintragen über die Website – einmalig einrichten

Die Website speichert Einträge in einer kleinen Gratis-Datenbank auf deinem Cloudflare-Konto.
Excel-Einträge und Website-Einträge werden pro Name und Woche zusammengezählt.
Dauer: ca. 10 Minuten, alles im Browser auf https://dash.cloudflare.com.

## 1. Datenbank anlegen
1. Links **Storage & Databases → D1 SQL Database** → **Create**.
2. Name: `musik-scoreboard` → **Create**.
3. In der Datenbank auf **Console** gehen, den ganzen Inhalt von `schema.sql` hineinkopieren → **Execute**.

## 2. Worker anlegen
1. Links **Workers & Pages** → **Create** → **Create Worker** (Vorlage «Hello World»).
2. Name: `musik-scoreboard-api` → **Deploy**.
3. **Edit code** → alles löschen → den ganzen Inhalt von `worker.js` hineinkopieren → **Deploy**.

## 3. Datenbank mit dem Worker verbinden
1. Im Worker: **Settings → Bindings → Add → D1 database**.
2. Variable name: `DB` (genau so, gross geschrieben)
3. D1 database: `musik-scoreboard` → **Add Binding / Deploy**.

## 4. Adresse an Claude schicken
Oben im Worker steht die Adresse, z. B.
`https://musik-scoreboard-api.DEIN-NAME.workers.dev`

Rufe sie mit `/data` am Ende im Browser auf. Es sollte `{"entries":[],"names":[]}` erscheinen.
Dann die Adresse an Claude schicken. Claude trägt sie in `index.html` ein (`API_URL`) und pusht.

## 5. Excel ohne Laptop lesen (Power Automate)
Der Worker ruft einen Power-Automate-Flow auf. Der liest die Excel per Office Script und
schickt die Werte zurück. Dein Laptop muss dafür nicht laufen.

### 5a. Office Script anlegen
1. Die Excel im Browser öffnen → Reiter **Automatisieren** → **Neues Skript**.
2. Alles im Editor löschen, den Inhalt von `scoreboard-lesen.ts` hineinkopieren.
3. Oben den Namen auf `Scoreboard lesen` ändern → **Skript speichern**.
4. Testweise **Ausführen**: Es muss ohne Fehler durchlaufen (die Excel ändert sich nicht).

### 5b. Flow bauen (make.powerautomate.com)
1. **Erstellen → Sofortiger Cloudflow** (oder automatisiert → Überspringen).
2. Trigger **When an HTTP request is received**
   - *Who can trigger the flow?* → **Anyone**
3. **+** → Aktion **Excel Online (Business) → Run script**
   - Location: die Teams-Gruppe «High Score _Singen&Begleiten üben_»
   - Document Library: **Documents / Dokumente**
   - File: `General/High Score LG26.xlsx` (über das Ordnersymbol wählen)
   - Script: **Scoreboard lesen**
4. **+** → Aktion **Response** (Request → Response)
   - Status Code: `200`
   - Headers: `Content-Type` = `application/json`
   - Body: über den Blitz / «Dynamischer Inhalt» → **result** (vom Run script)
5. Flow benennen (z. B. «Scoreboard Excel lesen») → **Save**.
6. Beim Trigger erscheint jetzt die **HTTP URL** → kopieren.

### 5c. Worker verbinden
1. Cloudflare → Worker → **Edit code** → neuen Inhalt von `worker.js` einfügen → **Deploy**.
2. **Settings → Variables and Secrets → Add** → Type **Secret**, Name `FLOW_URL`, Value = die HTTP URL → **Deploy**.
3. Test: `https://musik-scoreboard-api.leonard-loacker.workers.dev/excel?fresh=1`
   zeigt die Excel-Daten (dauert beim ersten Mal ein paar Sekunden).

Die Website holt die Excel dann direkt (max. 1 Min. alt, mit «Aktualisieren» sofort).
Klappt das einmal nicht, nimmt sie automatisch die Daten vom Laptop-Skript.

## Gut zu wissen
- **Löschen:** Jede Person kann ihre eigenen Website-Einträge löschen, und zwar auf dem Gerät, auf dem sie sie gemacht hat.
- **Alles ansehen oder korrigieren:** D1 → `musik-scoreboard` → **Console**, z. B.
  - `SELECT * FROM entries ORDER BY id DESC;`
  - `DELETE FROM entries WHERE id = 12;`
  - `DELETE FROM names WHERE name = 'Tippfehler';`
- **Grenzen gegen Spam:** max. 600 Minuten und 20 Einheiten pro Eintrag, max. 30 Einträge pro Stunde und Gerät/Netz.
- **Kosten:** Der Gratis-Plan reicht weit (100 000 Aufrufe pro Tag).
