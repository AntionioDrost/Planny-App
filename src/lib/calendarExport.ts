import JSZip from 'jszip';
import { ParsedData } from './parser';
import { AssignedShift, ScheduleResult } from './scheduler';

type ShiftKind = 'normal' | 'web' | 'revision';

interface ParsedDayLabel {
  weekToken: string;
  weekNumber: number | null;
  originalLabel: string;
  weekdayIndex: number;
  startDay: number;
  startMonthIndex: number;
  endDay: number;
  endMonthIndex: number;
}

interface BuildCalendarZipOptions {
  generatedAt?: Date;
}

export interface ResolvedRosterDay {
  year: number;
  month: number;
  day: number;
}

export interface CalendarDateTime extends ResolvedRosterDay {
  hour: number;
  minute: number;
}

export interface EmployeeCalendarEvent {
  dayLabel: string;
  start: CalendarDateTime;
  end: CalendarDateTime;
  summary: string;
  description: string;
  uid: string;
}

const ICS_PRODUCT_ID = '-//ShiftPlanner Pro//Employee Calendar//NL';
const ICS_TIMEZONE_ID = 'Europe/Amsterdam';

const MONTH_INDEX_BY_NAME: Record<string, number> = {
  jan: 0,
  january: 0,
  januari: 0,
  feb: 1,
  february: 1,
  februari: 1,
  mar: 2,
  march: 2,
  maart: 2,
  apr: 3,
  april: 3,
  may: 4,
  mei: 4,
  jun: 5,
  june: 5,
  juni: 5,
  jul: 6,
  july: 6,
  juli: 6,
  aug: 7,
  august: 7,
  augustus: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  oktober: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const WEEKDAY_INDEX_BY_NAME: Record<string, number> = {
  sun: 0,
  sunday: 0,
  zondag: 0,
  mon: 1,
  monday: 1,
  maandag: 1,
  tue: 2,
  tuesday: 2,
  dinsdag: 2,
  wed: 3,
  wednesday: 3,
  woensdag: 3,
  thu: 4,
  thursday: 4,
  donderdag: 4,
  fri: 5,
  friday: 5,
  vrijdag: 5,
  sat: 6,
  saturday: 6,
  zaterdag: 6,
};

const AMSTERDAM_TIMEZONE_BLOCK = [
  'BEGIN:VTIMEZONE',
  `TZID:${ICS_TIMEZONE_ID}`,
  'X-LIC-LOCATION:Europe/Amsterdam',
  'BEGIN:DAYLIGHT',
  'TZOFFSETFROM:+0100',
  'TZOFFSETTO:+0200',
  'TZNAME:CEST',
  'DTSTART:19700329T020000',
  'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU',
  'END:DAYLIGHT',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'TZNAME:CET',
  'DTSTART:19701025T030000',
  'RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU',
  'END:STANDARD',
  'END:VTIMEZONE',
];

const normalizeToken = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .trim();

const pad = (value: number) => value.toString().padStart(2, '0');

const createUtcDate = (year: number, monthIndex: number, day: number) =>
  new Date(Date.UTC(year, monthIndex, day));

const addUtcDays = (date: Date, days: number) => {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const compareUtcDates = (left: Date, right: Date) => left.getTime() - right.getTime();
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const compareResolvedDays = (left: ResolvedRosterDay, right: ResolvedRosterDay) => {
  if (left.year !== right.year) return left.year - right.year;
  if (left.month !== right.month) return left.month - right.month;
  return left.day - right.day;
};

const toResolvedRosterDay = (date: Date): ResolvedRosterDay => ({
  year: date.getUTCFullYear(),
  month: date.getUTCMonth() + 1,
  day: date.getUTCDate(),
});

const getDiffInDays = (left: Date, right: Date) =>
  Math.round(Math.abs(left.getTime() - right.getTime()) / MS_PER_DAY);

const getUtcDayDiff = (left: Date, right: Date) =>
  Math.round((left.getTime() - right.getTime()) / MS_PER_DAY);

const toIsoWeekday = (weekdayIndex: number) => (weekdayIndex === 0 ? 7 : weekdayIndex);

const getExpectedGapInDays = (previousWeekdayIndex: number, nextWeekdayIndex: number) => {
  const previousIsoWeekday = toIsoWeekday(previousWeekdayIndex);
  const nextIsoWeekday = toIsoWeekday(nextWeekdayIndex);
  return nextIsoWeekday >= previousIsoWeekday
    ? nextIsoWeekday - previousIsoWeekday
    : 7 - previousIsoWeekday + nextIsoWeekday;
};

const toDateStamp = (value: ResolvedRosterDay) =>
  `${value.year}${pad(value.month)}${pad(value.day)}`;

const toLocalDateTimeStamp = (value: CalendarDateTime) =>
  `${toDateStamp(value)}T${pad(value.hour)}${pad(value.minute)}00`;

const toUtcDateTimeStamp = (value: Date) =>
  `${value.getUTCFullYear()}${pad(value.getUTCMonth() + 1)}${pad(value.getUTCDate())}T${pad(value.getUTCHours())}${pad(value.getUTCMinutes())}${pad(value.getUTCSeconds())}Z`;

const escapeIcsText = (value: string) =>
  value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

const foldIcsLine = (line: string) => {
  const encoder = new TextEncoder();
  let folded = '';
  let currentLine = '';

  for (const char of line) {
    const nextLine = currentLine + char;
    if (currentLine && encoder.encode(nextLine).length > 75) {
      folded += `${currentLine}\r\n `;
      currentLine = char;
    } else {
      currentLine = nextLine;
    }
  }

  return `${folded}${currentLine}`;
};

const parseMonthIndex = (monthName: string) => {
  const normalizedMonth = normalizeToken(monthName);
  const monthIndex = MONTH_INDEX_BY_NAME[normalizedMonth];
  if (monthIndex === undefined) {
    throw new Error(`Onbekende maand in daglabel: "${monthName}".`);
  }
  return monthIndex;
};

const parseWeekdayIndex = (weekdayName: string) => {
  const normalizedWeekday = normalizeToken(weekdayName);
  const weekdayIndex = WEEKDAY_INDEX_BY_NAME[normalizedWeekday];
  if (weekdayIndex === undefined) {
    throw new Error(`Onbekende weekdag in daglabel: "${weekdayName}".`);
  }
  return weekdayIndex;
};

const parseRosterDayLabel = (label: string): ParsedDayLabel => {
  const trimmedLabel = label.trim();
  const labelMatch = trimmedLabel.match(/^\[([^\]]+)\]\s*(.+?)\s*\[([^\]]+)\]\s*$/);

  if (!labelMatch) {
    throw new Error(`Kan daglabel niet omzetten naar kalenderdatum: "${label}".`);
  }

  const weekToken = labelMatch[1].trim();
  const numericWeek = parseInt(weekToken, 10);
  const weekNumber = /^\d+$/.test(weekToken) && !Number.isNaN(numericWeek)
    ? numericWeek
    : null;
  const rangePart = labelMatch[2].trim();
  const weekdayPart = labelMatch[3]
    .replace(/\s*-\s*(?:OFFICE CLOSED|GESLOTEN)\s*$/i, '')
    .trim();

  const rangeMatch = rangePart.match(
    /^(\d{1,2})(?:\s+([A-Za-z.]+))?\s*-\s*(\d{1,2})\s+([A-Za-z.]+)$/
  );

  if (!rangeMatch) {
    throw new Error(`Kan datumrange niet lezen voor agenda-export: "${label}".`);
  }

  const startDay = parseInt(rangeMatch[1], 10);
  const explicitStartMonth = rangeMatch[2];
  const endDay = parseInt(rangeMatch[3], 10);
  const endMonthIndex = parseMonthIndex(rangeMatch[4]);
  const startMonthIndex = explicitStartMonth
    ? parseMonthIndex(explicitStartMonth)
    : startDay > endDay
      ? (endMonthIndex + 11) % 12
      : endMonthIndex;

  return {
    weekToken,
    weekNumber,
    originalLabel: label,
    weekdayIndex: parseWeekdayIndex(weekdayPart),
    startDay,
    startMonthIndex,
    endDay,
    endMonthIndex,
  };
};

