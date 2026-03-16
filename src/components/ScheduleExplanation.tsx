import React, { useState } from 'react';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';

export function ScheduleExplanation() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="mt-8 bg-blue-50 border border-blue-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-6 bg-blue-50 hover:bg-blue-100/50 transition-colors cursor-pointer"
      >
        <h3 className="text-lg font-semibold text-blue-900 flex items-center">
          <Info className="w-5 h-5 mr-2" />
          Hoe werkt de automatische planning? (Shiftplan Logic)
        </h3>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-blue-700" />
        ) : (
          <ChevronDown className="w-5 h-5 text-blue-700" />
        )}
      </button>

      {isOpen && (
        <div className="p-6 pt-0 border-t border-blue-100">
          <ol className="list-decimal list-inside space-y-3 text-sm text-blue-800 mb-6">
            <li>
              <strong>Geselecteerde web- en revision-shifts eerst:</strong> Voor elke week probeert de planner eerst de verplichte Web en Web Revision diensten op de gekozen dagen en tijdvakken te plaatsen.
            </li>
            <li>
              <strong>Daarna normale shifts op weekminimum en fairness:</strong> Vervolgens vult de planner normale diensten om medewerkers eerst richting hun weekminimum te brengen en daarna resterende uren zo eerlijk mogelijk boven minimum te verdelen.
            </li>
            <li>
              <strong>Resterende normale capaciteit vullen:</strong> Open ochtend- en middagplekken worden daarna gevuld met de best scorende kandidaat, waarbij beschikbaarheid, contracturen en schaarste samen meewegen.
            </li>
            <li>
              <strong>Speciale diensten worden aan het einde opnieuw gebalanceerd:</strong> Als een eerdere web/revision-shift is opgeofferd om de normale bezetting rond te krijgen, probeert de planner die later opnieuw te herstellen zonder de dagbezetting stuk te maken.
            </li>
            <li>
              <strong>Full days blijven een voorkeur:</strong> Hele dagen geven bonuspunten, maar alleen zolang dat niet botst met dekking, minimumuren en maximale uren.
            </li>
          </ol>

          <h4 className="font-semibold text-blue-900 mb-2">Planner Prioriteiten</h4>
          <p className="text-sm text-blue-800 mb-2">
            De planner genereert meerdere roosterkandidaten en kiest de beste op basis van een scoremodel. In grote lijnen wegen deze doelen het zwaarst:
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-blue-800 bg-white/50 p-4 rounded-lg">
            <li><strong>Dekking eerst:</strong> Open normale diensten krijgen de zwaarste straf en domineren dus de keuze van het eindrooster.</li>
            <li><strong>Weekminimum eerst:</strong> Binnen een week probeert de planner eerst tekorten op minimumuren op te lossen.</li>
            <li><strong>Fairness boven minimum:</strong> Resterende uren gaan daarna vooral naar medewerkers die nog het minst extra uren boven hun minimum hebben gekregen.</li>
            <li><strong>Max uren respecteren:</strong> Overschrijdingen van het weekmaximum krijgen een zware straf en worden alleen gebruikt als laatste redmiddel.</li>
            <li><strong>Preferred als zachte grens:</strong> Preferred hours werken vooral als zachte bovengrens, niet meer als actief doel om naartoe te plannen.</li>
            <li><strong>Full day voorkeur:</strong> Medewerkers met hogere full day priority krijgen vaker twee diensten op dezelfde dag als de rest van het rooster dat toelaat.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
