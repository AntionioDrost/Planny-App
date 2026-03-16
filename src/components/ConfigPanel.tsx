import React, { useState } from 'react';
import { ParsedData, WeeklyWebRequirement } from '../lib/parser';
import { Users, Play, Globe } from 'lucide-react';

interface Props {
  data: ParsedData;
  onChange: (data: ParsedData) => void;
  onGenerate: () => void;
  onClear: () => void;
}

export function ConfigPanel({ data, onChange, onGenerate, onClear }: Props) {
  const [activeTab, setActiveTab] = useState<'main' | 'web' | 'fullDays'>('main');

  const updateEmployee = (
    index: number,
    updater: (employee: ParsedData['employees'][number]) => ParsedData['employees'][number]
  ) => {
    const employees = data.employees.map((employee, employeeIndex) =>
      employeeIndex === index ? updater(employee) : employee
    );
    onChange({ ...data, employees });
  };

  const handlePrefHoursChange = (index: number, hours: number) => {
    updateEmployee(index, employee => ({ ...employee, preferredHours: hours }));
  };

  const handleMaxHoursChange = (index: number, hours: number) => {
    updateEmployee(index, employee => ({ ...employee, maxHours: hours }));
  };

  const handleWeeklyOverrideChange = (index: number, week: string, hours: number | null) => {
    updateEmployee(index, employee => ({
      ...employee,
      weeklyPreferredHoursOverride: {
        ...employee.weeklyPreferredHoursOverride,
        [week]: hours,
      },
    }));
  };

  const handleWeeklyMaxOverrideChange = (index: number, week: string, hours: number | null) => {
    updateEmployee(index, employee => ({
      ...employee,
      weeklyMaxHoursOverride: {
        ...employee.weeklyMaxHoursOverride,
        [week]: hours,
      },
    }));
  };

  const weeks = Array.from(new Set(data.days.map(d => {
    const m = d.match(/^\[(.*?)\]/);
    return m ? m[1] : 'default';
  })));
  const mainShiftWeeks = weeks.includes('default')
    ? ['default', ...weeks.filter(week => week !== 'default')]
    : weeks;

  const getMainShiftWeekLabel = (week: string) =>
    week === 'default' ? 'Default' : `Wk ${week}`;

  const getOverrideInputClassName = (type: 'pref' | 'max', hasValue: boolean) => {
    const toneClasses = hasValue
      ? type === 'pref'
        ? 'border-indigo-200 bg-indigo-50 text-indigo-950'
        : 'border-amber-200 bg-amber-50 text-amber-950'
      : 'border-slate-300 bg-white text-slate-900';

    return `w-full min-w-[4.75rem] rounded-md border px-2 py-1.5 text-right outline-none transition-colors placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 ${toneClasses}`;
  };

  const handleWebToggle = (index: number) => {
    updateEmployee(index, employee => ({ ...employee, isWeb: !employee.isWeb }));
  };

  const handleWebRevisionToggle = (index: number) => {
    updateEmployee(index, employee => ({
      ...employee,
      isWebRevision: !employee.isWebRevision,
    }));
  };

  const handleWebOnlyToggle = (index: number) => {
    updateEmployee(index, employee => {
      const isWebOnly = !employee.isWebOnly;
      return {
        ...employee,
        isWebOnly,
        isWeb: isWebOnly ? true : employee.isWeb,
      };
    });
  };

  const handleFullDaysPriorityChange = (index: number, value: number) => {
    updateEmployee(index, employee => ({ ...employee, fullDayPriority: value }));
  };

  const handleRosterYearChange = (value: string) => {
    const trimmedValue = value.trim();
    const parsedYear = trimmedValue === '' ? null : parseInt(trimmedValue, 10);
    onChange({
      ...data,
      rosterYear:
        parsedYear !== null && !Number.isNaN(parsedYear) ? parsedYear : null,
    });
  };

  const handleWeeklyRequirementChange = (
    week: string,
    field: keyof WeeklyWebRequirement,
    value: WeeklyWebRequirement[keyof WeeklyWebRequirement]
  ) => {
    const currentWeekRequirement = data.weeklyWebRequirements?.[week] ?? {
        webShifts: 0,
        webShiftDays: [],
        webShiftTimePreference: 'Afternoon',
        webRevisionShifts: 0,
        webRevisionDays: [],
        webRevisionTimePreference: 'Afternoon'
      };

    onChange({
      ...data,
      weeklyWebRequirements: {
        ...data.weeklyWebRequirements,
        [week]: {
          ...currentWeekRequirement,
          [field]: value,
        },
      },
    });
  };

  const toggleDayInArray = (array: string[], day: string) => {
    if (array.includes(day)) {
      return array.filter(d => d !== day);
    }
    return [...array, day];
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:justify-between lg:items-center">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">Configuration</h2>
          <p className="text-slate-500">Review and adjust settings before generating the schedule.</p>
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
            <div className="bg-white border border-slate-200 rounded-xl px-4 py-2">
              <div className="flex items-center gap-3">
                <label className="text-sm font-medium text-slate-700">Roosterjaar</label>
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  step="1"
                  placeholder="2026"
                  value={data.rosterYear ?? ''}
                  onChange={(e) => handleRosterYearChange(e.target.value)}
                  className="w-24 px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm bg-white"
                />
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Alleen gebruikt voor `.ics`-export per werknemer.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={onClear}
              className="text-slate-600 px-4 py-2.5 rounded-xl font-medium hover:bg-slate-100 transition-colors cursor-pointer"
            >
              Clear Data
            </button>
            <button 
              onClick={onGenerate}
              className="bg-indigo-600 text-white px-6 py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition-colors shadow-sm flex items-center gap-2 cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              Generate Schedule
            </button>
          </div>
        </div>
      </div>

      <div className="flex border-b border-slate-200">
        <button
          className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
            activeTab === 'main' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
          onClick={() => setActiveTab('main')}
        >
          Main Shifts
        </button>
        <button
          className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
            activeTab === 'web' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
          onClick={() => setActiveTab('web')}
        >
          Web & Web Revision
        </button>
        <button
          className={`px-6 py-3 font-medium text-sm transition-colors border-b-2 ${
            activeTab === 'fullDays' 
              ? 'border-indigo-600 text-indigo-600' 
              : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
          }`}
          onClick={() => setActiveTab('fullDays')}
        >
          Full Days
        </button>
      </div>

      {activeTab === 'main' && (
        <div className="grid grid-cols-1 gap-8">
          {/* Employees List */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-500" />
              <h3 className="font-medium text-slate-900">Employees ({data.employees.length})</h3>
            </div>
            <div className="px-6 py-2.5 border-b border-slate-200 bg-white">
              <p className="text-xs font-medium text-slate-500">Empty override = base weekly hours</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-white border-b border-slate-200">
                  <tr>
                    <th className="sticky left-0 z-20 bg-white px-6 py-3 font-medium shadow-[1px_0_0_0_#e2e8f0]">Name</th>
                    <th className="px-6 py-3 font-medium">Pref Hrs/Wk</th>
                    <th className="px-6 py-3 font-medium">Max Hrs/Wk</th>
                    {mainShiftWeeks.map((week, weekIndex) => (
                      <th
                        key={week}
                        className={`min-w-[11.5rem] border-l border-slate-200 px-5 py-3 font-medium text-left ${
                          weekIndex % 2 === 0 ? 'bg-slate-100/80' : 'bg-slate-100'
                        }`}
                      >
                        {getMainShiftWeekLabel(week)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.employees.map((emp, idx) => (
                    <tr key={idx} className="group hover:bg-slate-50/50 transition-colors">
                      <td className="sticky left-0 z-10 bg-white px-6 py-3 font-medium text-slate-900 shadow-[1px_0_0_0_#e2e8f0] transition-colors group-hover:bg-slate-50/50">
                        <div className="min-w-[12rem] whitespace-normal break-words">{emp.name}</div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <input 
                            type="number" 
                            min="0" 
                            max="40" 
                            step="4"
                            value={emp.preferredHours}
                            onChange={(e) => handlePrefHoursChange(idx, parseInt(e.target.value) || 0)}
                            className="w-16 px-2 py-1 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          />
                        </div>
                      </td>
                      <td className="px-6 py-3">
                        <div className="flex items-center gap-2">
                          <input 
                            type="number" 
                            min="0" 
                            max="40" 
                            step="4"
                            value={emp.maxHours}
                            onChange={(e) => handleMaxHoursChange(idx, parseInt(e.target.value) || 0)}
                            className="w-16 px-2 py-1 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          />
                        </div>
                      </td>
                      {mainShiftWeeks.map((week, weekIndex) => {
                        const preferredOverride = emp.weeklyPreferredHoursOverride[week];
                        const maxOverride = emp.weeklyMaxHoursOverride[week];
                        const weekCellTint = weekIndex % 2 === 0 ? 'bg-white' : 'bg-slate-50/60';

                        return (
                          <td
                            key={week}
                            className={`border-l border-slate-200 px-5 py-3 align-top ${weekCellTint}`}
                          >
                            <div className="grid gap-2">
                              <label className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  Pref
                                </span>
                                <input 
                                  type="number" 
                                  min="0" 
                                  max="40" 
                                  step="4"
                                  placeholder={`${emp.preferredHours}`}
                                  value={preferredOverride ?? ''}
                                  aria-label={`${emp.name} pref override ${week}`}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    handleWeeklyOverrideChange(idx, week, val === '' ? null : parseInt(val));
                                  }}
                                  className={getOverrideInputClassName('pref', preferredOverride !== null && preferredOverride !== undefined)}
                                />
                              </label>
                              <label className="grid grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-2">
                                <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                                  Max
                                </span>
                                <input 
                                  type="number" 
                                  min="0" 
                                  max="40" 
                                  step="4"
                                  placeholder={`${emp.maxHours}`}
                                  value={maxOverride ?? ''}
                                  aria-label={`${emp.name} max override ${week}`}
                                  onChange={(e) => {
                                    const val = e.target.value;
                                    handleWeeklyMaxOverrideChange(idx, week, val === '' ? null : parseInt(val));
                                  }}
                                  className={getOverrideInputClassName('max', maxOverride !== null && maxOverride !== undefined)}
                                />
                              </label>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'web' && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Web Employees List */}
            <div className="lg:col-span-1 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden h-fit">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-500" />
              <h3 className="font-medium text-slate-900">Web Capabilities</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-white border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-3 font-medium">Name</th>
                    <th className="px-6 py-3 font-medium text-center">Web</th>
                    <th className="px-6 py-3 font-medium text-center">Web Only</th>
                    <th className="px-6 py-3 font-medium text-center">Revision</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.employees.map((emp, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-6 py-3 font-medium text-slate-900">{emp.name}</td>
                      <td className="px-6 py-3 text-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={emp.isWeb}
                            onChange={() => handleWebToggle(idx)}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </td>
                      <td className="px-6 py-3 text-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={emp.isWebOnly || false}
                            onChange={() => handleWebOnlyToggle(idx)}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </td>
                      <td className="px-6 py-3 text-center">
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input 
                            type="checkbox" 
                            className="sr-only peer" 
                            checked={emp.isWebRevision || false}
                            onChange={() => handleWebRevisionToggle(idx)}
                          />
                          <div className="w-9 h-5 bg-slate-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-indigo-100 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600"></div>
                        </label>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Weekly Web Requirements */}
          <div className="lg:col-span-2 space-y-6">
            {weeks.map(week => {
              const req = data.weeklyWebRequirements?.[week] || {
                webShifts: 0,
                webShiftDays: [],
                webShiftTimePreference: 'Afternoon',
                webRevisionShifts: 0,
                webRevisionDays: [],
                webRevisionTimePreference: 'Afternoon'
              };
              const daysInWeek = data.days.filter(d => {
                const m = d.match(/^\[(.*?)\]/);
                return (m ? m[1] : 'default') === week;
              });

              return (
                <div key={week} className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
                    <Globe className="w-5 h-5 text-slate-500" />
                    <h3 className="font-medium text-slate-900">
                      {week === 'default' ? 'Web Requirements' : `Week ${week} Web Requirements`}
                    </h3>
                  </div>
                  <div className="p-6 space-y-6">
                    <p className="text-sm text-slate-500">
                      Deze aantallen zijn de weeklimiet voor web- en revision-shifts. De planner plant niet meer webshifts in dan hier voor de week is ingesteld.
                    </p>

                    {/* Web Shifts */}
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-4">
                          <label className="text-sm font-medium text-slate-700 w-48">Required Web Shifts:</label>
                          <input 
                            type="number" 
                            min="0"
                            value={req.webShifts}
                            onChange={(e) => handleWeeklyRequirementChange(week, 'webShifts', parseInt(e.target.value) || 0)}
                            className="w-20 px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm font-medium text-slate-700 sm:w-auto w-48">Time Preference:</label>
                          <select
                            value={req.webShiftTimePreference || 'Any'}
                            onChange={(e) => handleWeeklyRequirementChange(week, 'webShiftTimePreference', e.target.value)}
                            className="px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                          >
                            <option value="Any">Any</option>
                            <option value="Morning">Morning</option>
                            <option value="Afternoon">Afternoon</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex items-start gap-4">
                        <label className="text-sm font-medium text-slate-700 w-48 pt-2">Allowed Days:</label>
                        <div className="flex flex-wrap gap-2 flex-1">
                          {daysInWeek.map(day => (
                            <button
                              key={`web-${day}`}
                              onClick={() => handleWeeklyRequirementChange(week, 'webShiftDays', toggleDayInArray(req.webShiftDays, day))}
                              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                                req.webShiftDays.includes(day)
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium'
                                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {day.split('[')[0].trim() || day}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <div className="h-px bg-slate-100"></div>

                    {/* Web Revision Shifts */}
                    <div className="space-y-4">
                      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                        <div className="flex items-center gap-4">
                          <label className="text-sm font-medium text-slate-700 w-48">Required Revision Shifts:</label>
                          <input 
                            type="number" 
                            min="0"
                            value={req.webRevisionShifts}
                            onChange={(e) => handleWeeklyRequirementChange(week, 'webRevisionShifts', parseInt(e.target.value) || 0)}
                            className="w-20 px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-4">
                          <label className="text-sm font-medium text-slate-700 sm:w-auto w-48">Time Preference:</label>
                          <select
                            value={req.webRevisionTimePreference || 'Any'}
                            onChange={(e) => handleWeeklyRequirementChange(week, 'webRevisionTimePreference', e.target.value)}
                            className="px-3 py-1.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm"
                          >
                            <option value="Any">Any</option>
                            <option value="Morning">Morning</option>
                            <option value="Afternoon">Afternoon</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex items-start gap-4">
                        <label className="text-sm font-medium text-slate-700 w-48 pt-2">Allowed Days:</label>
                        <div className="flex flex-wrap gap-2 flex-1">
                          {daysInWeek.map(day => (
                            <button
                              key={`rev-${day}`}
                              onClick={() => handleWeeklyRequirementChange(week, 'webRevisionDays', toggleDayInArray(req.webRevisionDays, day))}
                              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                                req.webRevisionDays.includes(day)
                                  ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-medium'
                                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                              }`}
                            >
                              {day.split('[')[0].trim() || day}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        </div>
      )}

      {activeTab === 'fullDays' && (
        <div className="grid grid-cols-1 gap-8">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
              <Users className="w-5 h-5 text-slate-500" />
              <h3 className="font-medium text-slate-900">Full Day Priority</h3>
            </div>
            <div className="p-6">
              <p className="text-sm text-slate-500 mb-6">
                Adjust how much each employee is favored for getting full days (two shifts on the same day). 
                A higher value means they have a higher priority for full days.
              </p>
              <div className="space-y-6">
                {data.employees.map((emp, idx) => (
                  <div key={idx} className="flex items-center gap-4">
                    <div className="w-48 font-medium text-slate-900">{emp.name}</div>
                    <div className="flex-1 flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {[1, 2, 3, 4, 5].map((num) => {
                          let currentVal = emp.fullDayPriority;
                          if (currentVal === undefined || currentVal === null) currentVal = 1;
                          else if (currentVal > 5) currentVal = Math.max(1, Math.round(currentVal / 20));
                          else if (currentVal === 0) currentVal = 1;

                          return (
                            <button
                              key={num}
                              onClick={() => handleFullDaysPriorityChange(idx, num)}
                              className={`w-10 h-10 rounded-lg font-medium transition-colors cursor-pointer ${
                                currentVal === num
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {num}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
