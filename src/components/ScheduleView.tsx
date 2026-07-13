import React, { useState } from 'react';
import { ParsedData } from '../lib/parser';
import {
  AssignedShift,
  getMaxHours,
  getMinimumHoursTarget,
  getPreferredHours,
  getWeekId,
  getWeekOrder,
  ScheduleResult,
} from '../lib/scheduler';
import { ChevronDown, ChevronUp, Download, AlertCircle, Scale } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ScheduleExplanation } from './ScheduleExplanation';
import { buildCalendarZip } from '../lib/calendarExport';
import { DayScheduleEditor } from './DayScheduleEditor';

interface Props {
  schedule: ScheduleResult;
  generatedSchedule: ScheduleResult;
  data: ParsedData;
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

export function ScheduleView({
  schedule,
  generatedSchedule,
  data,
  savedAt,
  onSaveSchedule,
  onResetSchedule,
}: Props) {
  const [viewMode, setViewMode] = useState<'employee' | 'day' | 'week'>('employee');
  const [calendarExportError, setCalendarExportError] = useState<string | null>(null);
  const [isExportingCalendars, setIsExportingCalendars] = useState(false);
  const [isFairnessOpen, setIsFairnessOpen] = useState(false);

  const weeks = getWeekOrder(data.days);
  const canExportCalendars = typeof data.rosterYear === 'number';
  const fairnessReport = schedule.fairnessReport;
  const plannerModeLabel =
    schedule.plannerMode === 'legacy' ? 'Legacy (2026-03-16)' : 'Fairness';

  const sortShiftsByTime = (shifts: AssignedShift[]) =>
    [...shifts].sort((left, right) =>
      left.type === right.type ? 0 : left.type === 'Morning' ? -1 : 1
    );

  const formatShiftLabel = (shift: AssignedShift) => {
    if (shift.isBuddy) return `${shift.type === 'Morning' ? '09:00 - 13:00' : '13:00 - 17:00'} (BUDDY)`;
    const time = shift.type === 'Morning' ? '9:00-13:00' : '13:00-17:00';
    const suffix = shift.isWeb ? ' (Web)' : shift.isWebRevision ? ' (Web Rev)' : '';
    return `${time}${suffix}`;
  };

  const getEmployeeMinimumTotal = (employee: ParsedData['employees'][number]) =>
    weeks.reduce(
      (total, weekId) => total + getMinimumHoursTarget(employee, weekId, data.days, data.closedDays),
      0
    );

  const formatFairnessValue = (value: number | null, digits: number = 2) =>
    value === null || Number.isNaN(value) ? 'N/A' : value.toFixed(digits);

  const formatHours = (value: number) => `${formatFairnessValue(value, 1)}h`;

  const renderFairnessCell = (
    metric: ScheduleResult['fairnessReport']['employees'][string]['total']
  ) => {
    if (!metric) {
      return <span className="text-slate-400">N/A</span>;
    }

    return (
      <div className="space-y-0.5 text-xs text-slate-700">
        <div>Assigned: {formatHours(metric.assignedHours)}</div>
        <div>Target: {formatHours(metric.targetHours)}</div>
        <div>Load ratio: {formatFairnessValue(metric.loadRatio, 3)}</div>
        <div>Penalty: {formatFairnessValue(metric.penalty, 4)}</div>
      </div>
    );
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(downloadUrl);
  };

  const exportToExcel = () => {
    // Create a matrix for export
    const exportData: any[] = [];
    
    // Header
    const header = ['Name', 'Total Assigned Hrs', 'Buddy Hours', 'Total Preferred Hrs', ...data.days];
    exportData.push(header);

    // Rows
    data.employees.forEach(emp => {
      const row: any[] = [
        emp.name,
        schedule.stats[emp.name].totalAssignedHours,
        schedule.stats[emp.name].totalBuddyHours ?? 0,
        schedule.stats[emp.name].totalPreferredHours
      ];

      data.days.forEach(day => {
        const shifts = sortShiftsByTime(
          schedule.employeeSchedules[emp.name].filter(s => s.day === day)
        );
        if (shifts.length === 0) {
          row.push('');
        } else if (shifts.length === 2) {
          const [s1, s2] = shifts;
          const type1 = s1.isBuddy ? ' (Buddy)' : s1.isWeb ? ' (Web)' : s1.isWebRevision ? ' (Web Rev)' : '';
          const type2 = s2.isBuddy ? ' (Buddy)' : s2.isWeb ? ' (Web)' : s2.isWebRevision ? ' (Web Rev)' : '';
          if (s1.type === 'Morning' && s2.type === 'Afternoon' && type1 === type2) {
            row.push('9:00-17:00' + type1);
          } else {
            row.push(shifts.map(formatShiftLabel).join(', '));
          }
        } else {
          row.push(formatShiftLabel(shifts[0]));
        }
      });
      exportData.push(row);
    });

    const ws = XLSX.utils.aoa_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Schedule');
    XLSX.writeFile(wb, 'ShiftSchedule.xlsx');
  };

  const exportCalendarZip = async () => {
    setCalendarExportError(null);
    setIsExportingCalendars(true);

    try {
      const { zip, filename } = buildCalendarZip(data, schedule);
      const blob = await zip.generateAsync({ type: 'blob' });
      downloadBlob(blob, filename);
    } catch (error) {
      setCalendarExportError(
        error instanceof Error
          ? error.message
          : 'Could not generate the calendar export.'
      );
    } finally {
      setIsExportingCalendars(false);
    }
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

  const unfilledShiftEntries: UnfilledShiftEntry[] = data.days.flatMap(day => {
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="space-y-2">
          <h2 className="text-2xl font-semibold text-slate-900">Generated Schedule</h2>
          <div className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
            <Scale className="h-3.5 w-3.5" />
            Planner: {plannerModeLabel}
          </div>
        </div>
        <div className="flex flex-col items-start gap-2 xl:items-end">
          <div className="flex flex-wrap gap-3">
            <div className="bg-slate-100 p-1 rounded-lg flex text-sm">
              <button 
                onClick={() => setViewMode('employee')}
                className={`px-4 py-1.5 rounded-md font-medium transition-all cursor-pointer ${viewMode === 'employee' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
              >
                By Employee
              </button>
              <button 
                onClick={() => setViewMode('day')}
                className={`px-4 py-1.5 rounded-md font-medium transition-all cursor-pointer ${viewMode === 'day' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
              >
                By Day
              </button>
              <button 
                onClick={() => setViewMode('week')}
                className={`px-4 py-1.5 rounded-md font-medium transition-all cursor-pointer ${viewMode === 'week' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
              >
                By Week
              </button>
            </div>
            <button 
              onClick={exportToExcel}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-emerald-700 transition-colors shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <Download className="w-4 h-4" />
              Export Excel
            </button>
            <button
              onClick={() => {
                void exportCalendarZip();
              }}
              disabled={!canExportCalendars || isExportingCalendars}
              title={!canExportCalendars ? 'Select a calendar year before exporting calendars.' : undefined}
              className={`px-4 py-2 rounded-lg font-medium transition-colors shadow-sm flex items-center gap-2 ${
                !canExportCalendars || isExportingCalendars
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
              }`}
            >
              <Download className="w-4 h-4" />
              {isExportingCalendars ? 'Calendar ZIP...' : 'Export Calendar ZIP'}
            </button>
          </div>
          {!canExportCalendars && (
            <p className="text-sm text-slate-500">
              Select a calendar year before exporting calendars.
            </p>
          )}
        </div>
      </div>

      {calendarExportError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-rose-800">Calendar export failed</h4>
            <p className="text-sm text-rose-700 mt-1">{calendarExportError}</p>
          </div>
        </div>
      )}

      {schedule.buddyProgress && Object.values(schedule.buddyProgress).some(progress => progress.remaining > 0) && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Buddyshifts niet volledig geplaatst: {Object.entries(schedule.buddyProgress).filter(([, progress]) => progress.remaining > 0).map(([name, progress]) => `${name}: ${progress.remaining}`).join(', ')}.
        </div>
      )}

      {viewMode !== 'day' && unfilledShiftEntries.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-amber-800">Unfilled Shifts</h4>
            <p className="text-sm text-amber-700 mt-1">Could not find enough available employees for the following days:</p>
            <ul className="list-disc list-inside text-sm text-amber-700 mt-2">
              {unfilledShiftEntries.map(({ day, label, counts }) => (
                <li key={`${label}-${day}`}>
                  {day} ({label}): missing {formatUnfilledCounts(counts)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <button
          onClick={() => setIsFairnessOpen(open => !open)}
          className="flex w-full items-center justify-between px-5 py-4 text-left transition-colors hover:bg-slate-50"
        >
          <div>
            <h3 className="text-base font-semibold text-slate-900">Fairness Metrics</h3>
            <p className="mt-1 text-sm text-slate-500">
              Jain-index meet gelijkheid van load ratios, Gini meet ongelijkheid, en CV laat de relatieve spreiding zien.
            </p>
          </div>
          {isFairnessOpen ? (
            <ChevronUp className="h-5 w-5 text-slate-500" />
          ) : (
            <ChevronDown className="h-5 w-5 text-slate-500" />
          )}
        </button>

        {isFairnessOpen && (
          <div className="space-y-5 border-t border-slate-200 px-5 py-5">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              Fairness gebruikt per medewerker een eerlijke claim op uren op basis van availability, preferred hours, max hours en contract hours. In deze roosterperiode is de contractcap in het rapport maximaal {formatHours(fairnessReport.contractHoursForPeriod)} per medewerker.
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Group</th>
                    <th className="px-4 py-3 font-medium">Demand</th>
                    <th className="px-4 py-3 font-medium">Penalty</th>
                    <th className="px-4 py-3 font-medium">Jain</th>
                    <th className="px-4 py-3 font-medium">Gini</th>
                    <th className="px-4 py-3 font-medium">CV</th>
                    <th className="px-4 py-3 font-medium">Active Employees</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white text-slate-700">
                  {([
                    ['total', 'Total'],
                    ['normal', 'Normal'],
                    ['web', 'Web'],
                    ['revision', 'Revision'],
                  ] as const).map(([groupKey, label]) => {
                    const group = fairnessReport.groups[groupKey];
                    return (
                      <tr key={groupKey}>
                        <td className="px-4 py-3 font-medium text-slate-900">{label}</td>
                        <td className="px-4 py-3">{formatHours(group.demandHours)}</td>
                        <td className="px-4 py-3">{formatFairnessValue(group.penalty, 4)}</td>
                        <td className="px-4 py-3">{formatFairnessValue(group.jainIndex, 4)}</td>
                        <td className="px-4 py-3">{formatFairnessValue(group.gini, 4)}</td>
                        <td className="px-4 py-3">{formatFairnessValue(group.cv, 4)}</td>
                        <td className="px-4 py-3">{group.activeEmployees}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[1080px] text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Total</th>
                    <th className="px-4 py-3 font-medium">Normal</th>
                    <th className="px-4 py-3 font-medium">Web</th>
                    <th className="px-4 py-3 font-medium">Revision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.employees.map(employee => {
                    const employeeFairness = fairnessReport.employees[employee.name];
                    return (
                      <tr key={employee.name} className="align-top">
                        <td className="px-4 py-3 font-medium text-slate-900">{employee.name}</td>
                        <td className="px-4 py-3">{renderFairnessCell(employeeFairness.total)}</td>
                        <td className="px-4 py-3">{renderFairnessCell(employeeFairness.normal)}</td>
                        <td className="px-4 py-3">{renderFairnessCell(employeeFairness.web)}</td>
                        <td className="px-4 py-3">{renderFairnessCell(employeeFairness.revision)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          {viewMode === 'week' ? (
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-medium sticky left-0 bg-slate-50 z-10">Employee</th>
                  <th className="px-4 py-3 font-medium text-center">Total Hours</th>
                  {weeks.map(week => (
                    <th key={week} className="px-4 py-3 font-medium text-center">
                      Week {week}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.employees.map((emp, idx) => {
                  const stats = schedule.stats[emp.name];
                  const totalPreferred = stats.totalPreferredHours;
                  const totalMinimum = getEmployeeMinimumTotal(emp);
                  const isUnder = stats.totalAssignedHours < totalMinimum;
                  const isOver = stats.totalAssignedHours > stats.totalMaxHours;
                  const isWarning = stats.totalAssignedHours > totalPreferred && stats.totalAssignedHours <= stats.totalMaxHours;
                  
                  return (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900 sticky left-0 bg-white shadow-[1px_0_0_0_#e2e8f0]">
                        {emp.name}
                        {emp.isWebOnly ? (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">WEB ONLY</span>
                        ) : emp.isWeb ? (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">WEB</span>
                        ) : null}
                        {emp.isWebRevision && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800">REV</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          isUnder ? 'bg-red-100 text-red-800' : 
                          isOver ? 'bg-red-600 text-white' :
                          isWarning ? 'bg-amber-100 text-amber-800' : 
                          'bg-emerald-100 text-emerald-800'
                        }`} title={`Assigned: ${stats.totalAssignedHours}h\nMinimum: ${totalMinimum}h\nPreferred: ${totalPreferred}h\nMax: ${stats.totalMaxHours}h`}>
                          {stats.totalAssignedHours} / {totalPreferred} ({stats.totalMaxHours})
                        </div>
                      </td>
                      {weeks.map(week => {
                        const assigned = stats.weeklyAssignedHours[week] || 0;
                        const preferred = getPreferredHours(emp, week, data.days, data.closedDays);
                        const minimum = getMinimumHoursTarget(emp, week, data.days, data.closedDays);
                        const max = getMaxHours(emp, week);
                        const isWeekOverMax = assigned > max;
                        const isWeekOverPref = assigned > preferred && assigned <= max;
                        const isWeekUnderMinimum = assigned < minimum;
                        const isWeekUnderPreferred = assigned < preferred;
                        
                        // Count web and revision shifts for this week
                        const weekShifts = schedule.employeeSchedules[emp.name].filter(s => {
                          return getWeekId(s.day) === week;
                        });
                        const webCount = weekShifts.filter(s => s.isWeb && !s.isWebRevision).length;
                        const revCount = weekShifts.filter(s => s.isWebRevision).length;
                        
                        return (
                          <td key={week} className="px-4 py-3 text-center">
                            <div className={`inline-flex flex-col items-center px-2 py-1 rounded-lg text-xs font-medium ${
                              isWeekOverMax ? 'bg-red-600 text-white' :
                              isWeekOverPref ? 'bg-amber-100 text-amber-800' : 
                              isWeekUnderMinimum ? 'bg-red-100 text-red-800' :
                              isWeekUnderPreferred ? 'bg-slate-100 text-slate-700' : 
                              'bg-emerald-100 text-emerald-800'
                            }`} title={`Assigned: ${assigned}h\nMinimum: ${minimum}h\nPreferred: ${preferred}h\nMax: ${max}h`}>
                              <span>{assigned} / {preferred} ({max})</span>
                              {(webCount > 0 || revCount > 0) && (
                                <span className="text-[10px] opacity-70 mt-0.5">
                                  {webCount > 0 && `W:${webCount}`}
                                  {webCount > 0 && revCount > 0 && ' '}
                                  {revCount > 0 && `R:${revCount}`}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : viewMode === 'employee' ? (
            <table className="w-full text-sm text-left whitespace-nowrap">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 font-medium sticky left-0 bg-slate-50 z-10">Employee</th>
                  <th className="px-4 py-3 font-medium text-center">Total Hours</th>
                  {data.days.map(day => (
                    <th key={day} className="px-4 py-3 font-medium min-w-[120px]" title={day}>
                      {day.split('[')[0].trim() || day.substring(0, 10)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.employees.map((emp, idx) => {
                  const stats = schedule.stats[emp.name];
                  const totalMinimum = getEmployeeMinimumTotal(emp);
                  const totalPreferred = stats.totalPreferredHours;
                  const totalMax = stats.totalMaxHours;
                  const isUnder = stats.totalAssignedHours < totalMinimum;
                  const isOver = stats.totalAssignedHours > totalMax;
                  const isWarning = stats.totalAssignedHours > totalPreferred && stats.totalAssignedHours <= totalMax;
                  
                  return (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-900 sticky left-0 bg-white shadow-[1px_0_0_0_#e2e8f0]">
                        {emp.name}
                        {emp.isWebOnly ? (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">WEB ONLY</span>
                        ) : emp.isWeb ? (
                          <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 text-blue-800">WEB</span>
                        ) : null}
                        {emp.isWebRevision && <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-800">REV</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                          isUnder ? 'bg-red-100 text-red-800' : 
                          isOver ? 'bg-red-600 text-white' : 
                          isWarning ? 'bg-amber-100 text-amber-800' :
                          'bg-emerald-100 text-emerald-800'
                        }`} title={`Assigned: ${stats.totalAssignedHours}h\nMinimum: ${totalMinimum}h\nPreferred: ${totalPreferred}h\nMax: ${totalMax}h`}>
                          {stats.totalAssignedHours} / {totalPreferred} ({totalMax})
                        </div>
                      </td>
                      {data.days.map(day => {
                        const shifts = sortShiftsByTime(
                          schedule.employeeSchedules[emp.name].filter(s => s.day === day)
                        );
                        const isClosed = data.closedDays.includes(day);
                        return (
                          <td key={day} className={`px-4 py-3 ${isClosed ? 'bg-slate-50/50' : ''}`}>
                            {isClosed ? (
                              <span className="text-slate-400 text-[10px] font-medium uppercase tracking-wider">Closed</span>
                            ) : shifts.length === 0 ? (
                              <span className="text-slate-300">-</span>
                            ) : (
                              <div className="flex flex-col gap-1">
                                {shifts.map((s, i) => (
                                  <span key={i} className={`inline-flex items-center px-2 py-1 rounded text-xs font-medium ${
                                    s.isBuddy ? 'bg-amber-50 text-amber-700 border border-amber-200' : s.isWeb ? 'bg-blue-50 text-blue-700 border border-blue-200' :
                                    s.isWebRevision ? 'bg-purple-50 text-purple-700 border border-purple-200' : 
                                    'bg-slate-100 text-slate-700 border border-slate-200'
                                  }`}>
                                    {s.type === 'Morning' ? '09:00 - 13:00' : '13:00 - 17:00'}
                                    {s.isBuddy ? ' (BUDDY)' : s.isWeb && ' (W)'}
                                    {s.isWebRevision && ' (R)'}
                                  </span>
                                ))}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <div className="p-6">
              <DayScheduleEditor
                data={data}
                schedule={schedule}
                generatedSchedule={generatedSchedule}
                savedAt={savedAt}
                onSaveSchedule={onSaveSchedule}
                onResetSchedule={onResetSchedule}
              />
            </div>
          )}
        </div>
      </div>
      
      <ScheduleExplanation />
    </div>
  );
}