const getIsoWeekInfo = (date: Date) => {
  const workingDate = createUtcDate(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  );
  const isoWeekday = workingDate.getUTCDay() === 0 ? 7 : workingDate.getUTCDay();
  workingDate.setUTCDate(workingDate.getUTCDate() + 4 - isoWeekday);

  const isoWeekYear = workingDate.getUTCFullYear();
  const yearStart = createUtcDate(isoWeekYear, 0, 1);
  const weekNumber = Math.ceil((((workingDate.getTime() - yearStart.getTime()) / MS_PER_DAY) + 1) / 7);

  return {
    isoWeekYear,
    isoWeekNumber: weekNumber,
  };
};

const resolveIsoWeekDate = (
  isoWeekYear: number,
  isoWeekNumber: number,
  weekdayIndex: number
) => {
  const januaryFourth = createUtcDate(isoWeekYear, 0, 4);
  const januaryFourthIsoWeekday = januaryFourth.getUTCDay() === 0 ? 7 : januaryFourth.getUTCDay();
  const weekOneMonday = addUtcDays(januaryFourth, 1 - januaryFourthIsoWeekday);
  const targetIsoWeekday = weekdayIndex === 0 ? 7 : weekdayIndex;
  const resolvedDate = addUtcDays(weekOneMonday, (isoWeekNumber - 1) * 7 + (targetIsoWeekday - 1));
  const resolvedWeekInfo = getIsoWeekInfo(resolvedDate);

  if (
    resolvedWeekInfo.isoWeekYear !== isoWeekYear ||
    resolvedWeekInfo.isoWeekNumber !== isoWeekNumber
  ) {
    return null;
  }

  return resolvedDate;
};

