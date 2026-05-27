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
          How automatic scheduling works (Shift planning logic)
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
              <strong>Selected web and revision shifts first:</strong> For each week, the planner first tries to place the required Web and Web Revision shifts on the chosen days and in the selected time block. Only if no valid option remains does it fall back to the other time block.
            </li>
            <li>
              <strong>Then regular shifts based on weekly minimums and fairness:</strong> After that, the planner fills regular shifts to bring employees toward their weekly minimum first, then distributes the remaining hours as fairly as possible above that minimum.
            </li>
            <li>
              <strong>Fill remaining regular capacity:</strong> Open morning and afternoon slots are then assigned to the best-scoring candidate, balancing availability, contract hours, and scarcity.
            </li>
            <li>
              <strong>Special shifts are rebalanced at the end:</strong> If an earlier web or revision shift had to be sacrificed to restore regular coverage, the planner tries to restore it later without breaking daily staffing.
            </li>
            <li>
              <strong>Full days remain a preference:</strong> Full days add bonus points, but only as long as they do not conflict with coverage, minimum hours, or maximum hours.
            </li>
          </ol>

          <h4 className="font-semibold text-blue-900 mb-2">Planner Priorities</h4>
          <p className="text-sm text-blue-800 mb-2">
            The planner generates multiple schedule candidates and picks the best one using a scoring model. In broad terms, these goals carry the most weight:
          </p>
          <ul className="list-disc list-inside space-y-1 text-sm text-blue-800 bg-white/50 p-4 rounded-lg">
            <li><strong>Coverage first:</strong> Open regular shifts receive the heaviest penalty and therefore dominate the final schedule selection.</li>
            <li><strong>Weekly minimum first:</strong> Within each week, the planner first tries to fix shortfalls against minimum hours.</li>
            <li><strong>Fairness above minimum:</strong> Remaining hours then go mainly to employees who have received the fewest extra hours above their minimum.</li>
            <li><strong>Max hours are hard limits:</strong> An employee may never exceed the weekly maximum; if nobody still fits within max hours, the shift stays open.</li>
            <li><strong>Preferred hours are a soft limit:</strong> Preferred hours only act as a soft upper bound; the planner does not add extra hours just to reach the preferred target.</li>
            <li><strong>Full-day preference:</strong> Employees with a higher full-day priority are more likely to receive two shifts on the same day when the rest of the schedule allows it.</li>
          </ul>
        </div>
      )}
    </div>
  );
}
