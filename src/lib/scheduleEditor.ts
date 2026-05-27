import {
  normalizeParsedData,
  type ParsedData,
  type EmployeeData,
} from './parser';
import {
  buildScheduleResultFromAssignments,
  createEmptyUnfilledCounts,
  getAvailableHoursForWeek,
  getMaxHours,
  getPreferredHours,
  getWeekId,
  getWeekOrder,
  HOURS_PER_SHIFT,
  isAvailable,
  type AssignedShift,
  type PlannerMode,
  type ScheduleResult,
  type ShiftType,
} from './scheduler';

export type ShiftSlotKind = 'normal' | 'web' | 'revision';
export type ScheduleWarningCode = 'unavailable' | 'over-preferred' | 'over-max';

export interface EditableShiftSlot {
  id: string;
  day: string;
  weekId: string;
  type: ShiftType;
  kind: ShiftSlotKind;
  employeeName: string | null;
  initialEmployeeName: string | null;
}

export interface ScheduleEditWarning {
  id: string;
  slotId: string | null;
  scope: 'slot' | 'employee-week';
  employeeName: string;
  day: string;
  weekId: string;
  type: ShiftType;
  kind: ShiftSlotKind;
  code: ScheduleWarningCode;
  severity: 'warning';
  message: string;
}

export interface EmployeeWeekHoursSummary {
  weekId: string;
  assignedHours: number;
  preferredHours: number;
  maxHours: number;
  baselineHours: number;
  baselineDeltaHours: number;
}

export interface EmployeeHoursSummary {
  employeeName: string;
  assignedHours: number;
  preferredHours: number;
  preferredDeltaHours: number;
  preferredDeltaShifts: number;
  maxHours: number;
  maxDeltaHours: number;
  weekly: EmployeeWeekHoursSummary[];
}

export interface WeeklyShiftShortfallNotice {
  weekId: string;
  employeeName: string;
  assignedHours: number;
  targetHours: number;
  assignedShifts: number;
  targetShifts: number;
  shortfallHours: number;
  message: string;
}

export interface QualifiedSlotEmployees {
  available: EmployeeData[];
  unavailable: EmployeeData[];
}

export interface SavedRosterSnapshot {
  version: number;
  data: ParsedData;
  generatedSchedule: ScheduleResult;
  schedule: ScheduleResult;
  savedAt: string;
}

interface AddEditableShiftSlotInput {
  day: string;
  type: ShiftType;
  kind: ShiftSlotKind;
}

const SLOT_KIND_ORDER: ShiftSlotKind[] = ['normal', 'web', 'revision'];

export const SAVED_ROSTER_VERSION = 1;
export const SAVED_ROSTER_STORAGE_KEY = 'shiftplanner.saved-roster.v1';

const getSlotCount = (schedule: ScheduleResult, day: string, type: ShiftType, kind: ShiftSlotKind) => {
  const assigned = Object.values(schedule.employeeSchedules).flatMap(shifts =>
    shifts.filter(shift => {
      if (shift.day !== day || shift.type !== type) return false;
      if (kind === 'normal') return !shift.isWeb && !shift.isWebRevision;
      if (kind === 'web') return shift.isWeb;
      return !!shift.isWebRevision;
    })
  ).length;

  const open =
    kind === 'normal'
      ? schedule.unfilledNormalShifts[day]?.[type === 'Morning' ? 'morning' : 'afternoon'] ?? 0
      : kind === 'web'
        ? schedule.unfilledWebShifts[day]?.[type === 'Morning' ? 'morning' : 'afternoon'] ?? 0
        : schedule.unfilledWebRevisionShifts[day]?.[type === 'Morning' ? 'morning' : 'afternoon'] ?? 0;

  return assigned + open;
};

const getAssignedNamesForSlot = (
  data: ParsedData,
  schedule: ScheduleResult,
  day: string,
  type: ShiftType,
  kind: ShiftSlotKind
) =>
  data.employees
    .filter(employee =>
      schedule.employeeSchedules[employee.name].some(shift => {
        if (shift.day !== day || shift.type !== type) return false;
        if (kind === 'normal') return !shift.isWeb && !shift.isWebRevision;
        if (kind === 'web') return shift.isWeb;
        return !!shift.isWebRevision;
      })
    )
    .map(employee => employee.name);