const buildRangeStrategyDates = (
  parsedLabels: ParsedDayLabel[],
  rosterYear: number,
  previousDate: Date | null
) => {
  const resolvedDates: Date[] = [];
  let localPreviousDate = previousDate;

  for (const parsedLabel of parsedLabels) {
    const resolvedDate = resolveParsedDayLabel(parsedLabel, rosterYear, localPreviousDate);
    resolvedDates.push(resolvedDate);
    localPreviousDate = resolvedDate;
  }

  return resolvedDates;
};

const scoreResolvedGroupDates = (
  parsedLabels: ParsedDayLabel[],
  resolvedDates: Date[],
  anchorDate: Date,
  previousDate: Date | null
) => {
  if (parsedLabels.length !== resolvedDates.length || resolvedDates.length === 0) {
    return Number.POSITIVE_INFINITY;
  }

  let score = getDiffInDays(resolvedDates[0], anchorDate) * 10;

  if (previousDate && resolvedDates[0].getTime() <= previousDate.getTime()) {
    score += 10_000;
  }

  for (let index = 1; index < resolvedDates.length; index += 1) {
    const actualGap = getUtcDayDiff(resolvedDates[index], resolvedDates[index - 1]);
    const expectedGap = getExpectedGapInDays(
      parsedLabels[index - 1].weekdayIndex,
      parsedLabels[index].weekdayIndex
    );

    if (actualGap <= 0) {
      score += 10_000;
      continue;
    }

    score += Math.abs(actualGap - expectedGap) * 1_000;
  }

  return score;
};

const buildIsoStrategyDates = (
  parsedLabels: ParsedDayLabel[],
  isoWeekYear: number
) => {
  const firstWeekNumber = parsedLabels[0]?.weekNumber;

  if (firstWeekNumber === null || firstWeekNumber === undefined) {
    return null;
  }

  const resolvedDates: Date[] = [];

  for (const parsedLabel of parsedLabels) {
    if (parsedLabel.weekNumber !== firstWeekNumber) {
      return null;
    }

    const isoDate = resolveIsoWeekDate(
      isoWeekYear,
      firstWeekNumber,
      parsedLabel.weekdayIndex
    );

    if (!isoDate) {
      return null;
    }

    resolvedDates.push(isoDate);
  }

  return resolvedDates;
};

