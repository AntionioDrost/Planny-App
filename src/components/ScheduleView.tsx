import React, { useState } from 'react';
import { ParsedData } from '../lib/parser';
import {
  AssignedShift,
  getMaxHours,
  getMinimumHoursTarget,
  getPreferredHours,
  getWeekId,
  ScheduleResult,
} from '../lib/scheduler';
import { Download, AlertCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { ScheduleExplanation } from './ScheduleExplanation';
import { buildCalendarZip } from '../lib/calendarExport';

interface Props {
  schedule: ScheduleResult;
  data: ParsedData;
}

export function ScheduleView({ schedule, data }: Props) {
  const [viewMode, setViewMode] = useState<'employee' | 'day' | 'week'>('employee');
  const [calendarExportError, setCalendarExportError] = useState<string | null>(null);
  const [isExportingCalendars, setIsExportingCalendars] = useState(false);

  const weeks = Array.from(new Set(data.days.map(getWeekId)));
  const canExportCalendars = typeof data.rosterYear === 'number';

  const sortShiftsByTime = (shifts: AssignedShift[]) =>
    [...shifts].sort((left, right) =>
      left.type === right.type ? 0 : left.type === 'Morning' ? -1 : 1
    );

  const formatShiftLabel = (shift: AssignedShift) => {
    const time = shift.type === 'Morning' ? '9:00-13:00' : '13:00-17:00';
    const suffix = shift.isWeb ? ' (Web)' : shift.isWebRevision ? ' (Web Rev)' : '';
    return `${time}${suffix}`;
  };

  const getEmployeeMinimumTotal = (employee: ParsedData['employees'][number]) =>
    weeks.reduce(
      (total, weekId) => total + getMinimumHoursTarget(employee, weekId, data.days, data.closedDays),
      0
    );

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
    const header = ['Name', 'Total Assigned Hrs', 'Total Preferred Hrs', ...data.days];
    exportData.push(header);

    // Rows
    data.employees.forEach(emp => {
      const row: any[] = [
        emp.name,
        schedule.stats[emp.name].totalAssignedHours,
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
          const type1 = s1.isWeb ? ' (Web)' : s1.isWebRevision ? ' (Web Rev)' : '';
          const type2 = s2.isWeb ? ' (Web)' : s2.isWebRevision ? ' (Web Rev)' : '';
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
          : 'Kon agenda-export niet genereren.'
      );
    } finally {
      setIsExportingCalendars(false);
    }
  };

  const unmetWebShifts = Object.entries(schedule.unfilledWebShifts).filter(([day, counts]) => !data.closedDays.includes(day) && (counts.morning > 0 || counts.afternoon > 0));
  const unmetWebRevisionShifts = Object.entries(schedule.unfilledWebRevisionShifts || {}).filter(([day, counts]) => !data.closedDays.includes(day) && (counts.morning > 0 || counts.afternoon > 0));
  const unmetNormalShifts = Object.entries(schedule.unfilledNormalShifts || {}).filter(([day, counts]) => !data.closedDays.includes(day) && (counts.morning > 0 || counts.afternoon > 0));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <h2 className="text-2xl font-semibold text-slate-900">Generated Schedule</h2>
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
              title={!canExportCalendars ? 'Kies eerst een roosterjaar voor agenda-export.' : undefined}
              className={`px-4 py-2 rounded-lg font-medium transition-colors shadow-sm flex items-center gap-2 ${
                !canExportCalendars || isExportingCalendars
                  ? 'bg-slate-200 text-slate-500 cursor-not-allowed'
                  : 'bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer'
              }`}
            >
              <Download className="w-4 h-4" />
              {isExportingCalendars ? 'Agenda ZIP...' : 'Export Agenda ZIP'}
            </button>
          </div>
          {!canExportCalendars && (
            <p className="text-sm text-slate-500">
              Kies eerst een roosterjaar voor agenda-export.
            </p>
          )}
        </div>
      </div>

      {calendarExportError && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-rose-800">Agenda-export mislukt</h4>
            <p className="text-sm text-rose-700 mt-1">{calendarExportError}</p>
          </div>
        </div>
      )}

      {(unmetWebShifts.length > 0 || unmetWebRevisionShifts.length > 0 || unmetNormalShifts.length > 0) && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-amber-800">Unfilled Shifts</h4>
            <p className="text-sm text-amber-700 mt-1">Could not find enough available employees for the following days:</p>
            <ul className="list-disc list-inside text-sm text-amber-700 mt-2">
              {unmetNormalShifts.map(([day, counts]) => (
                <li key={`normal-${day}`}>
                  {day} (Normal): missing {counts.morning > 0 ? `${counts.morning} morning ` : ''}
                  {counts.morning > 0 && counts.afternoon > 0 ? 'and ' : ''}
                  {counts.afternoon > 0 ? `${counts.afternoon} afternoon ` : ''}
                  shift(s)
                </li>
              ))}
              {unmetWebShifts.map(([day, counts]) => (
                <li key={`web-${day}`}>
                  {day} (Web): missing {counts.morning > 0 ? `${counts.morning} morning ` : ''}
                  {counts.morning > 0 && counts.afternoon > 0 ? 'and ' : ''}
                  {counts.afternoon > 0 ? `${counts.afternoon} afternoon ` : ''}
                  shift(s)
                </li>
              ))}
              {unmetWebRevisionShifts.map(([day, counts]) => (
                <li key={`rev-${day}`}>
                  {day} (Web Revision): missing {counts.morning > 0 ? `${counts.morning} morning ` : ''}
                  {counts.morning > 0 && counts.afternoon > 0 ? 'and ' : ''}
                  {counts.afternoon > 0 ? `${counts.afternoon} afternoon ` : ''}
                  shift(s)
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

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
                                    s.isWeb ? 'bg-blue-50 text-blue-700 border border-blue-200' : 
                                    s.isWebRevision ? 'bg-purple-50 text-purple-700 border border-purple-200' : 
                                    'bg-slate-100 text-slate-700 border border-slate-200'
                                  }`}>
                                    {s.type === 'Morning' ? '09:00 - 13:00' : '13:00 - 17:00'}
                                    {s.isWeb && ' (W)'}
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
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {data.days.map(day => {
                // Find all shifts for this day
                const morningNormal: string[] = [];
                const morningWeb: string[] = [];
                const morningWebRev: string[] = [];
                const afternoonNormal: string[] = [];
                const afternoonWeb: string[] = [];
                const afternoonWebRev: string[] = [];
                
                const missingNormal = schedule.unfilledNormalShifts?.[day] || { morning: 0, afternoon: 0 };
                const missingWeb = schedule.unfilledWebShifts?.[day] || { morning: 0, afternoon: 0 };
                const missingWebRev = schedule.unfilledWebRevisionShifts?.[day] || { morning: 0, afternoon: 0 };
                const isClosed = data.closedDays.includes(day);
                
                data.employees.forEach(emp => {
                  const shifts = schedule.employeeSchedules[emp.name].filter(s => s.day === day);
                  shifts.forEach(s => {
                    if (s.type === 'Morning') {
                      if (s.isWeb) morningWeb.push(emp.name);
                      else if (s.isWebRevision) morningWebRev.push(emp.name);
                      else morningNormal.push(emp.name);
                    }
                    if (s.type === 'Afternoon') {
                      if (s.isWeb) afternoonWeb.push(emp.name);
                      else if (s.isWebRevision) afternoonWebRev.push(emp.name);
                      else afternoonNormal.push(emp.name);
                    }
                  });
                });

                return (
                  <div key={day} className={`border border-slate-200 rounded-xl overflow-hidden ${isClosed ? 'opacity-60 bg-slate-50' : ''}`}>
                    <div className={`px-4 py-3 border-b border-slate-200 ${isClosed ? 'bg-slate-100' : 'bg-slate-50'}`}>
                      <h4 className="font-medium text-slate-900 truncate flex items-center justify-between" title={day}>
                        <span>{day}</span>
                        {isClosed && <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Office Closed</span>}
                      </h4>
                    </div>
                    <div className="p-4 space-y-4">
                      {isClosed ? (
                        <div className="py-8 text-center">
                          <p className="text-sm text-slate-500 italic">No shifts scheduled for this day.</p>
                        </div>
                      ) : (
                        <>
                          <div>
                            <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Morning (09:00 - 13:00)</h5>
                            {morningNormal.length > 0 || morningWeb.length > 0 || morningWebRev.length > 0 || missingNormal.morning > 0 || missingWeb.morning > 0 || missingWebRev.morning > 0 ? (
                              <ul className="space-y-1">
                                {morningNormal.map((name, i) => (
                                  <li key={`mn-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-slate-700">{name}</span>
                                  </li>
                                ))}
                                {Array.from({ length: missingNormal.morning }).map((_, i) => (
                                  <li key={`mn-miss-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-red-600 font-medium italic">Missing Person</span>
                                  </li>
                                ))}
                                {morningWeb.map((name, i) => (
                                  <li key={`mw-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-blue-700 font-medium">{name}</span>
                                    <span className="text-[10px] font-medium bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">WEB</span>
                                  </li>
                                ))}
                                {Array.from({ length: missingWeb.morning }).map((_, i) => (
                                  <li key={`mw-miss-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-red-600 font-medium italic">Missing Person</span>
                                    <span className="text-[10px] font-medium bg-red-100 text-red-800 px-1.5 py-0.5 rounded">WEB</span>
                                  </li>
                                ))}
                                {morningWebRev.map((name, i) => (
                                  <li key={`mwr-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-purple-700 font-medium">{name}</span>
                                    <span className="text-[10px] font-medium bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">REV</span>
                                  </li>
                                ))}
                                {Array.from({ length: missingWebRev.morning }).map((_, i) => (
                                  <li key={`mwr-miss-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-red-600 font-medium italic">Missing Person</span>
                                    <span className="text-[10px] font-medium bg-red-100 text-red-800 px-1.5 py-0.5 rounded">REV</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-slate-400 italic">No shifts assigned</p>
                            )}
                          </div>
                          <div className="pt-4 border-t border-slate-100">
                            <h5 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Afternoon (13:00 - 17:00)</h5>
                            {afternoonNormal.length > 0 || afternoonWeb.length > 0 || afternoonWebRev.length > 0 || missingNormal.afternoon > 0 || missingWeb.afternoon > 0 || missingWebRev.afternoon > 0 ? (
                              <ul className="space-y-1">
                                {afternoonNormal.map((name, i) => (
                                  <li key={`an-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-slate-700">{name}</span>
                                  </li>
                                ))}
                                {Array.from({ length: missingNormal.afternoon }).map((_, i) => (
                                  <li key={`an-miss-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-red-600 font-medium italic">Missing Person</span>
                                  </li>
                                ))}
                                {afternoonWeb.map((name, i) => (
                                  <li key={`aw-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-blue-700 font-medium">{name}</span>
                                    <span className="text-[10px] font-medium bg-blue-100 text-blue-800 px-1.5 py-0.5 rounded">WEB</span>
                                  </li>
                                ))}
                                {Array.from({ length: missingWeb.afternoon }).map((_, i) => (
                                  <li key={`aw-miss-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-red-600 font-medium italic">Missing Person</span>
                                    <span className="text-[10px] font-medium bg-red-100 text-red-800 px-1.5 py-0.5 rounded">WEB</span>
                                  </li>
                                ))}
                                {afternoonWebRev.map((name, i) => (
                                  <li key={`awr-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-purple-700 font-medium">{name}</span>
                                    <span className="text-[10px] font-medium bg-purple-100 text-purple-800 px-1.5 py-0.5 rounded">REV</span>
                                  </li>
                                ))}
                                {Array.from({ length: missingWebRev.afternoon }).map((_, i) => (
                                  <li key={`awr-miss-${i}`} className="text-sm flex items-center justify-between">
                                    <span className="text-red-600 font-medium italic">Missing Person</span>
                                    <span className="text-[10px] font-medium bg-red-100 text-red-800 px-1.5 py-0.5 rounded">REV</span>
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <p className="text-sm text-slate-400 italic">No shifts assigned</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      
      <ScheduleExplanation />
    </div>
  );
}