export const buildEditableShiftSlots = (
  data: ParsedData,
  schedule: ScheduleResult
): EditableShiftSlot[] => {
  const slots: EditableShiftSlot[] = [];

  for (const day of data.days) {
    const weekId = getWeekId(day);

    for (const type of ['Morning', 'Afternoon'] as ShiftType[]) {
      for (const kind of SLOT_KIND_ORDER) {
        const assignedNames = getAssignedNamesForSlot(data, schedule, day, type, kind);
        const totalSlots = getSlotCount(schedule, day, type, kind);

        for (let index = 0; index < totalSlots; index++) {
          const employeeName = assignedNames[index] ?? null;
          slots.push({
            id: `${day}::${type}::${kind}::${index}`,
            day,
            weekId,
            type,
            kind,
            employeeName,
            initialEmployeeName: employeeName,
          });
        }
      }
    }
  }

  return slots;
};

export const hasEditableChanges = (
  baseSlots: EditableShiftSlot[],
  draftSlots: EditableShiftSlot[]
) => {
  if (baseSlots.length !== draftSlots.length) return true;

  for (let index = 0; index < baseSlots.length; index++) {
    if (
      baseSlots[index].id !== draftSlots[index].id ||
      baseSlots[index].employeeName !== draftSlots[index].employeeName
    ) {
      return true;
    }
  }

  return false;
};

export const applyEmployeeSelection = (
  slots: EditableShiftSlot[],
  slotId: string,
  employeeName: string | null
) => {
  const nextSlots = slots.map(slot => ({ ...slot }));
  const targetSlot = nextSlots.find(slot => slot.id === slotId);

  if (!targetSlot) {
    return slots;
  }

  if (targetSlot.employeeName === employeeName) {
    return nextSlots;
  }

  if (employeeName) {
    for (const slot of nextSlots) {
      if (slot.id === slotId || slot.employeeName !== employeeName) continue;

      const sameTimeConflict = slot.day === targetSlot.day && slot.type === targetSlot.type;
      const sameDaySpecialConflict =
        targetSlot.kind !== 'normal' && slot.day === targetSlot.day && slot.kind !== 'normal';

      if (sameTimeConflict || sameDaySpecialConflict) {
        slot.employeeName = null;
      }
    }
  }

  targetSlot.employeeName = employeeName;
  return nextSlots;
};

const createExtraSlotId = (
  slots: EditableShiftSlot[],
  day: string,
  type: ShiftType,
  kind: ShiftSlotKind
) => {
  const prefix = `${day}::${type}::${kind}::extra-`;
  let index = slots.filter(slot => slot.id.startsWith(prefix)).length;

  while (slots.some(slot => slot.id === `${prefix}${index}`)) {
    index++;
  }

  return `${prefix}${index}`;
};

export const addEditableShiftSlot = (
  slots: EditableShiftSlot[],
  { day, type, kind }: AddEditableShiftSlotInput
) => {
  const weekId = getWeekId(day);

  return [
    ...slots,
    {
      id: createExtraSlotId(slots, day, type, kind),
      day,
      weekId,
      type,
      kind,
      employeeName: null,
      initialEmployeeName: null,
    },
  ];
};

export const removeEditableShiftSlot = (
  slots: EditableShiftSlot[],
  slotId: string
) => slots.filter(slot => slot.id !== slotId);

const getSlotKey = (slot: Pick<EditableShiftSlot, 'day' | 'type' | 'kind'>) =>
  `${slot.day}::${slot.type}::${slot.kind}`;