const chooseBestStrategyForGroup = (
  parsedLabels: ParsedDayLabel[],
  rosterYear: number,
  previousDate: Date | null,
  previousWeekNumber: number | null,
  previousWeekYear: number | null
) => {
  const anchorDates = buildRangeStrategyDates(parsedLabels.slice(0, 1), rosterYear, previousDate);
  const anchorDate = anchorDates[0];
  const rangeDates = buildRangeStrategyDates(parsedLabels, rosterYear, previousDate);
  const rangeScore = scoreResolvedGroupDates(parsedLabels, rangeDates, anchorDate, previousDate);

  const firstWeekNumber = parsedLabels[0]?.weekNumber;

  if (firstWeekNumber === null || firstWeekNumber === undefined) {
    return {
      resolvedDates: rangeDates,
      resolvedWeekYear: null,
    };
  }

  const candidateYears = new Set<number>([
    rosterYear - 1,
    rosterYear,
    rosterYear + 1,
    rosterYear + 2,
  ]);

  if (previousWeekYear !== null) {
    candidateYears.add(previousWeekYear - 1);
    candidateYears.add(previousWeekYear);
    candidateYears.add(previousWeekYear + 1);
  }

  let bestIsoMatch: { isoWeekYear: number; score: number; dates: Date[] } | null = null;

  for (const isoWeekYear of candidateYears) {
    const isoDates = buildIsoStrategyDates(parsedLabels, isoWeekYear);
    if (!isoDates) continue;

    let score = scoreResolvedGroupDates(parsedLabels, isoDates, anchorDate, previousDate);

    if (previousWeekYear !== null) {
      const expectedWeekYear =
        previousWeekNumber !== null && firstWeekNumber < previousWeekNumber
          ? previousWeekYear + 1
          : previousWeekYear;
      score += Math.abs(isoWeekYear - expectedWeekYear) * 100;
    } else {
      score += Math.abs(isoWeekYear - rosterYear) * 10;
    }

    if (!bestIsoMatch || score < bestIsoMatch.score) {
      bestIsoMatch = { isoWeekYear, score, dates: isoDates };
    }
  }

  if (!bestIsoMatch || bestIsoMatch.score > rangeScore) {
    return {
      resolvedDates: rangeDates,
      resolvedWeekYear: null,
    };
  }

  return {
    resolvedDates: bestIsoMatch.dates,
    resolvedWeekYear: bestIsoMatch.isoWeekYear,
  };
};

const resolveParsedDayLabel = (
  parsedLabel: ParsedDayLabel,
  rosterYear: number,
  previousDate: Date | null
) => {
  const candidates: Date[] = [];

  for (let startYear = rosterYear - 1; startYear <= rosterYear + 3; startYear += 1) {
    const endYear =
      startYear + (parsedLabel.endMonthIndex < parsedLabel.startMonthIndex ? 1 : 0);
    const startDate = createUtcDate(startYear, parsedLabel.startMonthIndex, parsedLabel.startDay);
    const endDate = createUtcDate(endYear, parsedLabel.endMonthIndex, parsedLabel.endDay);

    if (compareUtcDates(endDate, startDate) < 0) {
      continue;
    }

    for (
      let currentDate = startDate;
      compareUtcDates(currentDate, endDate) <= 0;
      currentDate = addUtcDays(currentDate, 1)
    ) {
      if (currentDate.getUTCDay() === parsedLabel.weekdayIndex) {
        candidates.push(currentDate);
      }
    }
  }

  candidates.sort(compareUtcDates);

  const minimumDate = previousDate ?? createUtcDate(rosterYear, 0, 1);
  const resolvedDate = candidates.find(candidate =>
    previousDate
      ? candidate.getTime() > previousDate.getTime()
      : candidate.getTime() >= minimumDate.getTime()
  );

  if (!resolvedDate) {
    throw new Error(
      `Kan geen kalenderdatum afleiden uit daglabel "${parsedLabel.originalLabel}".`
    );
  }

  return resolvedDate;
};

const getShiftKind = (shift: AssignedShift): ShiftKind => {
  if (shift.isWebRevision) return 'revision';
  if (shift.isWeb) return 'web';
  return 'normal';
};

