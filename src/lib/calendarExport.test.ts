import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { ParsedData, EmployeeData } from './parser';
import { AssignedShift, ScheduleResult } from './scheduler';
import {
  buildCalendarZip,
  buildEmployeeCalendarEvents,
  buildRosterDayMap,
  serializeEmployeeCalendar,
} from './calendarExport';

const createEmployee = (name: string): EmployeeData => ({
  name,
  availability: {},
  isWeb: false,
  isWebRevision: false,
  isWebOnly: false,
  preferredHours: 8,
  maxHours: 8,
  weeklyPreferredHoursOverride: {},
  weeklyMaxHoursOverride: {},
  fullDayPriority: 1,
});

const createScheduleResult = (
  employeeNames: string[],
  schedules: Partial<Record<string, AssignedShift[]>>
): ScheduleResult => {
  const employeeSchedules = Object.fromEntries(
    employeeNames.map(name => [name, schedules[name] ?? []])
  ) as Record<string, AssignedShift[]>;

  const stats = Object.fromEntries(
    employeeNames.map(name => {
      const assignedHours = employeeSchedules[name].length * 4;
      return [
        name,
        {
          totalAssignedHours: assignedHours,
          totalPreferredHours: 0,
          totalMaxHours: 0,
          preferredHoursPerWeek: 0,
          weeklyAssignedHours: {},
        },
      ];
    })
  ) as ScheduleResult['stats'];

  return {
    employeeSchedules,
    unfilledNormalShifts: {},
    unfilledWebShifts: {},
    unfilledWebRevisionShifts: {},
    stats,
  };
};