export const getExtraEditableSlotIds = (
  slots: EditableShiftSlot[],
  baselineSlots: EditableShiftSlot[],
  kind: ShiftSlotKind = 'web'
) => {
  const currentGroups = new Map<string, EditableShiftSlot[]>();
  const baselineCounts = new Map<string, number>();

  for (const slot of slots) {
    if (slot.kind !== kind) continue;
    const key = getSlotKey(slot);
    const group = currentGroups.get(key) ?? [];
    group.push(slot);
    currentGroups.set(key, group);
  }

  for (const slot of baselineSlots) {
    if (slot.kind !== kind) continue;
    const key = getSlotKey(slot);
    baselineCounts.set(key, (baselineCounts.get(key) ?? 0) + 1);
  }

  const extraIds = new Set<string>();

  for (const [key, group] of currentGroups.entries()) {
    const baselineCount = baselineCounts.get(key) ?? 0;
    const extraCount = Math.max(0, group.length - baselineCount);

    if (extraCount === 0) continue;

    for (const slot of group.slice(-extraCount)) {
      extraIds.add(slot.id);
    }
  }

  return extraIds;
};

export const getEmployeeWeekWarningsForSlot = (
  warnings: ScheduleEditWarning[],
  slot: EditableShiftSlot
) => {
  if (!slot.employeeName) {
    return [];
  }

  return warnings.filter(
    warning =>
      warning.scope === 'employee-week' &&
      warning.employeeName === slot.employeeName &&
      warning.weekId === slot.weekId
  );
};

export const buildEditableScheduleResult = (
  data: ParsedData,
  slots: EditableShiftSlot[],
  plannerMode: PlannerMode = 'fairness'
) => {
  const employeeSchedules: Record<string, AssignedShift[]> = Object.fromEntries(
    data.employees.map(employee => [employee.name, []])
  );
  const unfilledCounts = createEmptyUnfilledCounts(data.days);

  for (const slot of slots) {
    const part = slot.type === 'Morning' ? 'morning' : 'afternoon';

    if (!slot.employeeName) {
      if (slot.kind === 'normal') unfilledCounts.normal[slot.day][part]++;
      if (slot.kind === 'web') unfilledCounts.web[slot.day][part]++;
      if (slot.kind === 'revision') unfilledCounts.revision[slot.day][part]++;
      continue;
    }

    employeeSchedules[slot.employeeName].push({
      day: slot.day,
      type: slot.type,
      isWeb: slot.kind === 'web',
      isWebRevision: slot.kind === 'revision',
    });
  }

  return buildScheduleResultFromAssignments(data, employeeSchedules, unfilledCounts, plannerMode);
};

const createWarning = (
  slot: EditableShiftSlot | null,
  scope: ScheduleEditWarning['scope'],
  employeeName: string,
  day: string,
  weekId: string,
  type: ShiftType,
  kind: ShiftSlotKind,
  code: ScheduleWarningCode,
  message: string
): ScheduleEditWarning => ({
  id: `${scope}::${employeeName}::${weekId}::${day}::${type}::${kind}::${code}`,
  slotId: slot?.id ?? null,
  scope,
  employeeName,
  day,
  weekId,
  type,
  kind,
  code,
  severity: 'warning',
  message,
});

const formatWeekLabel = (weekId: string) =>
  weekId === 'default' ? 'the default week' : `week ${weekId}`;

