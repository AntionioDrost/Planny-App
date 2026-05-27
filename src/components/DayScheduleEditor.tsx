import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Plus,
  PencilLine,
  RotateCcw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import type { ParsedData } from '../lib/parser';
import { getWeekId, getWeekOrder, type ScheduleResult, type ShiftType } from '../lib/scheduler';
import {
  addEditableShiftSlot,
  applyEmployeeSelection,
  buildEditableScheduleResult,
  buildEditableShiftSlots,
  buildEmployeeHoursSummaries,
  buildScheduleEditWarnings,
  buildWeeklyShiftShortfallNotices,
  getExtraEditableSlotIds,
  getEmployeeWeekWarningsForSlot,
  getQualifiedEmployeesForSlot,
  hasEditableChanges,
  removeEditableShiftSlot,
  type EditableShiftSlot,
  type EmployeeHoursSummary,
  type ScheduleEditWarning,
  type ShiftSlotKind,
} from '../lib/scheduleEditor';

interface Props {
  data: ParsedData;
  schedule: ScheduleResult;
  generatedSchedule: ScheduleResult;
  savedAt: string | null;
  onSaveSchedule: (schedule: ScheduleResult) => void;
  onResetSchedule: () => void;
}

interface UnfilledShiftEntry {
  day: string;
  weekId: string;
  label: 'Normal' | 'Web' | 'Web Revision';
  counts: {
    morning: number;
    afternoon: number;
  };
}

const OPEN_SHIFT_VALUE = '__open_shift__';

const SLOT_KIND_META: Record<
  ShiftSlotKind,
  { label: string; tone: string; rowTone: string }
> = {
  normal: {
    label: 'Regular',
    tone: 'bg-slate-100 text-slate-700 border border-slate-200',
    rowTone: 'border-slate-200 bg-white',
  },
  web: {
    label: 'WEB',
    tone: 'bg-blue-100 text-blue-800 border border-blue-200',
    rowTone: 'border-blue-200 bg-blue-50/60',
  },
  revision: {
    label: 'REV',
    tone: 'bg-purple-100 text-purple-800 border border-purple-200',
    rowTone: 'border-purple-200 bg-purple-50/60',
  },
};

const WARNING_META: Record<
  ScheduleEditWarning['code'],
  { label: string; tone: string }
> = {
  unavailable: {
    label: 'Not available',
    tone: 'bg-rose-100 text-rose-800 border border-rose-200',
  },
  'over-preferred': {
    label: 'Over preferred',
    tone: 'bg-amber-100 text-amber-800 border border-amber-200',
  },
  'over-max': {
    label: 'Over max',
    tone: 'bg-red-100 text-red-800 border border-red-200',
  },
};