describe('calendar export helpers', () => {
  it('resolves same-month, cross-month and year-wrapping day labels', () => {
    const dayMap = buildRosterDayMap(
      [
        '[15] 06 - 10 April [Monday - OFFICE CLOSED]',
        '[15] 06 - 10 April [Tuesday]',
        '[18] 27 April - 01 May [Thursday]',
        '[53] 29 December - 02 January [Vrijdag]',
      ],
      2026
    );

    expect(dayMap['[15] 06 - 10 April [Monday - OFFICE CLOSED]']).toEqual({
      year: 2026,
      month: 4,
      day: 6,
    });
    expect(dayMap['[15] 06 - 10 April [Tuesday]']).toEqual({
      year: 2026,
      month: 4,
      day: 7,
    });
    expect(dayMap['[18] 27 April - 01 May [Thursday]']).toEqual({
      year: 2026,
      month: 4,
      day: 30,
    });
    expect(dayMap['[53] 29 December - 02 January [Vrijdag]']).toEqual({
      year: 2027,
      month: 1,
      day: 1,
    });
  });

  it('supports Dutch weekday labels with GESLOTEN suffixes', () => {
    const dayMap = buildRosterDayMap(
      ['[52] 29 December - 02 January [Maandag - GESLOTEN]'],
      2025
    );

    expect(dayMap['[52] 29 December - 02 January [Maandag - GESLOTEN]']).toEqual({
      year: 2025,
      month: 12,
      day: 29,
    });
  });

  it('uses the numeric week label as anchor when the printed date range is inconsistent', () => {
    const dayMap = buildRosterDayMap(
      [
        '[16] 13 - 17 April [Friday]',
        '[17] 23 - 27 April [Monday]',
        '[17] 23 - 27 April [Tuesday]',
        '[17] 23 - 27 April [Wednesday]',
        '[17] 23 - 27 April [Thursday]',
        '[17] 23 - 27 April [Friday]',
        '[18] 27 April - 01 May [Monday - OFFICE CLOSED]',
        '[18] 27 April - 01 May [Tuesday]',
        '[18] 27 April - 01 May [Wednesday]',
      ],
      2026
    );

    expect(dayMap['[17] 23 - 27 April [Monday]']).toEqual({
      year: 2026,
      month: 4,
      day: 20,
    });
    expect(dayMap['[17] 23 - 27 April [Tuesday]']).toEqual({
      year: 2026,
      month: 4,
      day: 21,
    });
    expect(dayMap['[17] 23 - 27 April [Friday]']).toEqual({
      year: 2026,
      month: 4,
      day: 24,
    });
    expect(dayMap['[18] 27 April - 01 May [Wednesday]']).toEqual({
      year: 2026,
      month: 4,
      day: 29,
    });
  });

  it('merges morning and afternoon shifts into one full-day event', () => {
    const dayLabel = '[15] 06 - 10 April [Tuesday]';
    const events = buildEmployeeCalendarEvents(
      'Rosa',
      [
        { day: dayLabel, type: 'Morning', isWeb: false },
        { day: dayLabel, type: 'Afternoon', isWeb: true },
      ],
      {
        [dayLabel]: { year: 2026, month: 4, day: 7 },
      }
    );

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Werkdienst (Gemengd)');
    expect(events[0].start).toMatchObject({ hour: 9, minute: 0 });
    expect(events[0].end).toMatchObject({ hour: 17, minute: 0 });
    expect(events[0].description).toContain('09:00-13:00 Normal');
    expect(events[0].description).toContain('13:00-17:00 Web');
  });

  it('keeps a single afternoon shift as one event', () => {
    const dayLabel = '[15] 06 - 10 April [Thursday]';
    const events = buildEmployeeCalendarEvents(
      'Rosa',
      [{ day: dayLabel, type: 'Afternoon', isWeb: false, isWebRevision: true }],
      {
        [dayLabel]: { year: 2026, month: 4, day: 9 },
      }
    );

    expect(events).toHaveLength(1);
    expect(events[0].summary).toBe('Werkdienst (Web Revision)');
    expect(events[0].start).toMatchObject({ hour: 13, minute: 0 });
    expect(events[0].end).toMatchObject({ hour: 17, minute: 0 });
  });

  it('serializes timezone-aware ICS with escaped text fields', () => {
    const employeeName = 'Anna, Semi; Slash\\';
    const events = buildEmployeeCalendarEvents(
      employeeName,
      [{ day: '[15] 06 - 10 April [Tuesday]', type: 'Morning', isWeb: false }],
      {
        '[15] 06 - 10 April [Tuesday]': { year: 2026, month: 4, day: 7 },
      }
    );

    const calendar = serializeEmployeeCalendar(employeeName, events, {
      generatedAt: new Date(Date.UTC(2026, 2, 16, 9, 30, 0)),
    });

    expect(calendar).toContain('X-WR-TIMEZONE:Europe/Amsterdam');
    expect(calendar).toContain('DTSTART;TZID=Europe/Amsterdam:20260407T090000');
    expect(calendar).toContain('DTEND;TZID=Europe/Amsterdam:20260407T130000');
    expect(calendar).toContain('Anna\\, Semi\\; Slash\\\\');
  });

  it('builds a zip with one ICS per employee, including empty calendars', async () => {
    const employees = [createEmployee('Alice'), createEmployee('Bob/Carol')];
    const data: ParsedData = {
      days: ['[15] 06 - 10 April [Tuesday]'],
      closedDays: [],
      employees,
      weeklyWebRequirements: {},
      rosterYear: 2026,
    };
    const schedule = createScheduleResult(
      employees.map(employee => employee.name),
      {
        Alice: [{ day: '[15] 06 - 10 April [Tuesday]', type: 'Morning', isWeb: false }],
      }
    );

    const { zip } = buildCalendarZip(data, schedule, {
      generatedAt: new Date(Date.UTC(2026, 2, 16, 9, 30, 0)),
    });
    const zipBytes = await zip.generateAsync({ type: 'uint8array' });
    const loadedZip = await JSZip.loadAsync(zipBytes);
    const aliceCalendar = await loadedZip.file('kalenders/Alice.ics')?.async('string');
    const bobCalendar = await loadedZip.file('kalenders/Bob_Carol.ics')?.async('string');

    expect(aliceCalendar).toContain('BEGIN:VEVENT');
    expect(bobCalendar).toContain('BEGIN:VCALENDAR');
    expect(bobCalendar).not.toContain('BEGIN:VEVENT');
  });
});