export const buildScheduleEditWarnings = (
  data: ParsedData,
  slots: EditableShiftSlot[],
  schedule: ScheduleResult
) => {
  const employeeByName = Object.fromEntries(
    data.employees.map(employee => [employee.name, employee])
  ) as Record<string, EmployeeData>;
  const warnings: ScheduleEditWarning[] = [];
  const overPreferredWeeks = new Set<string>();

  for (const slot of slots) {
    if (!slot.employeeName) continue;

    const employee = employeeByName[slot.employeeName];
    if (!employee) continue;

    if (!isAvailable(employee, slot.day, slot.type, data.closedDays)) {
      warnings.push(
        createWarning(
          slot,
          'slot',
          employee.name,
          slot.day,
          slot.weekId,
          slot.type,
          slot.kind,
          'unavailable',
          `${employee.name} is not available for ${slot.day} (${slot.type.toLowerCase()}).`
        )
      );
    }

    const weeklyAssignedHours = schedule.stats[employee.name].weeklyAssignedHours[slot.weekId] ?? 0;
    const preferredHours = getPreferredHours(employee, slot.weekId, data.days, data.closedDays);
    const maxHours = getMaxHours(employee, slot.weekId);
    const totalMaxHours = schedule.stats[employee.name].totalMaxHours;

    const overPreferredKey = `${employee.name}::${slot.weekId}`;

    if (weeklyAssignedHours > preferredHours && !overPreferredWeeks.has(overPreferredKey)) {
      const overflow = weeklyAssignedHours - preferredHours;
      overPreferredWeeks.add(overPreferredKey);
      warnings.push(
        createWarning(
          null,
          'employee-week',
          employee.name,
          slot.day,
          slot.weekId,
          slot.type,
          slot.kind,
          'over-preferred',
          `${employee.name} is ${overflow}h above preferred hours in ${formatWeekLabel(slot.weekId)}.`
        )
      );
    }

    if (weeklyAssignedHours > maxHours || schedule.stats[employee.name].totalAssignedHours > totalMaxHours) {
      const overflow = Math.max(
        weeklyAssignedHours - maxHours,
        schedule.stats[employee.name].totalAssignedHours - totalMaxHours
      );
      warnings.push(
        createWarning(
          slot,
          'slot',
          employee.name,
          slot.day,
          slot.weekId,
          slot.type,
          slot.kind,
          'over-max',
          `${employee.name} is ${overflow}h above max hours.`
        )
      );
    }
  }

  return warnings;
};

export const buildEmployeeHoursSummaries = (
  data: ParsedData,
  schedule: ScheduleResult
) => {
  const weekOrder = getWeekOrder(data.days);

  return data.employees.map(employee => {
    const assignedHours = schedule.stats[employee.name].totalAssignedHours;
    const preferredHours = schedule.stats[employee.name].totalPreferredHours;
    const maxHours = schedule.stats[employee.name].totalMaxHours;

    const weekly = weekOrder.map(weekId => {
      const assignedWeekHours = schedule.stats[employee.name].weeklyAssignedHours[weekId] ?? 0;
      const preferredWeekHours = getPreferredHours(employee, weekId, data.days, data.closedDays);
      const maxWeekHours = getMaxHours(employee, weekId);
      const availableHours = getAvailableHoursForWeek(employee, weekId, data.days, data.closedDays);
      const effectiveCapacity = Math.min(maxWeekHours, availableHours);
      const baselineHours = effectiveCapacity <= HOURS_PER_SHIFT ? HOURS_PER_SHIFT : 8;

      return {
        weekId,
        assignedHours: assignedWeekHours,
        preferredHours: preferredWeekHours,
        maxHours: maxWeekHours,
        baselineHours,
        baselineDeltaHours: assignedWeekHours - baselineHours,
      };
    });

    return {
      employeeName: employee.name,
      assignedHours,
      preferredHours,
      preferredDeltaHours: assignedHours - preferredHours,
      preferredDeltaShifts: (assignedHours - preferredHours) / HOURS_PER_SHIFT,
      maxHours,
      maxDeltaHours: assignedHours - maxHours,
      weekly,
    };
  });
};

export const buildWeeklyShiftShortfallNotices = (
  data: ParsedData,
  schedule: ScheduleResult
) => {
  const notices: WeeklyShiftShortfallNotice[] = [];

  for (const weekId of getWeekOrder(data.days)) {
    for (const employee of data.employees) {
      const assignedHours = schedule.stats[employee.name].weeklyAssignedHours[weekId] ?? 0;
      const availableHours = getAvailableHoursForWeek(employee, weekId, data.days, data.closedDays);
      const maxHours = getMaxHours(employee, weekId);
      const effectiveCapacity = Math.min(availableHours, maxHours);
      const targetHours =
        effectiveCapacity >= 8 ? 8 : effectiveCapacity >= HOURS_PER_SHIFT ? HOURS_PER_SHIFT : 0;

      if (targetHours === 0 || assignedHours >= targetHours) {
        continue;
      }

      const assignedShifts = assignedHours / HOURS_PER_SHIFT;
      const targetShifts = targetHours / HOURS_PER_SHIFT;

      notices.push({
        weekId,
        employeeName: employee.name,
        assignedHours,
        targetHours,
        assignedShifts,
        targetShifts,
        shortfallHours: targetHours - assignedHours,
        message:
          weekId === 'default'
            ? `${employee.name} has only gotten ${assignedShifts}/${targetShifts} shifts in the default week.`
            : `${employee.name} has only gotten ${assignedShifts}/${targetShifts} shifts in week ${weekId}.`,
      });
    }
  }

  return notices;
};

