## [1.2.0] - 2026-11-15

### Neu

#### Händler und Läden

- **Händler:** NSCs werden zu Läden mit eigenem Namen, Bild, Beschreibung und Öffnungszeiten. Aufschläge, Ankaufspreise und Ladenkasse sind einstellbar. Spieler öffnen den Laden über das Token oder die Schaltfläche „Handeln“.
- **Laden-Symbol:** Ein Münzsymbol oben rechts am Händler-Token kennzeichnet den Laden. Bei geschlossenem Laden ist es grau und durchscheinend. Die Anzeige lässt sich in den Moduleinstellungen abschalten.
- **Gemeinsam einkaufen:** Spieler und Spielleitung sehen den Warenkorb live. Die Spielleitung kann Preise und Rabatte anpassen; beide Seiten bestätigen den Abschluss. Weitere Spieler können zuschauen. Käufe und Verkäufe erscheinen im Chat und in den Protokollen.
- **Sortiment verwalten:** Suche, Gegenstandsvorschau, Festpreise, Preise für mehrere Stück, unbegrenzter Bestand und Auffüllen bis zum Höchstbestand. Was nicht mehr ins Inventar passt, landet bei aktivierten Haufen neben dem Token.
- **Dienstleistungen und Angebote:** Unterkunft, Verpflegung und andere Leistungen lassen sich direkt im Laden buchen. Zeitlich begrenzte Warenangebote laufen nach Spielzeit ab.
- **Laden-Vorlagen:** Mitgelieferte Händlerprofile bieten Sortimente für die Regeln von 2014 und 2024. Eigene Vorlagen lassen sich im Kompendium bearbeiten, speichern, importieren und exportieren.
- **Kreaturen im Laden:** Die Spielleitung kann Reit- und Lasttiere sowie andere Kreaturen ins Sortiment aufnehmen. Für bekannte Tiere sind Listenpreise hinterlegt; für weitere Kreaturen lässt sich ein Festpreis setzen. Beim Kauf erhält der Spieler eigene Akteure. Ihre verknüpften Tokens werden nach Möglichkeit nahe beim Käufer platziert. Das Stall-Profil enthält Reitpferd, Zugpferd, Pony, Maultier und Schlachtross.

#### Munition

- **Munition einsammeln:** Nach dem Kampf kann die Spielleitung verschossene Munition per Chatkarte zurückgeben: zur Hälfte oder per Würfelwurf. Munitionsarten und Rückgewinnung sind einstellbar; das Einsammeln wird protokolliert.

#### Gruppenkasse

- **Gruppenkasse:** Sparziele mit Fortschrittsbalken und Chatmeldung beim Erreichen des Ziels.

### Geändert

#### Kompendien

- Einheitliche Namen für die Welt-Kompendien: „Pack & Ledger – Behälter“, „Pack & Ledger – Laden-Vorlagen“ und „Pack & Ledger – Logs“. Bestehende Protokoll-Kompendien behalten ihren Namen.

### Behoben

#### Handel und Läden

- Handel setzt bei Fehlern auch Münzbewegungen zurück. Während des Abschlusses sind keine Angebotsänderungen möglich. Zustimmungen zu inzwischen geänderten Angeboten zählen nicht mehr.
- Handel und Läden verhindern Gegenstandskopien, wenn ein anderes Modul die Übergabe blockiert.

#### Gruppenkasse

- Reservierte Beträge der Gruppenkasse bleiben beim Münzwechsel erhalten. Bei Geldmangel werden zuerst Reservierungen des Hauptkontos reduziert.

#### Inventar und Behälter

- Stapel werden nur bei übereinstimmenden Eigenschaften und ohne verbrauchte Ladungen zusammengelegt.
- Platzgrenzen berücksichtigen auch mehrere gleichzeitig hinzugefügte Waffenstapel. Kapazitätsgrenzen gelten auch beim Anlegen von Behältern samt Inhalt.

## [1.1.0] - 2026-11-14

### Neu

#### Munitionsbehälter

- Munitionsbehälter nehmen nur ihre Munition auf.
- Pfeile und Armbrustbolzen passen nur in einen Köcher, einen Armbrustbolzenkasten oder Ehlonnas Köcher, nicht in einen Rucksack oder einen anderen Behälter. Das automatische Einsortieren legt sie in einen passenden Behälter mit Platz.
- Munitionsbehälter werden am Körper getragen und lassen sich nicht in einen Rucksack oder einen anderen Behälter packen. Sie können nie überfüllt werden und reißen daher nie, auch nicht mit „Überfüllen mit Reißrisiko“. Gewöhnliche Behälter mit Munition können weiterhin reißen.
- Neues Welt-Kompendium „Pack & Ledger Behälter“ mit Nadeletui, Schleuderkugelbeutel, Munitionsbeutel, Wurfpfeiletui, Wurfspeerköcher und Wurfmesserscheide. Jeder Behälter nimmt nur die dafür vorgesehene Munition auf.
- Neue Einstellung im Reiter Behälter: „Munitionsbehälter nehmen nur ihre Munition auf“.