const getShiftLabel = (shift: AssignedShift) => {
  if (shift.isWebRevision) return 'Web Revision';
  if (shift.isWeb) return 'Web';
  return 'Normal';
};

const getShiftTimeRange = (shift: AssignedShift) =>
  shift.type === 'Morning'
    ? {
        startHour: 9,
        startMinute: 0,
        endHour: 13,
        endMinute: 0,
        label: '09:00-13:00',
      }
    : {
        startHour: 13,
        startMinute: 0,
        endHour: 17,
        endMinute: 0,
        label: '13:00-17:00',
      };

const getSummaryForShiftKinds = (kinds: ShiftKind[]) => {
  const uniqueKinds = [...new Set(kinds)];

  if (uniqueKinds.length === 1) {
    switch (uniqueKinds[0]) {
      case 'web':
        return 'Werkdienst (Web)';
      case 'revision':
        return 'Werkdienst (Web Revision)';
      default:
        return 'Werkdienst';
    }
  }

  return 'Werkdienst (Gemengd)';
};

const buildEventUid = (
  employeeName: string,
  start: CalendarDateTime,
  end: CalendarDateTime
) => {
  const employeeSlug =
    normalizeToken(employeeName)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'employee';

  return `${employeeSlug}-${toDateStamp(start)}-${pad(start.hour)}${pad(start.minute)}-${pad(end.hour)}${pad(end.minute)}@shiftplanner.local`;
};

export const sanitizeCalendarFileName = (employeeName: string) => {
  const sanitizedName = employeeName
    .trim()
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\.+$/g, '')
    .trim();

  return sanitizedName || 'werknemer';
};

export const buildRosterDayMap = (days: string[], rosterYear: number) => {
  const dayMap: Record<string, ResolvedRosterDay> = {};
  const parsedLabels = days.map(dayLabel => ({
    dayLabel,
    parsedLabel: parseRosterDayLabel(dayLabel),
  }));
  let previousDate: Date | null = null;
  let previousWeekNumber: number | null = null;
  let previousWeekYear: number | null = null;
  let currentIndex = 0;

  while (currentIndex < parsedLabels.length) {
    const currentWeekToken = parsedLabels[currentIndex].parsedLabel.weekToken;
    const groupStartIndex = currentIndex;

    while (
      currentIndex < parsedLabels.length &&
      parsedLabels[currentIndex].parsedLabel.weekToken === currentWeekToken
    ) {
      currentIndex += 1;
    }

    const group = parsedLabels.slice(groupStartIndex, currentIndex);
    const { resolvedDates, resolvedWeekYear } = chooseBestStrategyForGroup(
      group.map(entry => entry.parsedLabel),
      rosterYear,
      previousDate,
      previousWeekNumber,
      previousWeekYear
    );

    group.forEach((entry, index) => {
      const resolvedDate = resolvedDates[index];
      dayMap[entry.dayLabel] = toResolvedRosterDay(resolvedDate);
      previousDate = resolvedDate;
    });

    if (resolvedWeekYear !== null && group[0].parsedLabel.weekNumber !== null) {
      previousWeekYear = resolvedWeekYear;
      previousWeekNumber = group[0].parsedLabel.weekNumber;
    } else {
      previousWeekYear = null;
      previousWeekNumber = null;
    }
  }

  return dayMap;
};

