# Pseudocode van `scheduler.ts`

Dit document legt in gewone taal uit hoe de scheduler werkt.
Het is bedoeld voor lezers die de code niet dagelijks lezen, maar wel
willen begrijpen welke stappen het algoritme zet en waarom.

## 1. Wat komt erin en wat komt eruit?

### Input

De scheduler krijgt:

- een lijst dagen
- een lijst gesloten dagen
- een lijst medewerkers
- per medewerker:
  - beschikbaarheid
  - preferred hours
  - max hours
  - web / revision bevoegdheden
  - full day priority
- per week:
  - hoeveel web shifts nodig zijn
  - hoeveel revision shifts nodig zijn
  - op welke dagen en tijdvakken die mogen

### Output

De scheduler levert:

- per medewerker: welke shifts zijn toegewezen
- per dagdeel: hoeveel normale shifts niet gevuld zijn
- per dagdeel: hoeveel web shifts niet gevuld zijn
- per dagdeel: hoeveel revision shifts niet gevuld zijn
- statistieken per medewerker

## 2. Hoofdidee

De planner maakt niet 1 rooster, maar veel roosters.
Daarna kiest hij het beste rooster op basis van een score.

Belangrijke ontwerpkeuzes in de huidige versie:

- minimumuren sturen de verdeling actief
- preferred hours zijn alleen een zachte grens
- extra uren boven minimum worden zo eerlijk mogelijk verdeeld
- normale shifts zijn belangrijker dan web en revision

## 3. Hoofdflow in pseudocode

```text
FUNCTION generateSchedule(data, iterations = 520):
    bestSchedule = null
    bestScore = -infinity

    REPEAT iterations keer:
        candidate = generateSingleSchedule(data)
        score = scoreSchedule(candidate, data)

        IF score beter is dan bestScore:
            bestSchedule = candidate
            bestScore = score

    RETURN bestSchedule
```

Kort gezegd:

- bouw meerdere roosters
- geef elk rooster een rapportcijfer
- houd de beste over

## 4. Voorwerk: doelen per medewerker per week

Voordat er shifts worden ingepland, berekent de code per medewerker en
per week een paar doelen.

```text
FUNCTION buildPlanningTargets(data):
    bepaal de weekvolgorde uit de daglabels

    FOR elke medewerker:
        FOR elke week:
            preferred = minimum van:
                - preferred hours
                - beschikbaarheid in die week
                - max hours in die week

            minimum = minimum van:
                - 8 uur
                - preferred
                - beschikbaarheid
                - max hours

            max = max hours van die week
            availableHours = totaal beschikbare uren in die week

            sla preferred, minimum, max, availableHours op
            tel preferred en minimum cumulatief op over de weken

    RETURN alle weekdoelen
```

Belangrijk:

- Als iemand `preferred = 4` heeft, dan wordt het minimum ook `4`.
- Preferred is dus niet altijd hoger dan minimum.
- Minimum is de actieve ondergrens waar de planner naartoe werkt.

## 5. Hoe een enkel rooster wordt opgebouwd

De scheduler bouwt een rooster in vaste fases.

```text
FUNCTION generateSingleSchedule(data):
    maak leeg rooster
    maak lege statistieken
    maak tellers voor ongevulde normale, web en revision shifts
    bereken planningTargets

    FASE 1: plan verplichte revision shifts
    FASE 2: plan verplichte web shifts
    FASE 3: plan normale shifts richting minimum
    FASE 4: verdeel extra normale shifts eerlijk boven minimum
    FASE 5: vul resterende normale gaten koste wat kost
    FASE 6: probeer web/revision achteraf nog te herstellen
    FASE 7: ruim conflicten op bij meerdere special shifts op 1 dag

    RETURN rooster + statistieken
```

## 6. Fase 1 en 2: verplichte web- en revision-shifts

De planner probeert eerst de verplichte special shifts in te vullen.