#### Münzen aufteilen

- „Aufteilen“ für Münzen in einem Gegenstandshaufen: Die Münzen werden Sorte für Sorte gleichmäßig unter den Spielercharakteren der Gruppe aufgeteilt; was sich nicht gleichmäßig aufteilen lässt, bekommt der Charakter, der aufteilt. Eine Vorschau zeigt vorher, wer was bekommt. Jeder Anteil wird ins Münzprotokoll geschrieben.
- Werden Münzen aufgeteilt, erfahren die anderen Spieler per Chatnachricht, was sie erhalten haben.

#### Gruppenkasse

- Neue Gruppenkasse für gemeinsame Zwecke wie „Allgemein“, „Boot“ oder „Reserve“. Reservierte Münzen bleiben im Geldbeutel des jeweiligen Charakters. Das Gruppen-Inventar zeigt die Gesamtsumme je Zweck und die Beiträge der Charaktere; der Charakterbogen zeigt den reservierten Anteil des Münzbestands.
- Charaktere können eigene Münzen für die Gruppenkasse reservieren, wieder freigeben oder gleichmäßig unter der Gruppe aufteilen. Münzen anderer Charaktere teilt nur die Spielleitung auf. Die Spieler erhalten ihre Anteile per Chatnachricht; Einzahlungen und Entnahmen erscheinen im Münz-Protokoll.
- Vor dem Ausgeben reservierter Münzen erscheint eine Warnung mit den betroffenen Zwecken. Das gilt für Münzfelder, die Münzverwaltung von dnd5e, Rechnungen, Handel und das Ablegen von Münzen. Reines Umwechseln erhält den reservierten Wert und löst keine Warnung aus.
- Gruppenmitglieder können Zwecke umbenennen und leere Zwecke entfernen. Einen Zweck mit reservierten Münzen kann nur die Spielleitung entfernen.
- Neue Einstellung „Gruppenkasse“ im Reiter *Münzen*: ausgeschaltet, mit eigener Schaltfläche am Münzhaufen oder automatische Reservierung aller aus Haufen aufgenommenen Münzen für „Allgemein“. Bei ausgeschalteter Gruppenkasse erscheinen keine Warnungen.

#### Wasserschläuche

- Wasserschläuche nehmen nur Wasser auf, und nicht mehr als ihre Kapazität. Sie werden nie überfüllt und reißen nie. Das automatische Einsortieren legt Wasser zuerst in einen Wasserschlauch.
- Die Spielleitung kann einen einzelnen Wasserschlauch über „Auffüllen“ in seinem Kontextmenü auffüllen. „Wasserschläuche auffüllen“ im Gruppen-Inventar füllt jetzt auch Wasserschläuche, die Behälter sind (dnd5e 2024), mit Pints Wasser.

#### Gemeinsame Behälterregeln

- In Wasserschläuche und Munitionsbehälter kommen keine Münzen, weder in einem Gegenstandshaufen noch im Inventar.
- Die Regeln für Wasserschläuche und Munitionsbehälter gelten unabhängig von „Kapazitätsgrenzen von Behältern durchsetzen“. Ist die Einstellung ausgeschaltet, nehmen gewöhnliche Behälter alles auf, Wasserschläuche und Munitionsbehälter behalten ihre Regeln.

#### Nahrung und Wasser

- Nahrung und Wasser werden an den dnd5e-6.1-Eigenschaften „Nutritious“ und „Hydrating“ erkannt. Bei älteren dnd5e-Versionen zählt stattdessen der Untertyp Nahrung, Wasser oder beides.

### Geändert

#### Gegenstandshaufen

- Ein Spieler öffnet einen Gegenstandshaufen nur, wenn sein Charakter in Reichweite steht (Einstellung „Reichweite für Haufen (Felder)“). Geht der Charakter aus der Reichweite, schließt sich das Fenster des Haufens. Die Spielleitung öffnet jeden Haufen.

#### Behälter und Überfüllung

- Mit „Überfüllen mit Reißrisiko“ fragt das Einlagern in einen vollen Behälter zuerst nach und warnt, dass der Behälter reißen kann.
- Meldungen über überfüllte und gerissene Behälter nennen keine Prozente und kein Reißrisiko mehr, weder Spielern noch der Spielleitung. Das Protokoll behält sie.

#### Rasten

- „Quelle hinzufügen“ im Fenster der langen Rast fügt eine leere Zeile hinzu. Die Quelle muss gewählt werden; bis dahin trägt die Zeile nichts zur Verpflegung bei.

#### Kompatibilität

- Geprüft mit dnd5e 6.1.0.

### Behoben

- CSV-Exporte der Protokolle zeigen Namen, die mit „=“, „+“, „@“ oder „-“ beginnen, als Text, damit eine Tabellenkalkulation sie nicht als Formel ausführt.

## [1.0.0] - 2026-11-09

Erste Veröffentlichung. Eine Funktionsübersicht steht in der README.
