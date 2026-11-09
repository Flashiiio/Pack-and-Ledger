# Pack & Ledger: Inventar, Münzen & Charakter-Protokoll

[![stable](https://img.shields.io/github/v/release/Flashiiio/Pack-and-Ledger.svg?label=stable&display_name=tag&sort=date&cacheSeconds=3600)](https://github.com/Flashiiio/Pack-and-Ledger/releases/latest) ![downloads](https://img.shields.io/github/downloads/Flashiiio/Pack-and-Ledger/pack-and-ledger.zip?label=downloads&displayAssetName=false) ![license](https://img.shields.io/github/license/Flashiiio/Pack-and-Ledger?label=license)

🇬🇧 [English version](README.md)

Pack & Ledger erweitert die Inventarverwaltung für D&D 5e in Foundry VTT: Es setzt die Kapazitätsgrenzen von Behältern durch und ergänzt Handel sowie gemeinsame Vorräte. Das Modul protokolliert außerdem Münzbewegungen, Änderungen an Charakteren und seine eigenen Aktivitäten.

- **Inventar:** Das Modul setzt die vorhandenen Kapazitätsgrenzen von Behältern beim Verstauen durch. Außerdem begrenzt es die Anzahl der direkt am Körper getragenen Gegenstände.
- **Gegenstandshaufen und Handel:** Gegenstände lassen sich auf der Karte ablegen, in Reichweite aufheben und zwischen Charakteren tauschen.
- **Vorräte und Rasten:** Die Gruppe behält Nahrung und Wasser im Blick und teilt sie bei gemeinsam ausgerufenen Rasten auf.
- **Protokolle:** Münzbewegungen, Charakteränderungen und Modulaktivitäten werden protokolliert.

Viele Funktionen lassen sich in den Moduleinstellungen einzeln aktivieren und anpassen. Die folgenden Abschnitte beschreiben ihr Verhalten bei aktivierter Funktion.

## 🎒 Behälter

- Pack & Ledger prüft beim Verstauen die im Behälter eingestellten Gewichts- und Stückzahlgrenzen. Auch eine Erhöhung der Menge oder des Gewichts bereits verstauter Gegenstände wird geprüft. Ein Grenzwert von 0 bedeutet unbegrenzte Kapazität.
- Verschachtelte Behälter und ihr Inhalt werden mitgerechnet. Das Modul prüft auch die Grenzen der übergeordneten Behälter. Die Eigenschaft „gewichtsloser Inhalt“ wird bei der Gewichtsberechnung berücksichtigt.
- Standardmäßig verhindert das Modul das Überfüllen. Wahlweise lässt sich Überfüllen mit einem einstellbaren Risiko erlauben: Beim Überschreiten der Kapazität kann der Behälter reißen. Dafür braucht der Charakter einen Token auf einer Szene, und eine Spielleitung muss angemeldet sein. Die darin verstauten Gegenstände verteilen sich dann als Gegenstandshaufen um den Token.
- Zerrissene Behälter nehmen keine weiteren Gegenstände auf. Über den Eintrag *Behälter reparieren* im Kontextmenü des Gegenstands lassen sie sich wieder nutzbar machen.

## 🧍 Plätze am Körper

Physische Gegenstände außerhalb von Behältern belegen je nach Kategorie Plätze am Körper. Für Waffen, Schilde, Rüstungen, Kleidung, Werkzeuge, Rucksäcke, Krüge und kleine Gegenstände (im Modul „Trinkets“ genannt) gelten eigene, einstellbare Limits. Standardmäßig gelten diese Regeln für Spielercharaktere; sie lassen sich auch auf Nichtspielercharaktere (NSC) ausweiten.

- Waffen zählen einzeln, auch innerhalb eines Stapels: Fünf Langschwerter belegen fünf Waffenplätze. Eine Ausnahme sind Dolche: Zwei Dolche teilen sich einen Platz.
- In den übrigen Kategorien zählt ein Stapel als ein Platz. Für Trinkets gilt zusätzlich eine einstellbare Gewichtsgrenze pro Stück.
- Gegenstände ohne passenden Platz müssen in einen Behälter, sofern sie nicht als „frei“ gelten. Wenn ein neu hinzugefügter Gegenstand am Körper keinen erlaubten Platz findet, kann das Modul ihn automatisch in einem Behälter mit ausreichend Platz verstauen. Neue Behälter selbst sind von diesem Automatismus ausgenommen.

Das Modul erkennt die Kategorie eines Gegenstands anhand seines Typs und Namens. Die Namensmuster für Kleidung, Krüge, Trinkets und Gegenstände ohne Platzbedarf lassen sich in den Einstellungen ändern und direkt testen. Die Spielleitung kann die Kategorie auch manuell festlegen oder einen Gegenstand als „frei“ (ohne Platzbedarf) bzw. „immer zu verstauen“ markieren.

Auf Wunsch wird ein einstellbarer Anteil des im Charakterbogen eingetragenen Körpergewichts auf das getragene Gewicht angerechnet.

## 💰 Gegenstandshaufen

- Physische Gegenstände wie Ausrüstung oder Verbrauchsgüter lassen sich auf die Karte ziehen. Sie bilden einen neuen Gegenstandshaufen oder werden einem bestehenden Haufen hinzugefügt. Spieler können nur Gegenstände aus eigenen Inventaren oder erreichbaren Haufen bewegen.
- Charaktere in der eingestellten Reichweite können einzelne Gegenstände, ganze Stapel oder den gesamten Inhalt aufnehmen, soweit die Inventarregeln dies zulassen. Die Spielleitung ist von der Reichweitenprüfung ausgenommen.
- Auch Münzen lassen sich ablegen und aufheben. Sie können außerdem in Behälter gelegt oder daraus entnommen werden, während diese in einem Haufen liegen.
- Leere Haufen werden standardmäßig automatisch gelöscht. Truhen mit einem eingerichteten Schloss bleiben auch leer bestehen. Automatisch vergebene Haufennamen enthalten keine Mengenangaben.

**Versteckte Haufen** lassen sich innerhalb der eingestellten Suchreichweite durch eine ausreichend hohe Wahrnehmungsprobe entdecken. Standardmäßig wird beim Bewegen eines Tokens mit Spielerbesitz auch dessen passive Wahrnehmung geprüft. Ein entdeckter Haufen wird für alle sichtbar. Verschiebt die Spielleitung einen Haufen, sehen Spieler dessen Bewegungslineal nicht.

**Verschlossene Truhen** lassen sich mit einem passenden Schlüssel im Inventar oder einer erfolgreichen Probe mit Diebeswerkzeug öffnen. Den Namen des passenden Schlüssels und den Schwierigkeitsgrad legt die Spielleitung fest. Ein mysteriöser Schlüssel hat eine Erfolgschance von 5 % und wird bei Erfolg verbraucht. Pro Charakter ist damit ein Versuch je Schloss möglich; erneutes Verschließen setzt die Versuche zurück.

**Im Haufen-Fenster** kann die Spielleitung:

- den Haufen umbenennen, zum Beispiel in „Verdächtiger Sack“;
- den Haufen verstecken oder verschließen und seinen Münzbestand festlegen;
- Gegenstände als unidentifiziert markieren, sodass Spieler nur den dafür vorgesehenen Namen und die zugehörige Beschreibung sehen.

Über einen Knopf in der Token-Steuerung kann die Spielleitung außerdem an beliebiger Stelle einen Münzhaufen ablegen.

Tränke und Schriftrollen, die die Spielleitung aus der Gegenstands-Seitenleiste oder einem Kompendium auf die Karte zieht, werden standardmäßig als unidentifiziert ausgelegt. Vorhandene unidentifizierte Namen und Beschreibungen bleiben erhalten; fehlen sie, ergänzt das Modul beispielsweise „Unbekannter Trank“ bzw. „Unbekannte Schriftrolle“. Für die Spielleitung bleibt der tatsächliche Name im Haufen-Fenster sichtbar. Aus Charakterinventaren abgelegte Gegenstände behalten ihren bisherigen Identifizierungsstatus.

## 🤝 Handel

Über den Knopf *Handeln* unter der Spielerliste können zwei Charaktere Gegenstände und Münzen tauschen. Auch der Handel mit NSC ist möglich; für NSC ohne Spieler übernimmt die Spielleitung.

Beide Seiten stellen ihre Angebote in einem gemeinsamen Fenster zusammen und sehen Änderungen sofort. Jede Angebotsänderung setzt beide Zustimmungen zurück. Sobald beide zustimmen, prüft das Modul die Angebote und überträgt die Gegenstände und Münzen. Reicht der Platz beim Empfänger nicht aus, wird der Tausch zurückgenommen. Der abgeschlossene Handel erscheint im Chat.

Standardmäßig müssen die beteiligten Tokens in Handelsreichweite stehen. Die Reichweite ist einstellbar. Handelt die Spielleitung für beide Seiten, entfällt diese Prüfung.

## 🍞 Gruppen-Inventar

Das Gruppen-Inventar fasst die Vorräte der Spielercharaktere und der mitgeführten Lager in einem Fenster zusammen, das allen zur Verfügung steht. Die Gegenstände bleiben dabei in den jeweiligen Inventaren. Das Fenster lässt sich über die Token-Steuerung öffnen. Im Standard-Charakterbogen gibt es zusätzlich eine Kachel neben den Behältern.

- **Übersicht:** Berechnet anhand des eingestellten Tagesbedarfs, für wie viele volle Tage Nahrung und Wasser reichen. Außerdem zeigt sie die Anzahl weiterer Vorräte, etwa Fackeln oder Lampenöl. Um eine weitere Gegenstandsart zu erfassen, zieht die Spielleitung einen entsprechenden Gegenstand auf *Gegenstand verfolgen*.
- **Charaktere:** Zeigt, wie viel Nahrung, Wasser und weitere erfasste Vorräte jeder Charakter bei sich trägt.
- **Lager:** Zeigt den Inhalt von Akteuren, die die Spielleitung im Kopfbereich ihres Bogens als Lager markiert hat, etwa einem Wagen. Ein Schalter im Gruppen-Inventar legt fest, ob das Lager die Gruppe begleitet. Zurückgelassene Lager zählen nicht zum verfügbaren Vorrat; Spieler können darin nichts verändern, ablegen oder entnehmen. Die Spielleitung kann sie weiterhin bearbeiten.

Die Gegenstände sind nach Kategorien sortiert: Wasser, Nahrung, Tränke, Gifte, Schriftrollen, Trinkets, Munition, Waffen und sonstige Gegenstände.

Als Nahrung oder Wasser erkennt das Modul Verbrauchsgüter vom Typ „Nahrung“ mit dem passenden Untertyp „Nahrung“, „Wasser“ oder „beides“. Bei Verbrauchsgütern und Beutegegenständen prüft es zusätzlich die Namensmuster in den Einstellungen.

Bei Gegenständen mit Ladungen zählt das Modul die verbleibenden Ladungen des gesamten Stapels, andernfalls die Stückzahl. Beispiel: Fünf volle Wasserschläuche mit jeweils vier Pints ergeben 20 Pints Wasser. Nahrung wird in halben Rationen verbraucht: Isst ein Charakter nur eine halbe Ration, merkt sich das Modul die angebrochene Ration und zieht sie erst ab, wenn auch die zweite Hälfte gegessen ist. Im Gruppen-Inventar erscheint der Vorrat dann z. B. als 2,5 Rationen. Werden beim Verbrauch einzelne Wasserschläuche eines Stapels geleert, trennt das Modul die leeren von den noch gefüllten. Leere Wasserschläuche bleiben im Inventar. Die Spielleitung kann sie in der Übersicht des Gruppen-Inventars mit „Wasserschläuche auffüllen“ wieder füllen. Das gilt für die Charaktere und die Lager bei der Gruppe; aufgefüllte Stapel werden dabei wieder zusammengeführt.

**Magische Quellen** fließen ebenfalls in die Berechnung der verbleibenden Vorratstage ein. Bei der Zuteilung während einer Rast gilt mit dem Standard-Tagesbedarf:

- Ein *Alchemy Jug* liefert pro Tag entweder jeweils eine halbe Ration für bis zu fünf Personen oder jeweils den Tagesbedarf an Wasser für bis zu 16 Personen.
- Ein *Tankard of Plenty* liefert pro Tag den Wasserbedarf für bis zu zwei Personen. Sein Besitzer wird zuerst versorgt.

Die tägliche Nutzung wird bei Tagesanbruch anhand der Foundry-Weltzeit zurückgesetzt. Bei einer ausgerufenen langen Rast mit der Option *Neuer Tag* stehen die magischen Quellen ebenfalls wieder zur Verfügung. Die Vorratsprognose nimmt an, dass Alchemy Jugs täglich die jeweils benötigte Nahrung oder das Wasser liefern.

## 🏕️ Rasten

Über den Knopf *Rast* unter der Spielerliste ruft die Spielleitung eine Rast für die Gruppe aus. Dabei legt sie fest:

- ob es eine kurze oder lange Rast ist und welche Charaktere teilnehmen;
- welche Charaktere gar nicht bei der Gruppe sind. Abwesende Charaktere rasten nicht mit, und ihre Vorräte und magischen Gegenstände stehen bei dieser Rast nicht zur Verfügung;
- ob die Rast als neuer Tag zählt und die Spielzeit um die Rastdauer weiterläuft;
- ob temporäre Trefferpunkte entfernt werden und bei welchen Charakteren Änderungen am Trefferpunkte-Maximum zurückgesetzt werden;
- ob eine externe Nahrungs- oder Wasserquelle verfügbar ist, etwa ein Gasthaus oder ein Fluss. Wie viel diese Quelle liefert, wird in den Moduleinstellungen festgelegt;
- ob Alchemy Jugs an diesem Tag Nahrung, Wasser oder automatisch das voraussichtlich früher ausgehende Gut liefern (nur wenn ein Charakter oder ein Lager bei der Gruppe einen Alchemy Jug dabeihat).

Spieler können diese Vorgaben nicht ändern. Standardmäßig startet nur die Spielleitung Rasten; diese Beschränkung lässt sich abschalten. Trefferpunkte, Trefferwürfel, Zauberplätze und andere Erholungen berechnet weiterhin das dnd5e-Spielsystem. Bei einer kurzen Rast öffnet sich dessen Rastdialog.

**Bei einer ausgerufenen langen Rast mit Nahrungs- oder Wasserbedarf** teilen die beteiligten Spieler die Vorräte in einem gemeinsamen Fenster zu:

1. Standardmäßig teilen die Spieler selbst ein, wer welche Nahrung und welches Wasser bekommt. Sind sie damit überfordert, kann die Spielleitung mit *Verteilung vorschlagen* einen Vorschlag des Moduls einholen. In den Einstellungen lässt sich festlegen, dass das Modul schon zu Beginn eine Verteilung vorschlägt. Der Vorschlag berücksichtigt externe Quellen, die unterstützten magischen Quellen, mitgeführte Lager und die Vorräte der anwesenden Spielercharaktere, auch von Charakteren, die selbst nicht rasten.
2. Jeder Beteiligte kann Quellen hinzufügen und Quellen und Mengen ändern. Nach jeder Änderung müssen alle erneut zustimmen.
3. Sobald alle beteiligten Spieler zugestimmt haben, beginnt die Rast. Die Spielleitung kann sie auch ohne vollständige Zustimmung starten oder abbrechen. Sind keine Spieler beteiligt, startet sie die Rast selbst.
4. Die zugeteilten Vorräte werden verbraucht und die Charaktere führen ihre Rast durch. Wenn aktiviert, läuft die Spielzeit für die gesamte Gruppe um die Rastdauer weiter.

**Erschöpfung durch Hunger und Durst** wird bei langen Rasten berücksichtigt und lässt sich separat abschalten. Das Modul rechnet bereits an diesem Tag verzehrte Nahrung und getrunkenes Wasser an. Tagesbedarf, Rettungswurf-SG und die Grenze für Tage ohne Nahrung sind einstellbar. Mit den Standardeinstellungen gilt:

- **Weniger als die Hälfte des täglichen Wasserbedarfs:** Der Charakter erhält eine Stufe Erschöpfung, bei bereits bestehender Erschöpfung zwei Stufen.
- **Mindestens die Hälfte, aber weniger als der volle Wasserbedarf:** Ein Konstitutionsrettungswurf gegen Schwierigkeitsgrad (SG) 15 entscheidet, ob der Charakter diese Erschöpfung erhält.
- **Nahrung:** Wer etwas, aber höchstens eine halbe Ration isst, sammelt einen halben Tag ohne Nahrung an. Wer gar nichts isst, sammelt einen ganzen Tag an. Die Grenze beträgt drei Tage plus Konstitutionsmodifikator; dabei wird der Modifikator mit mindestens +1 angesetzt. Überschreitet die Summe diese Grenze, erhält der Charakter eine Stufe Erschöpfung. Mehr als eine halbe Ration setzt den Zähler für Tage ohne Nahrung zurück.
- **Erholung:** Bei zu wenig Wasser oder höchstens einer halben Ration wird Erschöpfung während dieser Rast nicht abgebaut.

Wasser wird in Pints gezählt. Standardmäßig deckt ein Wasserschlauch mit vier Pints den Tagesbedarf eines Charakters. Das Rast-System lässt sich in den Einstellungen im Reiter *Vorrat* ausschalten.

## 🪙 Münzen und Rechnungen

Das **Münz-Protokoll** erfasst manuelle Münzänderungen und Münzbewegungen durch Gegenstandshaufen, Handel und Rechnungen. Es speichert Zeitpunkt, verantwortlichen Benutzer, Betrag sowie Bestand vor und nach der Änderung, sofern beim jeweiligen Vorgang vorhanden.

Die automatische Überwachung manueller Änderungen bezieht sich auf Akteure aus der Akteur-Seitenleiste, die mindestens einem Spieler gehören. Eigene Daten nicht verknüpfter Tokens werden dabei nicht automatisch überwacht. Änderungen durch die Spielleitung lassen sich von dieser Überwachung ausnehmen.

- Viele Änderungen in kurzer Zeit können als auffällig markiert werden.
- Nach einer Münzänderung durch einen Spieler kann die Spielleitung eine Begründung ergänzen.
- Das Fenster des Münz-Protokolls zeigt gespeicherte Änderungen und Rechnungsvorgänge als Tabelle für einen einzelnen Tag oder alle Tage. Es bietet Filter, Suche und eine Detailansicht. Einträge lassen sich löschen; die angezeigte Liste kann als CSV heruntergeladen oder als JSON in die Zwischenablage kopiert werden.

Reicht in den **Münzfeldern im Charakterbogen** der Bestand einer Münzart nicht aus, kann das Modul andere Münzen verwenden und Wechselgeld berechnen. Dafür müssen das automatische Umwechseln aktiviert und insgesamt genügend Münzen vorhanden sein.

Beispiel: Ein Charakter besitzt zwei Goldmünzen und keine Silbermünzen. Die Eingabe `-5` im Silberfeld zieht fünf Silbermünzen ab. Übrig bleiben eine Goldmünze und fünf Silbermünzen. Die Spielleitung kann erlauben, dass Wechselgeld auch in Platin und Elektrum ausgegeben wird.

**Rechnungen** sendet die Spielleitung über die Token-Steuerung oder den Kopfbereich eines Akteurbogens an Akteure mit Spielerbesitz. Dabei sind bis zu fünf gleichzeitige Entwürfe pro Spielleitung möglich. Preise können etwa als `5 gp 2 sp` oder `3 Gold 4 Silber` eingegeben werden; Vorlagen lassen sich nach Kategorien verwalten. Zum Senden muss ein Spieler mit Besitzerrechten angemeldet sein und der Münzbestand zur Bezahlung ausreichen.

Der empfangende Spieler kann die Rechnung bezahlen oder ablehnen. Beim Bezahlen prüft das Modul den aktuellen Münzbestand erneut, berechnet das Wechselgeld und stellt eine private Quittung im Chat für die Besitzer des Akteurs und die Spielleitung aus.

## 🧾 Charakter-Tracker

Der Charakter-Tracker protokolliert Änderungen an den gespeicherten Daten von Spielercharakteren mit den Werten vor und nach der Änderung. Erfasst werden unter anderem Trefferpunkte, Zauberplätze, Ressourcen, Inventar, Gegenstandsnutzungen und Konzentration. Änderungen in kurzer Folge werden zusammengefasst. Standardmäßig werden alle Charaktere mit Spielerbesitz verfolgt, einschließlich nicht verknüpfter Tokens; wahlweise nur die den Spielern zugewiesenen Charaktere.

Änderungen durch die Spielleitung und vertrauliche Felder wie die Biografie werden standardmäßig ausgelassen. Beides lässt sich einstellen. Münzänderungen stehen im separaten Münz-Protokoll.

**Zauber:** Erkennt das Modul anhand einer dnd5e-Anwendungskarte den Verbrauch eines Zauberplatzes, ergänzt es den gewirkten Zauber im Protokoll. Unter „Zauberplätze Grad 3: 3 → 2“ steht beispielsweise „gewirkt: Feuerball (Grad 3)“. Erkennt es eine Anwendung, die einen Zauberplatz benötigt, ohne dass einer verbraucht wurde, erscheint eine Warnung. Manuell geänderte Zauberplätze lassen sich so keinem Zauber zuordnen. Beim Bewegen des Mauszeigers über einen Zauberlink erscheint eine Vorschau; ein Klick öffnet den Zauber.

**Snapshots** sind gespeicherte Momentaufnahmen eines Charakters. Die Spielleitung öffnet das Snapshot-Fenster über *Charakter-Snapshot* im Kopfbereich des Charakterbogens und erstellt dort eine Aufnahme. Mit *Alle Charaktere speichern* im Protokoll-Fenster werden Momentaufnahmen aller verfolgten Charaktere erstellt. Vorhandene Snapshots werden dabei ersetzt.

Das Snapshot-Fenster vergleicht den gespeicherten mit dem aktuellen Stand. Die Spielleitung kann einzelne Unterschiede oder alle angezeigten Unterschiede auf den gespeicherten Stand zurücksetzen. Dazu gehört auch das Wiederherstellen gelöschter bzw. Entfernen neu hinzugefügter Gegenstände. Der Münzbestand des Charakters und in den Einstellungen vom Vergleich ausgeschlossene Felder werden dabei nicht zurückgesetzt.

## 📜 Protokoll

Das Modul speichert seine Protokolle im Welt-Kompendium **Pack & Ledger Logs**, das nur die Spielleitung öffnen kann. Dazu gehören Aktivitäten wie Aufheben und Verstauen, zerrissene Behälter, Handel, Entdeckungen, geöffnete Truhen und Mahlzeiten. Auch Charakteränderungen sowie Warnungen und Fehler des Moduls werden dort festgehalten.

Neue Protokolleinträge werden von der angemeldeten Spielleitung gespeichert. Für Aktivitäten und Charakteränderungen muss *Protokoll schreiben* aktiviert sein; die Münzüberwachung hat einen eigenen Schalter.

- **Protokoll-Tab:** Ein eigener Reiter in der Seitenleiste zeigt der Spielleitung bis zu 300 Einträge aus den letzten 24 Stunden als Karten. Die Ansicht aktualisiert sich automatisch und lässt sich nach Aktivitäten, Münzen und Charakteren filtern. Zauberwarnungen sind ebenfalls sichtbar; technische Warnungen und Fehler stehen im Protokoll-Fenster. Ein Punkt weist auf neue Einträge hin.
- **Protokoll-Fenster:** Zeigt Aktivitäten, Charakteränderungen sowie technische Meldungen für einen einzelnen Tag oder alle Tage. Es bietet eine Suche sowie Filter nach Meldungsart, Benutzer und Charakter. Einzelne Einträge oder ganze Tage lassen sich löschen. Die geladenen Einträge können als Textdatei heruntergeladen werden; die aktuell gefilterten Einträge lassen sich als CSV exportieren. Münzbewegungen werden im eigenen Münz-Protokoll angezeigt.
- **Aufbewahrung:** Ältere Einträge können nach einer einstellbaren Anzahl von Tagen automatisch gelöscht werden.

## ⚙️ Einstellungen

Die Spielleitung verwaltet alle Moduleinstellungen in einem gemeinsamen Fenster mit thematischen Reitern. Spieler haben keine eigenen Moduleinstellungen. Benachrichtigungen lassen sich auf wichtige Meldungen beschränken.

## 🌍 Sprachen

Englisch und Deutsch.

## 📋 Requirements

- Foundry VTT **v14.370**
- **dnd5e 6.0.6**

## 🧩 Compatible modules

- **Blind Skill Rolls** (hidden NPC names stay hidden in trades)

## 📦 Installation

Manifest URL:

`https://github.com/Flashiiio/Pack-and-Ledger/releases/latest/download/module.json`


## 💁 Support

Issues and feedback:

`https://github.com/Flashiiio/Pack-and-Ledger/issues`

Discord:

`https://discord.gg/upVqdYqg4p`
