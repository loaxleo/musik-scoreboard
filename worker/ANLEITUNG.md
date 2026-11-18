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

## Gut zu wissen
- **Löschen:** Jede Person kann ihre eigenen Website-Einträge löschen, und zwar auf dem Gerät, auf dem sie sie gemacht hat.
- **Alles ansehen oder korrigieren:** D1 → `musik-scoreboard` → **Console**, z. B.
  - `SELECT * FROM entries ORDER BY id DESC;`
  - `DELETE FROM entries WHERE id = 12;`
  - `DELETE FROM names WHERE name = 'Tippfehler';`
- **Grenzen gegen Spam:** max. 600 Minuten und 20 Einheiten pro Eintrag, max. 30 Einträge pro Stunde und Gerät/Netz.
- **Kosten:** Der Gratis-Plan reicht weit (100 000 Aufrufe pro Tag).