```text
FOR elke week:
    plan eerst revision shifts
    plan daarna web shifts

    PER special shift:
        kijk alleen naar medewerkers die dit mogen doen
        kijk alleen naar toegestane dagen en tijdvakken
        sla mensen over die:
            - niet beschikbaar zijn
            - al op dat dagdeel werken
            - al een special shift op die dag hebben
            - boven hun weekmaximum zouden komen

        geef elke kandidaat een score
        kies de kandidaat met de hoogste score
        wijs de shift toe
```

Waarom deze fase eerst?

- sommige web/revision shifts zijn harde weekeisen
- die moeten vroeg in het proces een plek krijgen

## 7. Fase 3: normale shifts richting minimum

Daarna probeert de planner eerst iedereen richting zijn minimum te
brengen.

```text
FOR elke week:
    WHILE er nog verbetering mogelijk is:
        zoek de beste normale kandidaat voor een open plek

        kandidaat moet:
            - geen web-only medewerker zijn
            - beschikbaar zijn
            - nog niet op dat dagdeel werken
            - nog binnen weekmaximum passen
            - nog minimumschuld hebben

        score kandidaat
        kies hoogste score
        wijs shift toe
```

De minimumschuld bestaat uit:

- tekort in de huidige week
- tekort cumulatief over alle weken tot nu toe

Dus:

- de planner kijkt niet alleen naar deze week
- hij probeert ook oude tekorten later goed te maken

## 8. Fase 4: eerlijke verdeling boven minimum

Als de minimumlaag gedaan is, verdeelt de planner extra uren.

```text
FOR elke week:
    WHILE er nog open normale plekken zijn:
        kijk naar alle geldige kandidaten
        bereken per kandidaat hoeveel extra uren deze al boven minimum heeft
        kies de kandidaat met de beste fairness-score
        wijs shift toe
```

In gewone taal:

- wie al veel extra uren boven minimum heeft, krijgt minder snel nog een shift
- wie nog weinig extra uren boven minimum heeft, krijgt eerder de volgende shift

Dit is de kern van de huidige fairness-logica.

## 9. Fase 5: resterende normale gaten altijd proberen te vullen

Daarna komt de hardste prioriteit: normale shifts moeten gevuld zijn.

```text
FOR elke week:
    zet alle open normale dagdelen op volgorde van meest schaars naar minst schaars

    FOR elk open dagdeel:
        WHILE normale capaciteit nog niet vol is:
            zoek alle beschikbare medewerkers

            IF er geen kandidaten binnen max zijn:
                stop met nieuwe assignments voor dit dagdeel
            ELSE:
                kies alleen uit kandidaten binnen max

            score kandidaten in force-fill mode
            wijs beste kandidaat toe

        IF er nog steeds gaten zijn:
            probeer een eerder geplande web/revision shift om te zetten
            naar een normale shift

        IF er dan nog gaten zijn:
            registreer die als ongevulde normale shift
```

Dit betekent:

- preferred is geen harde stop
- max is een harde grens
- normale bezetting blijft de zwaarste prioriteit, maar niet ten koste van max

## 10. Fase 6: special shifts later herstellen

Tijdens het vullen van normale shifts kan een web/revision shift opgeofferd
zijn. Deze fase probeert dat later weer netjes terug te zetten.

```text
FOR elke week:
    bereken hoeveel web en revision shifts nog ontbreken

    FOR elk ontbrekend special type:
        probeer eerst een vrije geschikte medewerker te vinden

        ALS dat niet lukt:
            zoek een normale medewerker op dat dagdeel
            verander diens shift naar web/revision
            zoek daarna een vervanger voor de normale shift

        ALS ook dat niet lukt:
            registreer de special shift als ongevuld
```

Dus:

- normale dekking blijft leidend
- special shifts worden daarna zo goed mogelijk hersteld

## 11. Laatste cleanup

Helemaal op het einde controleert de code of iemand meerdere special
shifts op dezelfde dag heeft.

```text
FOR elke medewerker:
    groepeer shifts per dag
    ALS er meer dan 1 special shift op een dag staat:
        houd alleen de belangrijkste over
        zet de rest terug naar normale shifts
```

