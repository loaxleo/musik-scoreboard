/**
 * Office Script "Scoreboard lesen"
 * Gibt alle Zellwerte des ersten Tabellenblatts ab A1 zurück (berechnete Werte, nicht die Formeln).
 * Wird vom Power-Automate-Flow aufgerufen. Ändert nichts an der Excel.
 */
function main(workbook: ExcelScript.Workbook): string {
  const sheet = workbook.getWorksheets()[0];
  const used = sheet.getUsedRange(true);
  if (!used) return "[]";

  // Ab A1 lesen, damit Zeile 1 = Spaltenköpfe und Spalte A = Benutzernamen bleiben
  const rows = used.getRowIndex() + used.getRowCount();
  const cols = used.getColumnIndex() + used.getColumnCount();
  const values = sheet.getRange("A1").getAbsoluteResizedRange(rows, cols).getValues();

  return JSON.stringify(values);
}