const formatSavedAt = (value: string | null) => {
  if (!value) return 'Generated roster active';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved roster active';

  return new Intl.DateTimeFormat('nl-NL', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
};

const formatSignedHours = (value: number) => `${value > 0 ? '+' : ''}${value}h`;

const formatSignedShiftDelta = (value: number) => {
  const rounded = Number.isInteger(value) ? value.toString() : value.toFixed(1);
  return `${value > 0 ? '+' : ''}${rounded}`;
};

const getDeltaTone = (value: number, positiveTone: string, negativeTone: string) => {
  if (value > 0) return positiveTone;
  if (value < 0) return negativeTone;
  return 'bg-slate-100 text-slate-600';
};

const formatUnfilledCounts = (counts: UnfilledShiftEntry['counts']) => {
  if (counts.morning > 0 && counts.afternoon > 0) {
    return `${counts.morning} morning and ${counts.afternoon} afternoon shift(s)`;
  }
  if (counts.morning > 0) {
    return `${counts.morning} morning shift(s)`;
  }
  return `${counts.afternoon} afternoon shift(s)`;
};

const getUnfilledShiftEntries = (data: ParsedData, schedule: ScheduleResult): UnfilledShiftEntry[] =>
  data.days.flatMap(day => {
    if (data.closedDays.includes(day)) {
      return [];
    }

    const entries: UnfilledShiftEntry[] = [];
    const weekId = getWeekId(day);

    const addEntry = (
      label: UnfilledShiftEntry['label'],
      counts?: { morning: number; afternoon: number }
    ) => {
      if (!counts || (counts.morning === 0 && counts.afternoon === 0)) {
        return;
      }

      entries.push({ day, weekId, label, counts });
    };

    addEntry('Normal', schedule.unfilledNormalShifts?.[day]);
    addEntry('Web', schedule.unfilledWebShifts?.[day]);
    addEntry('Web Revision', schedule.unfilledWebRevisionShifts?.[day]);

    return entries;
  });

const buildDayModels = (data: ParsedData, slots: EditableShiftSlot[]) => {
  const weeks = getWeekOrder(data.days);

  return weeks.map(weekId => ({
    weekId,
    days: data.days
      .filter(day => getWeekId(day) === weekId)
      .map(day => ({
        day,
        isClosed: data.closedDays.includes(day),
        morningSlots: slots.filter(slot => slot.day === day && slot.type === 'Morning'),
        afternoonSlots: slots.filter(slot => slot.day === day && slot.type === 'Afternoon'),
      })),
  }));
};

const SlotWarnings = ({ warnings }: { warnings: ScheduleEditWarning[] }) =>
  warnings.length > 0 ? (
    <div className="mt-2 flex flex-wrap gap-2">
      {warnings.map(warning => (
        <span
          key={warning.id}
          title={warning.message}
          className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ${WARNING_META[warning.code].tone}`}
        >
          {WARNING_META[warning.code].label}
        </span>
      ))}
    </div>
  ) : null;

const TotalHoursTable = ({ summaries }: { summaries: EmployeeHoursSummary[] }) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[720px] text-sm">
      <thead className="border-b border-slate-200 text-xs uppercase tracking-[0.18em] text-slate-500">
        <tr>
          <th className="px-4 py-3 text-left font-medium">Employee</th>
          <th className="px-4 py-3 text-left font-medium">Assigned</th>
          <th className="px-4 py-3 text-left font-medium">Preferred delta</th>
          <th className="px-4 py-3 text-left font-medium">Preferred delta shifts</th>
          <th className="px-4 py-3 text-left font-medium">Max delta</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {summaries.map(summary => (
          <tr key={summary.employeeName}>
            <td className="px-4 py-3 font-medium text-slate-900">{summary.employeeName}</td>
            <td className="px-4 py-3 text-slate-700">
              {summary.assignedHours}h
              <span className="ml-2 text-xs text-slate-400">of {summary.preferredHours}h pref</span>
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getDeltaTone(
                  summary.preferredDeltaHours,
                  'bg-amber-100 text-amber-800',
                  'bg-sky-100 text-sky-800'
                )}`}
              >
                {formatSignedHours(summary.preferredDeltaHours)}
              </span>
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getDeltaTone(
                  summary.preferredDeltaShifts,
                  'bg-amber-100 text-amber-800',
                  'bg-sky-100 text-sky-800'
                )}`}
              >
                {formatSignedShiftDelta(summary.preferredDeltaShifts)} shifts
              </span>
            </td>
            <td className="px-4 py-3">
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getDeltaTone(
                  summary.maxDeltaHours,
                  'bg-red-100 text-red-800',
                  'bg-emerald-100 text-emerald-800'
                )}`}
              >
                {formatSignedHours(summary.maxDeltaHours)}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const WeeklyHoursGrid = ({ summaries }: { summaries: EmployeeHoursSummary[] }) => {
  const weekIds = summaries[0]?.weekly.map(week => week.weekId) ?? [];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {weekIds.map(weekId => (
        <section key={weekId} className="rounded-2xl border border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-4 py-3">
            <h5 className="text-sm font-semibold text-slate-900">
              {weekId === 'default' ? 'Default Week' : `Week ${weekId}`}
            </h5>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="border-b border-slate-100 text-xs uppercase tracking-[0.16em] text-slate-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Employee</th>
                  <th className="px-4 py-3 text-left font-medium">Assigned</th>
                  <th className="px-4 py-3 text-left font-medium">Preferred</th>
                  <th className="px-4 py-3 text-left font-medium">Max</th>
                  <th className="px-4 py-3 text-left font-medium">8h / 4h delta</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summaries.map(summary => {
                  const week = summary.weekly.find(entry => entry.weekId === weekId);
                  if (!week) return null;

                  return (
                    <tr key={`${summary.employeeName}-${weekId}`}>
                      <td className="px-4 py-3 font-medium text-slate-900">{summary.employeeName}</td>
                      <td className="px-4 py-3 text-slate-700">{week.assignedHours}h</td>
                      <td className="px-4 py-3 text-slate-700">{week.preferredHours}h</td>
                      <td className="px-4 py-3 text-slate-700">{week.maxHours}h</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${getDeltaTone(
                            week.baselineDeltaHours,
                            'bg-amber-100 text-amber-800',
                            'bg-sky-100 text-sky-800'
                          )}`}
                        >
                          {formatSignedHours(week.baselineDeltaHours)} vs {week.baselineHours}h
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
};

export function DayScheduleEditor({
  data,
  schedule,
  generatedSchedule,
  savedAt,
  onSaveSchedule,
  onResetSchedule,
}: Props) {
  const [isEditing, setIsEditing] = useState(false);
  const [showHoursOverview, setShowHoursOverview] = useState(false);
  const [openAddMenuKey, setOpenAddMenuKey] = useState<string | null>(null);
  const [draftSlots, setDraftSlots] = useState<EditableShiftSlot[]>(
    () => buildEditableShiftSlots(data, schedule)
  );

  const baseSlots = buildEditableShiftSlots(data, schedule);
  const generatedSlots = buildEditableShiftSlots(data, generatedSchedule);

  useEffect(() => {
    if (!isEditing) {
      setDraftSlots(buildEditableShiftSlots(data, schedule));
    }
  }, [data, schedule, isEditing]);

  const displayedSlots = isEditing ? draftSlots : baseSlots;
  const displayedSchedule = isEditing
    ? buildEditableScheduleResult(data, draftSlots, schedule.plannerMode)
    : schedule;
  const warnings = isEditing
    ? buildScheduleEditWarnings(data, draftSlots, displayedSchedule)
    : [];
  const warningCounts = warnings.reduce(
    (counts, warning) => ({
      ...counts,
      [warning.code]: counts[warning.code] + 1,
    }),
    { unavailable: 0, 'over-preferred': 0, 'over-max': 0 }
  );
  const hoursSummaries = isEditing
    ? buildEmployeeHoursSummaries(data, displayedSchedule)
    : [];
  const weeklyShiftShortfallNotices = buildWeeklyShiftShortfallNotices(
    data,
    displayedSchedule
  );
  const unfilledShiftEntries = getUnfilledShiftEntries(data, displayedSchedule);
  const dayGroups = buildDayModels(data, displayedSlots);
  const hasUnsavedChanges = isEditing && hasEditableChanges(baseSlots, draftSlots);
  const canResetSavedRoster = hasEditableChanges(generatedSlots, baseSlots);
  const canResetDraft = hasEditableChanges(generatedSlots, draftSlots);
  const removableExtraWebSlotIds = isEditing
    ? getExtraEditableSlotIds(draftSlots, generatedSlots, 'web')
    : new Set<string>();
  const removableExtraRevisionSlotIds = isEditing
    ? getExtraEditableSlotIds(draftSlots, generatedSlots, 'revision')
    : new Set<string>();

  const startEditing = () => {
    setDraftSlots(baseSlots);
    setShowHoursOverview(false);
    setOpenAddMenuKey(null);
    setIsEditing(true);
  };

  const cancelEditing = () => {
    setDraftSlots(baseSlots);
    setOpenAddMenuKey(null);
    setIsEditing(false);
  };

  const saveEditing = () => {
    onSaveSchedule(displayedSchedule);
    setOpenAddMenuKey(null);
    setIsEditing(false);
  };

  const resetToGenerated = () => {
    if (isEditing) {
      setDraftSlots(generatedSlots);
      setOpenAddMenuKey(null);
      return;
    }

    onResetSchedule();
  };

  const handleEmployeeChange = (slotId: string, value: string) => {
    setDraftSlots(previousSlots =>
      applyEmployeeSelection(
        previousSlots,
        slotId,
        value === OPEN_SHIFT_VALUE ? null : value
      )
    );
  };

  const handleAddSpecialShift = (
    day: string,
    type: ShiftType,
    kind: Extract<ShiftSlotKind, 'web' | 'revision'>
  ) => {
    setDraftSlots(previousSlots =>
      addEditableShiftSlot(previousSlots, { day, type, kind })
    );
    setOpenAddMenuKey(null);
  };

  const handleRemoveSpecialShift = (slotId: string) => {
    setDraftSlots(previousSlots => removeEditableShiftSlot(previousSlots, slotId));
  };

  const getSlotWarnings = (slot: EditableShiftSlot) => {
    const slotScopedWarnings = warnings.filter(
      warning => warning.scope === 'slot' && warning.slotId === slot.id
    );
    const employeeWeekWarnings = getEmployeeWeekWarningsForSlot(warnings, slot);

    return [...slotScopedWarnings, ...employeeWeekWarnings];
  };

  return (
    <div className="space-y-6">
      <div className="rounded-[28px] border border-slate-200 bg-[linear-gradient(135deg,#ffffff_0%,#f8fafc_55%,#eef2ff_100%)] p-5 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-indigo-600">
              By Day Editor
            </p>
            <h3 className="mt-1 text-xl font-semibold text-slate-900">
              Smart shift switch
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              {savedAt ? `Saved ${formatSavedAt(savedAt)}` : 'No saved override yet'}
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${
                isEditing
                  ? hasUnsavedChanges
                    ? 'bg-amber-100 text-amber-800'
                    : 'bg-slate-100 text-slate-700'
                  : canResetSavedRoster
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-slate-100 text-slate-700'
              }`}
            >
              {isEditing
                ? hasUnsavedChanges
                  ? 'Unsaved changes'
                  : 'No draft changes'
                : canResetSavedRoster
                  ? 'Saved override active'
                  : 'Generated roster active'}
            </span>
            {!isEditing ? (
              <>
                <button
                  onClick={startEditing}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-800 cursor-pointer"
                >
                  <PencilLine className="h-4 w-4" />
                  Edit
                </button>
                <button
                  onClick={resetToGenerated}
                  disabled={!canResetSavedRoster}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                    canResetSavedRoster
                      ? 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 cursor-pointer'
                      : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed'
                  }`}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset to Generated
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={saveEditing}
                  disabled={!hasUnsavedChanges}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                    hasUnsavedChanges
                      ? 'bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer'
                      : 'bg-emerald-200 text-white cursor-not-allowed'
                  }`}
                >
                  <Save className="h-4 w-4" />
                  Save
                </button>
                <button
                  onClick={cancelEditing}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                  Cancel
                </button>
                <button
                  onClick={resetToGenerated}
                  disabled={!canResetDraft}
                  className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-colors ${
                    canResetDraft
                      ? 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer'
                      : 'border border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed'
                  }`}
                >
                  <RotateCcw className="h-4 w-4" />
                  Reset to Generated
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {isEditing && warnings.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <h4 className="font-medium text-amber-900">Warnings in this draft</h4>
              <div className="mt-2 flex flex-wrap gap-2">
                {warningCounts.unavailable > 0 && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-rose-700 border border-rose-200">
                    {warningCounts.unavailable} unavailable assignment(s)
                  </span>
                )}
                {warningCounts['over-preferred'] > 0 && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-700 border border-amber-200">
                    {warningCounts['over-preferred']} above preferred
                  </span>
                )}
                {warningCounts['over-max'] > 0 && (
                  <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-red-700 border border-red-200">
                    {warningCounts['over-max']} above max
                  </span>
                )}
              </div>
              <ul className="mt-3 space-y-1 text-sm text-amber-900">
                {warnings.slice(0, 8).map(warning => (
                  <li key={warning.id}>{warning.message}</li>
                ))}
                {warnings.length > 8 && (
                  <li className="text-amber-700">
                    + {warnings.length - 8} more warning(s)
                  </li>
                )}
              </ul>
            </div>
          </div>
        </div>
      )}

      {isEditing && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 shadow-sm">
          <button
            onClick={() => setShowHoursOverview(current => !current)}
            className="flex w-full items-center justify-between px-5 py-4 text-left cursor-pointer"
          >
            <div>
              <h4 className="text-base font-semibold text-slate-900">Hours Overview</h4>
              <p className="text-sm text-slate-500">
                Total preferred/max deltas and weekly 8h/4h comparison.
              </p>
            </div>
            {showHoursOverview ? (
              <ChevronUp className="h-5 w-5 text-slate-500" />
            ) : (
              <ChevronDown className="h-5 w-5 text-slate-500" />
            )}
          </button>
          {showHoursOverview && (
            <div className="space-y-5 border-t border-slate-200 px-5 py-5">
              <section className="space-y-3">
                <div>
                  <h5 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Total
                  </h5>
                </div>
                <TotalHoursTable summaries={hoursSummaries} />
              </section>
              <section className="space-y-3">
                <div>
                  <h5 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">
                    Per Week
                  </h5>
                </div>
                <WeeklyHoursGrid summaries={hoursSummaries} />
              </section>
            </div>
          )}
        </div>
      )}

      {dayGroups.map(({ weekId, days }) => {
        const weekEntries = unfilledShiftEntries.filter(entry => entry.weekId === weekId);
        const weekShortfallNotices = weeklyShiftShortfallNotices.filter(
          notice => notice.weekId === weekId
        );

        return (
          <section key={weekId} className="space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">
                {weekId === 'default' ? 'Schedule' : `Week ${weekId}`}
              </h3>
              <span className="text-xs text-slate-400">
                {days.length} {days.length === 1 ? 'day' : 'days'}
              </span>
            </div>
            {weekShortfallNotices.length > 0 && (
              <div className="overflow-hidden rounded-xl border border-sky-200 bg-[linear-gradient(135deg,rgba(240,249,255,0.98)_0%,rgba(224,242,254,0.96)_100%)] p-4 shadow-[0_10px_30px_-24px_rgba(14,116,144,0.9)]">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-sky-600" />
                  <div>
                    <h4 className="font-medium text-sky-800">Shifts missing</h4>
                    <ul className="mt-2 list-disc list-inside text-sm text-sky-700">
                      {weekShortfallNotices.map(notice => (
                        <li key={`${weekId}-${notice.employeeName}`}>
                          {notice.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            {weekEntries.length > 0 && !isEditing && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                  <div>
                    <h4 className="font-medium text-amber-800">Unfilled shifts in this week</h4>
                    <ul className="mt-2 list-disc list-inside text-sm text-amber-700">
                      {weekEntries.map(({ day, label, counts }) => (
                        <li key={`${weekId}-${label}-${day}`}>
                          {day} ({label}): missing {formatUnfilledCounts(counts)}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
              {days.map(dayModel => (
                <div
                  key={dayModel.day}
                  className={`overflow-hidden rounded-2xl border border-slate-200 ${
                    dayModel.isClosed ? 'bg-slate-50 opacity-60' : 'bg-white shadow-sm'
                  }`}
                >
                  <div
                    className={`border-b border-slate-200 px-4 py-3 ${
                      dayModel.isClosed ? 'bg-slate-100' : 'bg-slate-50'
                    }`}
                  >
                    <h4
                      className="flex items-center justify-between gap-3 truncate font-medium text-slate-900"
                      title={dayModel.day}
                    >
                      <span>{dayModel.day}</span>
                      {dayModel.isClosed && (
                        <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">
                          Office Closed
                        </span>
                      )}
                    </h4>
                  </div>
                  <div className="space-y-4 p-4">
                    {dayModel.isClosed ? (
                      <div className="py-8 text-center text-sm italic text-slate-500">
                        No shifts scheduled for this day.
                      </div>
                    ) : (
                      <>
                        {([
                          {
                            type: 'Morning' as ShiftType,
                            title: 'Morning (09:00 - 13:00)',
                            slots: dayModel.morningSlots,
                          },
                          {
                            type: 'Afternoon' as ShiftType,
                            title: 'Afternoon (13:00 - 17:00)',
                            slots: dayModel.afternoonSlots,
                          },
                        ]).map(section => (
                          <div
                            key={`${dayModel.day}-${section.type}`}
                            className={section.type === 'Afternoon' ? 'border-t border-slate-100 pt-4' : ''}
                          >
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <h5 className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                {section.title}
                              </h5>
                              {isEditing && (
                                <div className="relative">
                                  <button
                                    onClick={() =>
                                      setOpenAddMenuKey(current =>
                                        current === `${dayModel.day}::${section.type}`
                                          ? null
                                          : `${dayModel.day}::${section.type}`
                                      )
                                    }
                                    className="inline-flex items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 cursor-pointer"
                                  >
                                    <Plus className="h-3.5 w-3.5" />
                                    +web
                                  </button>
                                  {openAddMenuKey === `${dayModel.day}::${section.type}` && (
                                    <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-44 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
                                      <button
                                        onClick={() =>
                                          handleAddSpecialShift(dayModel.day, section.type, 'web')
                                        }
                                        className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 cursor-pointer"
                                      >
                                        <span>WEB</span>
                                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] text-blue-800">
                                          4h
                                        </span>
                                      </button>
                                      <button
                                        onClick={() =>
                                          handleAddSpecialShift(dayModel.day, section.type, 'revision')
                                        }
                                        className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 cursor-pointer"
                                      >
                                        <span>WEB Revision</span>
                                        <span className="rounded-full bg-purple-100 px-2 py-0.5 text-[10px] text-purple-800">
                                          4h
                                        </span>
                                      </button>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                            {section.slots.length === 0 ? (
                              <p className="text-sm italic text-slate-400">No shifts assigned</p>
                            ) : (
                              <ul className="space-y-2">
                                {section.slots.map(slot => {
                                  const slotWarnings = getSlotWarnings(slot);
                                  const qualifiedEmployees = getQualifiedEmployeesForSlot(data, slot);
                                  const meta = SLOT_KIND_META[slot.kind];
                                  const isExtraWebShift = removableExtraWebSlotIds.has(slot.id);
                                  const isExtraRevisionShift = removableExtraRevisionSlotIds.has(slot.id);
                                  const canRemoveSpecialShift =
                                    slot.kind === 'web' || slot.kind === 'revision';

                                  return (
                                    <li
                                      key={slot.id}
                                      className={`rounded-xl border p-3 ${isEditing ? meta.rowTone : 'border-slate-200 bg-white'}`}
                                    >
                                      <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                          Slot
                                        </span>
                                        <div className="flex items-center gap-2">
                                          {(isExtraWebShift || isExtraRevisionShift) && (
                                            <span className="inline-flex rounded-full bg-blue-900 px-2 py-1 text-[10px] font-medium text-white">
                                              EXTRA
                                            </span>
                                          )}
                                          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-medium ${meta.tone}`}>
                                            {meta.label}
                                          </span>
                                        </div>
                                      </div>
                                      {isEditing ? (
                                        <>
                                          <div className="mt-3 flex items-start gap-2">
                                            <select
                                              value={slot.employeeName ?? OPEN_SHIFT_VALUE}
                                              onChange={event =>
                                                handleEmployeeChange(slot.id, event.target.value)
                                              }
                                              className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none transition-colors focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500"
                                            >
                                              <option value={OPEN_SHIFT_VALUE}>Open shift</option>
                                              {qualifiedEmployees.available.map(employee => (
                                                <option key={`${slot.id}-${employee.name}`} value={employee.name}>
                                                  {employee.name}
                                                </option>
                                              ))}
                                              {qualifiedEmployees.unavailable.length > 0 && (
                                                <option disabled value={`${slot.id}-separator`}>
                                                  ---------------- unavailable ----------------
                                                </option>
                                              )}
                                              {qualifiedEmployees.unavailable.map(employee => (
                                                <option
                                                  key={`${slot.id}-${employee.name}-unavailable`}
                                                  value={employee.name}
                                                >
                                                  {employee.name} (not available)
                                                </option>
                                              ))}
                                            </select>
                                            {canRemoveSpecialShift && (
                                              <button
                                                onClick={() => handleRemoveSpecialShift(slot.id)}
                                                title={
                                                  slot.kind === 'web'
                                                    ? 'Remove web shift'
                                                    : 'Remove revision shift'
                                                }
                                                className="inline-flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-rose-200 bg-white text-rose-600 transition-colors hover:bg-rose-50 cursor-pointer"
                                              >
                                                <Trash2 className="h-4 w-4" />
                                              </button>
                                            )}
                                          </div>
                                          <SlotWarnings warnings={slotWarnings} />
                                        </>
                                      ) : (
                                        <div className="mt-3 flex items-center justify-between gap-3">
                                          {slot.employeeName ? (
                                            <span className="text-sm font-medium text-slate-700">
                                              {slot.employeeName}
                                            </span>
                                          ) : (
                                            <span className="text-sm font-medium italic text-red-600">
                                              Open shift
                                            </span>
                                          )}
                                        </div>
                                      )}
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