export const buildEmployeeCalendarEvents = (
  employeeName: string,
  shifts: AssignedShift[],
  dayMap: Record<string, ResolvedRosterDay>
): EmployeeCalendarEvent[] => {
  const groupedShifts = new Map<string, AssignedShift[]>();

  for (const shift of shifts) {
    const dayShifts = groupedShifts.get(shift.day) ?? [];
    dayShifts.push(shift);
    groupedShifts.set(shift.day, dayShifts);
  }

  return [...groupedShifts.entries()]
    .sort(([leftDay], [rightDay]) => {
      const leftDate = dayMap[leftDay];
      const rightDate = dayMap[rightDay];
      if (!leftDate || !rightDate) {
        throw new Error(`Geen kalenderdatum gevonden voor daglabel "${!leftDate ? leftDay : rightDay}".`);
      }
      return compareResolvedDays(leftDate, rightDate);
    })
    .map(([dayLabel, shiftsOnDay]) => {
      const resolvedDay = dayMap[dayLabel];
      if (!resolvedDay) {
        throw new Error(`Geen kalenderdatum gevonden voor daglabel "${dayLabel}".`);
      }

      const orderedShifts = [...shiftsOnDay].sort((leftShift, rightShift) =>
        leftShift.type === rightShift.type ? 0 : leftShift.type === 'Morning' ? -1 : 1
      );
      const shiftKinds = orderedShifts.map(getShiftKind);
      const summary = getSummaryForShiftKinds(shiftKinds);
      const isFullDay = orderedShifts.length > 1;
      const start = isFullDay
        ? { ...resolvedDay, hour: 9, minute: 0 }
        : { ...resolvedDay, hour: getShiftTimeRange(orderedShifts[0]).startHour, minute: 0 };
      const end = isFullDay
        ? { ...resolvedDay, hour: 17, minute: 0 }
        : { ...resolvedDay, hour: getShiftTimeRange(orderedShifts[0]).endHour, minute: 0 };
      const description = [
        `Werknemer: ${employeeName}`,
        `Dag: ${dayLabel}`,
        'Diensten:',
        ...orderedShifts.map(shift => {
          const timeRange = getShiftTimeRange(shift);
          return `${timeRange.label} ${getShiftLabel(shift)}`;
        }),
      ].join('\n');

      return {
        dayLabel,
        start,
        end,
        summary,
        description,
        uid: buildEventUid(employeeName, start, end),
      };
    });
};

export const serializeEmployeeCalendar = (
  employeeName: string,
  events: EmployeeCalendarEvent[],
  options: BuildCalendarZipOptions = {}
) => {
  const generatedAt = options.generatedAt ?? new Date();
  const calendarLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${ICS_PRODUCT_ID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(`ShiftPlanner - ${employeeName}`)}`,
    `X-WR-TIMEZONE:${ICS_TIMEZONE_ID}`,
    ...AMSTERDAM_TIMEZONE_BLOCK,
  ];

  for (const event of events) {
    calendarLines.push(
      'BEGIN:VEVENT',
      `UID:${event.uid}`,
      `DTSTAMP:${toUtcDateTimeStamp(generatedAt)}`,
      `SUMMARY:${escapeIcsText(event.summary)}`,
      `DESCRIPTION:${escapeIcsText(event.description)}`,
      `DTSTART;TZID=${ICS_TIMEZONE_ID}:${toLocalDateTimeStamp(event.start)}`,
      `DTEND;TZID=${ICS_TIMEZONE_ID}:${toLocalDateTimeStamp(event.end)}`,
      'STATUS:CONFIRMED',
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }

  calendarLines.push('END:VCALENDAR');

  return `${calendarLines.map(foldIcsLine).join('\r\n')}\r\n`;
};

export const buildCalendarZip = (
  data: ParsedData,
  schedule: ScheduleResult,
  options: BuildCalendarZipOptions = {}
) => {
  if (!data.rosterYear) {
    throw new Error('Kies eerst een roosterjaar voor agenda-export.');
  }

  const dayMap = buildRosterDayMap(data.days, data.rosterYear);
  const zip = new JSZip();
  const calendarFolder = zip.folder('kalenders');

  if (!calendarFolder) {
    throw new Error('Kon de ZIP-map voor agenda-export niet aanmaken.');
  }

  for (const employee of data.employees) {
    const employeeShifts = schedule.employeeSchedules[employee.name] ?? [];
    const employeeEvents = buildEmployeeCalendarEvents(
      employee.name,
      employeeShifts,
      dayMap
    );
    const calendarContent = serializeEmployeeCalendar(
      employee.name,
      employeeEvents,
      options
    );
    calendarFolder.file(
      `${sanitizeCalendarFileName(employee.name)}.ics`,
      calendarContent
    );
  }

  return {
    filename: `shiftplanner-calendars-${data.rosterYear}.zip`,
    zip,
  };
};