export const getQualifiedEmployeesForSlot = (
  data: ParsedData,
  slot: EditableShiftSlot
): QualifiedSlotEmployees => {
  const qualifiedEmployees = data.employees.filter(employee => {
    if (slot.kind === 'normal') return !employee.isWebOnly;
    if (slot.kind === 'web') return !!(employee.isWeb || employee.isWebOnly);
    return !!employee.isWebRevision;
  });

  return qualifiedEmployees.reduce<QualifiedSlotEmployees>(
    (result, employee) => {
      if (isAvailable(employee, slot.day, slot.type, data.closedDays)) {
        result.available.push(employee);
      } else {
        result.unavailable.push(employee);
      }
      return result;
    },
    { available: [], unavailable: [] }
  );
};

export const createSavedRosterSnapshot = (
  data: ParsedData,
  generatedSchedule: ScheduleResult,
  schedule: ScheduleResult,
  savedAt: string
): SavedRosterSnapshot => ({
  version: SAVED_ROSTER_VERSION,
  data,
  generatedSchedule,
  schedule,
  savedAt,
});

export const serializeSavedRosterSnapshot = (snapshot: SavedRosterSnapshot) =>
  JSON.stringify(snapshot);

const isParsedDataShape = (value: unknown): value is ParsedData => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ParsedData;
  return (
    Array.isArray(candidate.days) &&
    Array.isArray(candidate.closedDays) &&
    Array.isArray(candidate.employees) &&
    !!candidate.weeklyWebRequirements
  );
};

const isScheduleShape = (value: unknown): value is ScheduleResult => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as ScheduleResult;
  return (
    !!candidate.employeeSchedules &&
    !!candidate.unfilledNormalShifts &&
    !!candidate.unfilledWebShifts &&
    !!candidate.unfilledWebRevisionShifts &&
    !!candidate.stats
  );
};

const toUnfilledCounts = (schedule: ScheduleResult) => ({
  normal: schedule.unfilledNormalShifts,
  web: schedule.unfilledWebShifts,
  revision: schedule.unfilledWebRevisionShifts,
});

const normalizeScheduleResult = (
  data: ParsedData,
  schedule: ScheduleResult,
  fallbackMode: PlannerMode = schedule.plannerMode ?? 'fairness'
) => {
  if (schedule.plannerMode && schedule.fairnessReport) {
    return schedule;
  }

  return buildScheduleResultFromAssignments(
    data,
    schedule.employeeSchedules,
    toUnfilledCounts(schedule),
    fallbackMode
  );
};

export const deserializeSavedRosterSnapshot = (raw: string | null): SavedRosterSnapshot | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<SavedRosterSnapshot>;

    if (
      parsed.version !== SAVED_ROSTER_VERSION ||
      typeof parsed.savedAt !== 'string' ||
      !isParsedDataShape(parsed.data) ||
      !isScheduleShape(parsed.schedule)
    ) {
      return null;
    }

    const data = normalizeParsedData(parsed.data);
    const generatedScheduleCandidate = isScheduleShape(parsed.generatedSchedule)
      ? parsed.generatedSchedule
      : parsed.schedule;
    const generatedSchedule = normalizeScheduleResult(
      data,
      generatedScheduleCandidate,
      generatedScheduleCandidate.plannerMode ?? 'fairness'
    );
    const schedule = normalizeScheduleResult(
      data,
      parsed.schedule,
      parsed.schedule.plannerMode ?? generatedSchedule.plannerMode
    );

    return {
      version: parsed.version,
      data,
      generatedSchedule,
      schedule,
      savedAt: parsed.savedAt,
    };
  } catch {
    return null;
  }
};