In de huidige code krijgt revision daarbij voorrang boven web.

## 12. Hoe een kandidaat gescoord wordt

De scheduler kiest niet willekeurig.
Voor iedere mogelijke kandidaat wordt een score berekend.

### Normale shifts

De score voor een normale shift kijkt onder andere naar:

- hoe ver iemand onder minimum zit
- hoe groot de cumulatieve minimumachterstand is
- hoeveel extra uren iemand al boven minimum heeft
- hoe schaars de bezetting op dat dagdeel is
- of een full day netjes wordt afgemaakt
- of iemand liever niet van web/revision weggehaald moet worden
- of preferred of max overschreden wordt

Pseudocode:

```text
scoreNormalCandidate =
    bonus voor weekminimum-tekort
    + bonus voor cumulatief minimum-tekort
    + bonus als dit een schaarse shift is
    + bonus voor logische full day
    - straf als iemand al veel extra uren boven minimum heeft
    - straf als iemand al boven preferred zit
    - straf als iemand over max zou gaan
    - kleine straf als vorige week al ruim boven preferred zat
    + kleine random noise
```

### Web en revision

Voor special shifts geldt grotendeels dezelfde logica, plus:

- bonus voor web-only medewerkers
- bonus voor revision-specialisten
- straf als je een gewone medewerker weghaalt bij een schaars normaal dagdeel

## 13. Hoe het eindrooster een totaalscore krijgt

Nadat een heel rooster gebouwd is, krijgt het een eindsom.

```text
FUNCTION scoreSchedule(result, data):
    score = 0

    trek heel veel punten af voor ongevulde normale shifts
    trek punten af voor ongevulde web/revision shifts

    FOR elke week en elke medewerker:
        straf onder minimum
        straf onder cumulatief minimum
        straf boven max
        straf licht voor boven preferred

    FOR elke week:
        bereken per medewerker hoeveel extra uren boven minimum hij kreeg
        straf grote verschillen in die extra verdeling

    geef bonus voor logische full days
    geef kleine bonus aan web-only medewerkers als zij echt special werk doen

    RETURN score
```

De belangrijkste scorelogica is dus:

1. Ongevulde normale shifts zijn heel slecht.
2. Onder minimum is ook zwaar negatief.
3. Boven max mag niet gebeuren.
4. Preferred is een zachte grens, geen harde regel.
5. Fairness wordt gemeten als spreiding van extra uren boven minimum.

## 14. Zakelijke samenvatting voor leidinggevenden

Als je deze scheduler in 5 zinnen moet uitleggen:

1. De planner maakt veel mogelijke roosters en kiest de beste.
2. Eerst worden verplichte web/revision-shifts geplaatst.
3. Daarna worden normale shifts eerst gebruikt om medewerkers richting hun minimumuren te brengen.
4. Extra uren boven minimum worden daarna zo eerlijk mogelijk verdeeld.
5. Preferred hours tellen mee als zachte grens, maar weekmaximum blijft een harde grens.

## 15. Belangrijkste regels in 1 overzicht

```text
HARDE PRIORITEITEN
- normale shifts vullen
- beschikbaarheid respecteren
- web-only alleen op special werk
- weekmaximum nooit overschrijden

STURENDE FAIRNESS-REGELS
- minimum eerst
- cumulatieve minimumtekorten later inhalen
- extra uren boven minimum eerlijk spreiden

ZACHTE REGELS
- preferred hours liever niet overschrijden
- full days zijn fijn als dat logisch uitkomt
- web/revision later herstellen als normale dekking dat toelaat
```

## 16. Een korte metafoor

Je kunt het algoritme zien als een planner in drie lagen:

- Laag 1: "Zorg dat de winkel open kan."
- Laag 2: "Zorg dat mensen hun minimum krijgen."
- Laag 3: "Verdeel de extra uren daarna zo eerlijk mogelijk."

Dat is precies wat de huidige `scheduler.ts` probeert te doen.
