import { ParsedData, EmployeeData } from './parser';

export type ShiftType = 'Morning' | 'Afternoon';

export interface AssignedShift {
  day: string;
  type: ShiftType;
  isWeb: boolean;
  isWebRevision?: boolean;
}

export interface ScheduleResult {
  employeeSchedules: Record<string, AssignedShift[]>;
  unfilledNormalShifts: Record<string, { morning: number; afternoon: number }>;
  unfilledWebShifts: Record<string, { morning: number; afternoon: number }>;
  unfilledWebRevisionShifts: Record<string, { morning: number; afternoon: number }>;
  stats: Record<string, {
    totalAssignedHours: number;
    totalPreferredHours: number;
    totalMaxHours: number;
    preferredHoursPerWeek: number;
    weeklyAssignedHours: Record<string, number>;
  }>;
}

const HOURS_PER_SHIFT = 4;
const NORMAL_SHIFT_CAPACITY = 2;
const WEEKLY_MINIMUM_TARGET = 8;
const DEFAULT_SCHEDULE_ITERATIONS = 520;

interface WeekTargets {
  preferred: number;
  minimum: number;
  max: number;
  availableHours: number;
}

interface PlanningTargets {
  weekOrder: string[];
  byEmployee: Record<string, Record<string, WeekTargets>>;
  cumulativePreferred: Record<string, Record<string, number>>;
  cumulativeMinimum: Record<string, Record<string, number>>;
}

interface PlannerContext {
  data: ParsedData;
  employees: EmployeeData[];
  schedule: Record<string, AssignedShift[]>;
  stats: ScheduleResult['stats'];
  activeDays: string[];
  planningTargets: PlanningTargets;
}

export function generateSchedule(data: ParsedData, iterations: number = DEFAULT_SCHEDULE_ITERATIONS): ScheduleResult {
  let bestSchedule: ScheduleResult | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < iterations; i++) {
    const currentSchedule = generateSingleSchedule(data);
    const currentScore = scoreSchedule(currentSchedule, data);

    if (currentScore > bestScore || !bestSchedule) {
      bestScore = currentScore;
      bestSchedule = currentSchedule;
    }
  }

  return bestSchedule!;
}

export const getWeekId = (day: string) => {
  const match = day.match(/^\[(.*?)\]/);
  return match ? match[1] : 'default';
};

export const getWeekOrder = (days: string[]) => {
  const order: string[] = [];
  const seen = new Set<string>();
  for (const day of days) {
    const weekId = getWeekId(day);
    if (!seen.has(weekId)) {
      seen.add(weekId);
      order.push(weekId);
    }
  }
  return order;
};

export const getFullDayPriority = (emp: EmployeeData) => {
  const val = emp.fullDayPriority;
  if (val === undefined || val === null) return 1;
  if (val > 5) return Math.max(1, Math.round(val / 20));
  if (val === 0) return 1;
  return val;
};

export const isAvailable = (emp: EmployeeData, day: string, shiftType: ShiftType, closedDays: string[]) => {
  if (closedDays.includes(day)) return false;
  const avail = emp.availability[day];
  if (!avail) return false;
  const trimmedAvail = avail.trim();
  if (trimmedAvail.includes('9:00-17:00')) return true;
  if (shiftType === 'Morning' && trimmedAvail.includes('9:00-13:00')) return true;
  if (shiftType === 'Afternoon' && trimmedAvail.includes('13:00-17:00')) return true;
  return false;
};

export const getAvailabilityCount = (emp: EmployeeData, weekId: string, days: string[], closedDays: string[]) => {
  const daysInWeek = days.filter(d => getWeekId(d) === weekId);
  let count = 0;
  for (const day of daysInWeek) {
    if (isAvailable(emp, day, 'Morning', closedDays)) count++;
    if (isAvailable(emp, day, 'Afternoon', closedDays)) count++;
  }
  return count;
};

export const getAvailableHoursForWeek = (emp: EmployeeData, weekId: string, days: string[], closedDays: string[]) => {
  return getAvailabilityCount(emp, weekId, days, closedDays) * HOURS_PER_SHIFT;
};

export const getMaxHours = (emp: EmployeeData, weekId: string) => {
  return emp.weeklyMaxHoursOverride[weekId] ?? emp.maxHours;
};

export const getPreferredHours = (emp: EmployeeData, weekId: string, days: string[], closedDays: string[]) => {
  const pref = emp.weeklyPreferredHoursOverride[weekId] ?? emp.preferredHours;
  const availableHours = getAvailableHoursForWeek(emp, weekId, days, closedDays);
  const max = getMaxHours(emp, weekId);
  return Math.min(pref, availableHours, max);
};

export const getMinimumHoursTarget = (emp: EmployeeData, weekId: string, days: string[], closedDays: string[]) => {
  const preferred = getPreferredHours(emp, weekId, days, closedDays);
  const availableHours = getAvailableHoursForWeek(emp, weekId, days, closedDays);
  const max = getMaxHours(emp, weekId);
  return Math.min(WEEKLY_MINIMUM_TARGET, preferred, availableHours, max);
};

const buildPlanningTargets = (data: ParsedData): PlanningTargets => {
  const weekOrder = getWeekOrder(data.days);
  const byEmployee: PlanningTargets['byEmployee'] = {};
  const cumulativePreferred: PlanningTargets['cumulativePreferred'] = {};
  const cumulativeMinimum: PlanningTargets['cumulativeMinimum'] = {};

  for (const emp of data.employees) {
    byEmployee[emp.name] = {};
    cumulativePreferred[emp.name] = {};
    cumulativeMinimum[emp.name] = {};

    let prefRunning = 0;
    let minRunning = 0;
    for (const weekId of weekOrder) {
      const preferred = getPreferredHours(emp, weekId, data.days, data.closedDays);
      const minimum = getMinimumHoursTarget(emp, weekId, data.days, data.closedDays);
      const max = getMaxHours(emp, weekId);
      const availableHours = getAvailableHoursForWeek(emp, weekId, data.days, data.closedDays);

      byEmployee[emp.name][weekId] = { preferred, minimum, max, availableHours };
      prefRunning += preferred;
      minRunning += minimum;
      cumulativePreferred[emp.name][weekId] = prefRunning;
      cumulativeMinimum[emp.name][weekId] = minRunning;
    }
  }

  return { weekOrder, byEmployee, cumulativePreferred, cumulativeMinimum };
};

const isWorking = (schedule: Record<string, AssignedShift[]>, empName: string, day: string, shiftType: ShiftType) => {
  return schedule[empName].some(s => s.day === day && s.type === shiftType);
};

const isWorkingOnDay = (schedule: Record<string, AssignedShift[]>, empName: string, day: string) => {
  return schedule[empName].some(s => s.day === day);
};

const getShiftForEmployee = (schedule: Record<string, AssignedShift[]>, empName: string, day: string, shiftType: ShiftType) => {
  return schedule[empName].find(s => s.day === day && s.type === shiftType);
};

const hasSpecialShiftOnDay = (schedule: Record<string, AssignedShift[]>, empName: string, day: string) => {
  return schedule[empName].some(s => s.day === day && (s.isWeb || s.isWebRevision));
};

const getSpecialShiftCountForEmployeeOnDay = (schedule: Record<string, AssignedShift[]>, empName: string, day: string) => {
  return schedule[empName].filter(s => s.day === day && (s.isWeb || s.isWebRevision)).length;
};

const getNormalShiftCount = (schedule: Record<string, AssignedShift[]>, day: string, shiftType: ShiftType) => {
  let count = 0;
  for (const empName in schedule) {
    if (schedule[empName].some(s => s.day === day && s.type === shiftType && !s.isWeb && !s.isWebRevision)) {
      count++;
    }
  }
  return count;
};

const getSpecialShiftCount = (
  schedule: Record<string, AssignedShift[]>,
  day: string,
  shiftType: ShiftType,
  kind: 'web' | 'revision'
) => {
  let count = 0;
  for (const empName in schedule) {
    if (schedule[empName].some(s => s.day === day && s.type === shiftType && (kind === 'web' ? s.isWeb : s.isWebRevision))) {
      count++;
    }
  }
  return count;
};

const getAssignedHoursUntilWeek = (
  stats: ScheduleResult['stats'],
  empName: string,
  weekOrder: string[],
  weekId: string
) => {
  let total = 0;
  for (const currentWeek of weekOrder) {
    total += stats[empName].weeklyAssignedHours[currentWeek] || 0;
    if (currentWeek === weekId) break;
  }
  return total;
};

const getRemainingNormalAvailabilityCount = (ctx: PlannerContext, emp: EmployeeData, weekId: string) => {
  const daysInWeek = ctx.activeDays.filter(d => getWeekId(d) === weekId);
  let count = 0;

  for (const day of daysInWeek) {
    if (
      isAvailable(emp, day, 'Morning', ctx.data.closedDays) &&
      !isWorking(ctx.schedule, emp.name, day, 'Morning') &&
      getNormalShiftCount(ctx.schedule, day, 'Morning') < NORMAL_SHIFT_CAPACITY
    ) {
      count++;
    }
    if (
      isAvailable(emp, day, 'Afternoon', ctx.data.closedDays) &&
      !isWorking(ctx.schedule, emp.name, day, 'Afternoon') &&
      getNormalShiftCount(ctx.schedule, day, 'Afternoon') < NORMAL_SHIFT_CAPACITY
    ) {
      count++;
    }
  }

  return count;
};

const hasRoomForShift = (
  ctx: PlannerContext,
  emp: EmployeeData,
  weekId: string,
  hours: number = HOURS_PER_SHIFT,
  ignoreMax: boolean = false
) => {
  if (ignoreMax) return true;
  return (ctx.stats[emp.name].weeklyAssignedHours[weekId] || 0) + hours <= getMaxHours(emp, weekId);
};

const assignShift = (
  ctx: PlannerContext,
  empName: string,
  day: string,
  type: ShiftType,
  isWeb: boolean,
  isWebRevision: boolean = false
) => {
  ctx.schedule[empName].push({ day, type, isWeb, isWebRevision });
  ctx.stats[empName].totalAssignedHours += HOURS_PER_SHIFT;
  const weekId = getWeekId(day);
  ctx.stats[empName].weeklyAssignedHours[weekId] += HOURS_PER_SHIFT;
};

const getShiftCandidateCount = (
  ctx: PlannerContext,
  day: string,
  shiftType: ShiftType,
  purpose: 'normal' | 'web' | 'revision',
  ignoreMax: boolean = false
) => {
  const weekId = getWeekId(day);
  return ctx.employees.filter(emp => {
    if (purpose === 'normal' && emp.isWebOnly) return false;
    if (purpose === 'web' && !(emp.isWeb || emp.isWebOnly)) return false;
    if (purpose === 'revision' && !emp.isWebRevision) return false;
    if (!isAvailable(emp, day, shiftType, ctx.data.closedDays)) return false;
    if (isWorking(ctx.schedule, emp.name, day, shiftType)) return false;
    if ((purpose === 'web' || purpose === 'revision') && hasSpecialShiftOnDay(ctx.schedule, emp.name, day)) return false;
    if (!hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT, ignoreMax)) return false;
    return true;
  }).length;
};

const getEmployeePressure = (ctx: PlannerContext, emp: EmployeeData, weekId: string) => {
  const targets = ctx.planningTargets.byEmployee[emp.name][weekId];
  const assignedThisWeek = ctx.stats[emp.name].weeklyAssignedHours[weekId] || 0;
  const assignedUntilNow = getAssignedHoursUntilWeek(ctx.stats, emp.name, ctx.planningTargets.weekOrder, weekId);
  const cumulativeMinimum = ctx.planningTargets.cumulativeMinimum[emp.name][weekId] || 0;
  const weekMinimumDebt = Math.max(0, targets.minimum - assignedThisWeek);
  const cumulativeMinimumDebt = Math.max(0, cumulativeMinimum - assignedUntilNow);
  const remainingNormalAvailability = getRemainingNormalAvailabilityCount(ctx, emp, weekId);
  const weekMinimumNeedRatio = targets.minimum > 0 ? weekMinimumDebt / Math.max(HOURS_PER_SHIFT, targets.minimum) : 0;
  const cumulativeMinimumNeedRatio = cumulativeMinimum > 0 ? cumulativeMinimumDebt / Math.max(HOURS_PER_SHIFT, cumulativeMinimum) : 0;
  const weekExtraAboveMinimum = Math.max(0, assignedThisWeek - targets.minimum);
  const cumulativeExtraAboveMinimum = Math.max(0, assignedUntilNow - cumulativeMinimum);
  const lastChanceShiftPressure = Math.max(0, Math.ceil(weekMinimumDebt / HOURS_PER_SHIFT) - remainingNormalAvailability);
  const weekIndex = ctx.planningTargets.weekOrder.indexOf(weekId);
  const previousWeekId = weekIndex > 0 ? ctx.planningTargets.weekOrder[weekIndex - 1] : null;
  const previousWeekAssigned = previousWeekId ? (ctx.stats[emp.name].weeklyAssignedHours[previousWeekId] || 0) : 0;
  const previousWeekPreferred = previousWeekId ? ctx.planningTargets.byEmployee[emp.name][previousWeekId].preferred : 0;
  const previousWeekOverRatio = previousWeekId
    ? Math.max(0, previousWeekAssigned - previousWeekPreferred) / Math.max(HOURS_PER_SHIFT, previousWeekPreferred || HOURS_PER_SHIFT)
    : 0;

  return {
    assignedThisWeek,
    assignedUntilNow,
    weekMinimumDebt,
    cumulativeMinimumDebt,
    weekMinimumNeedRatio,
    cumulativeMinimumNeedRatio,
    weekExtraAboveMinimum,
    cumulativeExtraAboveMinimum,
    lastChanceShiftPressure,
    previousWeekOverRatio,
    remainingNormalAvailability,
    preferredTarget: targets.preferred,
    minimumTarget: targets.minimum,
    maxTarget: targets.max,
  };
};

const getFullDayCompletionBonus = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  purpose: 'normal' | 'web' | 'revision'
) => {
  const priority = getFullDayPriority(emp);
  const otherShift = shiftType === 'Morning' ? 'Afternoon' : 'Morning';
  const alreadyOther = isWorking(ctx.schedule, emp.name, day, otherShift);
  const alreadyAny = isWorkingOnDay(ctx.schedule, emp.name, day);
  let score = 0;

  if (alreadyOther) {
    score += 36 + priority * 14;
  } else if (!alreadyAny && priority >= 4 && purpose !== 'revision') {
    score -= 12 + priority * 4;
  }

  return score;
};

const getModeWeights = () => {
  return {
    weekMinimum: 94,
    cumulativeMinimum: 66,
    weekFairness: 8,
    cumulativeFairness: 5,
    scarcity: 30,
    fullDay: 1,
    protectWeb: 24,
    protectRevision: 36,
    overPreferred: 8,
    overMax: 22,
    noise: 6,
  };
};

const scoreNormalCandidate = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  forceFill: boolean
) => {
  const weekId = getWeekId(day);
  const weights = getModeWeights();
  const pressure = getEmployeePressure(ctx, emp, weekId);
  const scarcity = Math.max(0, 6 - getShiftCandidateCount(ctx, day, shiftType, 'normal', forceFill));
  const weeklyOverPreferred = Math.max(0, pressure.assignedThisWeek - pressure.preferredTarget);
  const weeklyOverMax = Math.max(0, pressure.assignedThisWeek - pressure.maxTarget);
  const cumulativeOverPreferred = Math.max(0, pressure.assignedUntilNow - (ctx.planningTargets.cumulativePreferred[emp.name][weekId] || 0));

  let score = 0;
  score += pressure.weekMinimumNeedRatio * (weights.weekMinimum * 1.7);
  score += pressure.cumulativeMinimumNeedRatio * (weights.cumulativeMinimum * 1.25);
  score += Math.min(2, pressure.weekMinimumDebt / HOURS_PER_SHIFT) * 26;
  score -= pressure.weekExtraAboveMinimum * weights.weekFairness;
  score -= pressure.cumulativeExtraAboveMinimum * weights.cumulativeFairness;
  score += scarcity * weights.scarcity;
  score += getFullDayCompletionBonus(ctx, emp, day, shiftType, 'normal') * weights.fullDay;

  if ((emp.isWeb || emp.isWebRevision) && !emp.isWebOnly) {
    score -= emp.isWebRevision ? weights.protectRevision : weights.protectWeb;
  }

  if (pressure.remainingNormalAvailability <= 2) {
    score += 28;
  } else if (pressure.remainingNormalAvailability <= 4) {
    score += 12;
  }

  if (pressure.lastChanceShiftPressure > 0) {
    score += pressure.lastChanceShiftPressure * 54;
  }

  score -= pressure.previousWeekOverRatio * 8;

  if (!forceFill) {
    score -= weeklyOverPreferred * (weights.overPreferred * 1.8);
    score -= cumulativeOverPreferred * (weights.overPreferred * 0.8);
    if (pressure.assignedThisWeek + HOURS_PER_SHIFT > pressure.maxTarget) {
      score -= 360;
    }
  } else {
    score -= weeklyOverPreferred * (weights.overPreferred * 1.2);
    score -= cumulativeOverPreferred * (weights.overPreferred * 0.6);
    score -= weeklyOverMax * (weights.overMax * 1.45);
    if (pressure.assignedThisWeek + HOURS_PER_SHIFT > pressure.maxTarget) {
      score -= 180;
    }
  }

  score += Math.random() * weights.noise;
  return score;
};

const scoreWebCandidate = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  isRevision: boolean
) => {
  const weekId = getWeekId(day);
  const weights = getModeWeights();
  const pressure = getEmployeePressure(ctx, emp, weekId);
  const scarcity = Math.max(0, 5 - getShiftCandidateCount(ctx, day, shiftType, isRevision ? 'revision' : 'web'));
  const normalScarcity = Math.max(0, 5 - getShiftCandidateCount(ctx, day, shiftType, 'normal'));
  const weeklyOverPreferred = Math.max(0, pressure.assignedThisWeek - pressure.preferredTarget);
  const cumulativeOverPreferred = Math.max(0, pressure.assignedUntilNow - (ctx.planningTargets.cumulativePreferred[emp.name][weekId] || 0));
  const weeklyOverMax = Math.max(0, pressure.assignedThisWeek - pressure.maxTarget);

  let score = 0;
  score += pressure.weekMinimumNeedRatio * (weights.weekMinimum * 1.3);
  score += pressure.cumulativeMinimumNeedRatio * weights.cumulativeMinimum;
  score -= pressure.weekExtraAboveMinimum * weights.weekFairness;
  score -= pressure.cumulativeExtraAboveMinimum * weights.cumulativeFairness;
  score += scarcity * (weights.scarcity + 6);
  score += getFullDayCompletionBonus(ctx, emp, day, shiftType, isRevision ? 'revision' : 'web') * weights.fullDay;

  if (emp.isWebOnly) score += 220;
  if (isRevision && emp.isWebRevision) score += 32;
  if (!isRevision && emp.isWeb && !emp.isWebOnly) score += 12;

  if (!emp.isWebOnly && normalScarcity >= 3) {
    score -= normalScarcity * 16;
  }

  score -= pressure.previousWeekOverRatio * 7;

  score -= weeklyOverPreferred * (weights.overPreferred * 1.9);
  score -= cumulativeOverPreferred * (weights.overPreferred * 0.9);
  score -= weeklyOverMax * (weights.overMax * 1.5);

  if (pressure.assignedThisWeek + HOURS_PER_SHIFT > pressure.maxTarget) {
    score -= 280;
  }

  score += Math.random() * weights.noise;
  return score;
};

function scoreSchedule(result: ScheduleResult, data: ParsedData): number {
  let score = 0;
  const planningTargets = buildPlanningTargets(data);
  const fairnessVarianceWeight = 180;

  for (const day in result.unfilledNormalShifts) {
    if (data.closedDays.includes(day)) continue;
    score -= result.unfilledNormalShifts[day].morning * 50000;
    score -= result.unfilledNormalShifts[day].afternoon * 50000;
  }

  for (const day in result.unfilledWebShifts) {
    score -= result.unfilledWebShifts[day].morning * 1200;
    score -= result.unfilledWebShifts[day].afternoon * 1200;
  }

  for (const day in result.unfilledWebRevisionShifts) {
    score -= result.unfilledWebRevisionShifts[day].morning * 1600;
    score -= result.unfilledWebRevisionShifts[day].afternoon * 1600;
  }

  for (const weekId of planningTargets.weekOrder) {
    const extraAssignedAboveMinimum: number[] = [];

    for (const emp of data.employees) {
      const targets = planningTargets.byEmployee[emp.name][weekId];
      const assignedWeek = result.stats[emp.name].weeklyAssignedHours[weekId] || 0;
      const assignedUntilWeek = getAssignedHoursUntilWeek(result.stats, emp.name, planningTargets.weekOrder, weekId);
      const cumulativePreferred = planningTargets.cumulativePreferred[emp.name][weekId] || 0;
      const cumulativeMinimum = planningTargets.cumulativeMinimum[emp.name][weekId] || 0;

      if (assignedWeek < targets.minimum) {
        score -= (targets.minimum - assignedWeek) * 2600;
      }

      if (assignedUntilWeek < cumulativeMinimum) {
        score -= (cumulativeMinimum - assignedUntilWeek) * 1800;
      }

      if (assignedWeek > targets.max) {
        score -= (assignedWeek - targets.max) * 2600;
      }

      if (assignedWeek > targets.preferred) {
        score -= (assignedWeek - targets.preferred) * 140;
      } else if (assignedWeek < targets.preferred && targets.preferred > targets.minimum) {
        score -= (targets.preferred - assignedWeek) * 40;
      }

      if (assignedUntilWeek < cumulativePreferred && cumulativePreferred > cumulativeMinimum) {
        score -= (cumulativePreferred - assignedUntilWeek) * 15;
      } else if (assignedUntilWeek > cumulativePreferred) {
        score -= (assignedUntilWeek - cumulativePreferred) * 60;
      }

      if (targets.availableHours > targets.minimum && targets.max > targets.minimum) {
        extraAssignedAboveMinimum.push(Math.max(0, assignedWeek - targets.minimum));
      }
    }

    if (extraAssignedAboveMinimum.length > 1) {
      const totalExtraAssigned = extraAssignedAboveMinimum.reduce((sum, extra) => sum + extra, 0);
      const averageExtraAssigned = totalExtraAssigned / extraAssignedAboveMinimum.length;

      for (const extraAssigned of extraAssignedAboveMinimum) {
        const extraDiff = extraAssigned - averageExtraAssigned;
        score -= extraDiff * extraDiff * fairnessVarianceWeight;
      }
    }
  }

  for (const emp of data.employees) {
    const shifts = result.employeeSchedules[emp.name];
    const dayMap = new Map<string, AssignedShift[]>();
    for (const shift of shifts) {
      if (!dayMap.has(shift.day)) dayMap.set(shift.day, []);
      dayMap.get(shift.day)!.push(shift);
    }

    for (const [, shiftsOnDay] of dayMap) {
      const normalCount = shiftsOnDay.filter(s => !s.isWeb && !s.isWebRevision).length;
      const totalCount = shiftsOnDay.length;
      if (totalCount >= 2) {
        score += 90 + getFullDayPriority(emp) * 14;
      } else if (getFullDayPriority(emp) >= 4) {
        score -= 22 + getFullDayPriority(emp) * 6;
      }

      if (normalCount === 0 && emp.isWebOnly) {
        score += 16;
      }
    }
  }

  return score;
}

export function generateSingleSchedule(data: ParsedData): ScheduleResult {
  const employees = data.employees;
  const activeDays = data.days.filter(d => !data.closedDays.includes(d));
  const planningTargets = buildPlanningTargets(data);

  const schedule: Record<string, AssignedShift[]> = {};
  const stats: ScheduleResult['stats'] = {};

  for (const emp of employees) {
    schedule[emp.name] = [];

    let totalPref = 0;
    let totalMax = 0;
    for (const weekId of planningTargets.weekOrder) {
      totalPref += planningTargets.byEmployee[emp.name][weekId].preferred;
      totalMax += planningTargets.byEmployee[emp.name][weekId].max;
    }

    stats[emp.name] = {
      totalAssignedHours: 0,
      totalPreferredHours: totalPref,
      totalMaxHours: totalMax,
      preferredHoursPerWeek: emp.preferredHours,
      weeklyAssignedHours: {},
    };

    for (const weekId of planningTargets.weekOrder) {
      stats[emp.name].weeklyAssignedHours[weekId] = 0;
    }
  }

  const unfilledNormalShifts: ScheduleResult['unfilledNormalShifts'] = {};
  const unfilledWebShifts: ScheduleResult['unfilledWebShifts'] = {};
  const unfilledWebRevisionShifts: ScheduleResult['unfilledWebRevisionShifts'] = {};

  for (const day of data.days) {
    unfilledNormalShifts[day] = { morning: 0, afternoon: 0 };
    unfilledWebShifts[day] = { morning: 0, afternoon: 0 };
    unfilledWebRevisionShifts[day] = { morning: 0, afternoon: 0 };
  }

  const ctx: PlannerContext = {
    data,
    employees,
    schedule,
    stats,
    activeDays,
    planningTargets,
  };

  const assignPreferredWebShifts = (
    weekId: string,
    count: number,
    allowedDays: string[],
    timePreference: 'Morning' | 'Afternoon' | 'Any',
    isRevision: boolean
  ) => {
    let remaining = count;
    const preferredOrder: ShiftType[] = timePreference === 'Morning'
      ? ['Morning', 'Afternoon']
      : timePreference === 'Afternoon'
        ? ['Afternoon', 'Morning']
        : ['Morning', 'Afternoon'];

    const dayOrder = [...allowedDays].sort((a, b) => {
      const bestA = Math.max(
        ...preferredOrder.map(type => getShiftCandidateCount(ctx, a, type, isRevision ? 'revision' : 'web')),
        0
      );
      const bestB = Math.max(
        ...preferredOrder.map(type => getShiftCandidateCount(ctx, b, type, isRevision ? 'revision' : 'web')),
        0
      );
      return bestA - bestB;
    });

    while (remaining > 0) {
      let best:
        | { emp: EmployeeData; day: string; type: ShiftType; score: number }
        | null = null;

      for (const day of dayOrder) {
        for (const type of preferredOrder) {
          const candidatePool = employees.filter(emp => {
            if (isRevision && !emp.isWebRevision) return false;
            if (!isRevision && !(emp.isWeb || emp.isWebOnly)) return false;
            if (!isAvailable(emp, day, type, data.closedDays)) return false;
            if (isWorking(schedule, emp.name, day, type)) return false;
            if (hasSpecialShiftOnDay(schedule, emp.name, day)) return false;
            if (!hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT)) return false;
            return true;
          });

          const prioritizedPool = [
            ...candidatePool.filter(emp => emp.isWebOnly),
            ...candidatePool.filter(emp => !emp.isWebOnly),
          ];

          for (const emp of prioritizedPool) {
            const score = scoreWebCandidate(ctx, emp, day, type, isRevision) + (emp.isWebOnly ? 1200 : 0);
            if (!best || score > best.score) {
              best = { emp, day, type, score };
            }
          }
        }
      }

      if (!best) break;
      assignShift(ctx, best.emp.name, best.day, best.type, !isRevision, isRevision);
      remaining--;
    }

    return remaining;
  };

  for (const weekId of planningTargets.weekOrder) {
    const req = data.weeklyWebRequirements?.[weekId];
    if (!req) continue;

    const allowedRevisionDays = req.webRevisionDays.filter(d => getWeekId(d) === weekId && !data.closedDays.includes(d));
    const remainingRevision = assignPreferredWebShifts(
      weekId,
      req.webRevisionShifts,
      allowedRevisionDays,
      req.webRevisionTimePreference,
      true
    );

    const allowedWebDays = req.webShiftDays.filter(d => getWeekId(d) === weekId && !data.closedDays.includes(d));
    const remainingWeb = assignPreferredWebShifts(
      weekId,
      req.webShifts,
      allowedWebDays,
      req.webShiftTimePreference,
      false
    );

    // Missing special shifts are only recorded after normal-shift balancing.
    // This phase can still be repaired later, so counting them here double-counts
    // deficits that survive into the final rebalance step.
  }

  const assignNormalByMinimumGoal = (weekId: string) => {
    const daysInWeek = activeDays.filter(d => getWeekId(d) === weekId);
    let madeProgress = true;

    while (madeProgress) {
      madeProgress = false;
      let best:
        | { emp: EmployeeData; day: string; type: ShiftType; score: number }
        | null = null;

      for (const day of daysInWeek) {
        for (const type of ['Morning', 'Afternoon'] as ShiftType[]) {
          if (getNormalShiftCount(schedule, day, type) >= NORMAL_SHIFT_CAPACITY) continue;

          for (const emp of employees) {
            if (emp.isWebOnly) continue;
            if (!isAvailable(emp, day, type, data.closedDays)) continue;
            if (isWorking(schedule, emp.name, day, type)) continue;
            if (!hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT)) continue;

            const pressure = getEmployeePressure(ctx, emp, weekId);
            const relevantDebt = pressure.weekMinimumDebt + pressure.cumulativeMinimumDebt;
            if (relevantDebt <= 0) continue;

            const score = scoreNormalCandidate(ctx, emp, day, type, false) + 90;
            if (!best || score > best.score) {
              best = { emp, day, type, score };
            }
          }
        }
      }

      if (!best) break;
      assignShift(ctx, best.emp.name, best.day, best.type, false, false);
      madeProgress = true;
    }
  };

  const assignNormalByFairShare = (weekId: string) => {
    const daysInWeek = activeDays.filter(d => getWeekId(d) === weekId);
    let madeProgress = true;

    while (madeProgress) {
      madeProgress = false;
      let best:
        | { emp: EmployeeData; day: string; type: ShiftType; score: number }
        | null = null;

      for (const day of daysInWeek) {
        for (const type of ['Morning', 'Afternoon'] as ShiftType[]) {
          if (getNormalShiftCount(schedule, day, type) >= NORMAL_SHIFT_CAPACITY) continue;

          for (const emp of employees) {
            if (emp.isWebOnly) continue;
            if (!isAvailable(emp, day, type, data.closedDays)) continue;
            if (isWorking(schedule, emp.name, day, type)) continue;
            if (!hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT)) continue;

            const score = scoreNormalCandidate(ctx, emp, day, type, false) + 24;
            if (!best || score > best.score) {
              best = { emp, day, type, score };
            }
          }
        }
      }

      if (!best) break;
      assignShift(ctx, best.emp.name, best.day, best.type, false, false);
      madeProgress = true;
    }
  };

  for (const weekId of planningTargets.weekOrder) {
    assignNormalByMinimumGoal(weekId);
    assignNormalByFairShare(weekId);
  }

  for (const weekId of planningTargets.weekOrder) {
    const daysInWeek = activeDays.filter(d => getWeekId(d) === weekId);
    const shiftSlots = daysInWeek.flatMap(day => (['Morning', 'Afternoon'] as ShiftType[]).map(type => ({ day, type })));
    shiftSlots.sort((a, b) => {
      const aCount = getShiftCandidateCount(ctx, a.day, a.type, 'normal', true);
      const bCount = getShiftCandidateCount(ctx, b.day, b.type, 'normal', true);
      return aCount - bCount;
    });

    for (const slot of shiftSlots) {
      while (getNormalShiftCount(schedule, slot.day, slot.type) < NORMAL_SHIFT_CAPACITY) {
        const allAvailableEmps = employees.filter(emp =>
          !emp.isWebOnly &&
          isAvailable(emp, slot.day, slot.type, data.closedDays) &&
          !isWorking(schedule, emp.name, slot.day, slot.type)
        );

        if (allAvailableEmps.length === 0) break;

        const withinMaxEmps = allAvailableEmps.filter(emp => hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT));
        const availableEmps = withinMaxEmps.length > 0 ? withinMaxEmps : allAvailableEmps;

        let best = availableEmps[0];
        let bestScore = -Infinity;
        for (const emp of availableEmps) {
          const score = scoreNormalCandidate(ctx, emp, slot.day, slot.type, true);
          if (score > bestScore) {
            bestScore = score;
            best = emp;
          }
        }

        assignShift(ctx, best.name, slot.day, slot.type, false, false);
      }

      let missing = NORMAL_SHIFT_CAPACITY - getNormalShiftCount(schedule, slot.day, slot.type);
      if (missing > 0) {
        const workersOnSpecial = employees.filter(emp => {
          if (emp.isWebOnly) return false;
          const shift = getShiftForEmployee(schedule, emp.name, slot.day, slot.type);
          return shift && (shift.isWeb || shift.isWebRevision);
        });

        workersOnSpecial.sort((a, b) => scoreNormalCandidate(ctx, a, slot.day, slot.type, true) - scoreNormalCandidate(ctx, b, slot.day, slot.type, true));

        for (const emp of workersOnSpecial) {
          if (missing <= 0) break;
          const shift = getShiftForEmployee(schedule, emp.name, slot.day, slot.type);
          if (!shift) continue;
          shift.isWeb = false;
          shift.isWebRevision = false;
          missing--;
        }
      }

      if (missing > 0) {
        if (slot.type === 'Morning') unfilledNormalShifts[slot.day].morning = missing;
        else unfilledNormalShifts[slot.day].afternoon = missing;
      }
    }
  }

  for (const weekId of planningTargets.weekOrder) {
    const req = data.weeklyWebRequirements?.[weekId];
    if (!req) continue;

    const allowedWebDays = req.webShiftDays.filter(d => getWeekId(d) === weekId && !data.closedDays.includes(d));
    const allowedRevisionDays = req.webRevisionDays.filter(d => getWeekId(d) === weekId && !data.closedDays.includes(d));

    let assignedWeb = 0;
    let assignedRevision = 0;
    for (const empName in schedule) {
      for (const shift of schedule[empName]) {
        if (getWeekId(shift.day) !== weekId) continue;
        if (shift.isWeb) assignedWeb++;
        if (shift.isWebRevision) assignedRevision++;
      }
    }

    const fillOptionalSpecialShifts = (
      kind: 'web' | 'revision',
      targetCount: number,
      allowedDays: string[],
      preference: 'Morning' | 'Afternoon' | 'Any'
    ) => {
      let remaining = targetCount;
      const shiftOrder: ShiftType[] = preference === 'Morning'
        ? ['Morning', 'Afternoon']
        : preference === 'Afternoon'
          ? ['Afternoon', 'Morning']
          : ['Morning', 'Afternoon'];

      for (const day of allowedDays) {
        for (const type of shiftOrder) {
          if (remaining <= 0) return 0;

          const idleCandidates = employees.filter(emp => {
            if (kind === 'revision' && !emp.isWebRevision) return false;
            if (kind === 'web' && !(emp.isWeb || emp.isWebOnly)) return false;
            if (!isAvailable(emp, day, type, data.closedDays)) return false;
            if (isWorking(schedule, emp.name, day, type)) return false;
            if (hasSpecialShiftOnDay(schedule, emp.name, day)) return false;
            return hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT);
          });

          idleCandidates.sort((a, b) => {
            const scoreB = scoreWebCandidate(ctx, b, day, type, kind === 'revision') + (b.isWebOnly ? 1200 : 0);
            const scoreA = scoreWebCandidate(ctx, a, day, type, kind === 'revision') + (a.isWebOnly ? 1200 : 0);
            return scoreB - scoreA;
          });
          if (idleCandidates.length > 0) {
            const chosen = idleCandidates[0];
            assignShift(ctx, chosen.name, day, type, kind === 'web', kind === 'revision');
            remaining--;
            continue;
          }

          const normalWorkers = employees.filter(emp => {
            if (emp.isWebOnly) return false;
            if (kind === 'revision' && !emp.isWebRevision) return false;
            if (kind === 'web' && !(emp.isWeb || emp.isWebOnly)) return false;
            if (hasSpecialShiftOnDay(schedule, emp.name, day)) return false;
            const shift = getShiftForEmployee(schedule, emp.name, day, type);
            return shift && !shift.isWeb && !shift.isWebRevision;
          });

          normalWorkers.sort((a, b) => {
            const scoreB = scoreWebCandidate(ctx, b, day, type, kind === 'revision') + (b.isWebOnly ? 1200 : 0);
            const scoreA = scoreWebCandidate(ctx, a, day, type, kind === 'revision') + (a.isWebOnly ? 1200 : 0);
            return scoreB - scoreA;
          });

          for (const worker of normalWorkers) {
            const allReplacementCandidates = employees.filter(emp =>
              emp.name !== worker.name &&
              !emp.isWebOnly &&
              isAvailable(emp, day, type, data.closedDays) &&
              !isWorking(schedule, emp.name, day, type)
            );

            const replacementCandidates = allReplacementCandidates.some(emp => hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT))
              ? allReplacementCandidates.filter(emp => hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT))
              : allReplacementCandidates;

            replacementCandidates.sort((a, b) => scoreNormalCandidate(ctx, b, day, type, true) - scoreNormalCandidate(ctx, a, day, type, true));
            if (replacementCandidates.length === 0) continue;

            const replacement = replacementCandidates[0];
            const shift = getShiftForEmployee(schedule, worker.name, day, type);
            if (!shift) continue;

            shift.isWeb = kind === 'web';
            shift.isWebRevision = kind === 'revision';
            assignShift(ctx, replacement.name, day, type, false, false);
            remaining--;
            break;
          }
        }
      }

      return remaining;
    };

    const remainingWeb = fillOptionalSpecialShifts('web', Math.max(0, req.webShifts - assignedWeb), allowedWebDays, req.webShiftTimePreference);
    const remainingRevision = fillOptionalSpecialShifts('revision', Math.max(0, req.webRevisionShifts - assignedRevision), allowedRevisionDays, req.webRevisionTimePreference);

    if (remainingWeb > 0) {
      const day = allowedWebDays[0] ?? activeDays.find(d => getWeekId(d) === weekId);
      if (day) {
        if (req.webShiftTimePreference === 'Afternoon') unfilledWebShifts[day].afternoon += remainingWeb;
        else unfilledWebShifts[day].morning += remainingWeb;
      }
    }

    if (remainingRevision > 0) {
      const day = allowedRevisionDays[0] ?? activeDays.find(d => getWeekId(d) === weekId);
      if (day) {
        if (req.webRevisionTimePreference === 'Afternoon') unfilledWebRevisionShifts[day].afternoon += remainingRevision;
        else unfilledWebRevisionShifts[day].morning += remainingRevision;
      }
    }
  }

  for (const emp of employees) {
    const byDay = new Map<string, AssignedShift[]>();
    for (const shift of schedule[emp.name]) {
      if (!byDay.has(shift.day)) byDay.set(shift.day, []);
      byDay.get(shift.day)!.push(shift);
    }

    for (const [day, shiftsOnDay] of byDay.entries()) {
      const specialShifts = shiftsOnDay.filter(shift => shift.isWeb || shift.isWebRevision);
      if (specialShifts.length <= 1) continue;

      specialShifts.sort((a, b) => {
        const aPriority = a.isWebRevision ? 2 : 1;
        const bPriority = b.isWebRevision ? 2 : 1;
        return bPriority - aPriority;
      });

      for (const shift of specialShifts.slice(1)) {
        shift.isWeb = false;
        shift.isWebRevision = false;
      }
    }
  }

  return { employeeSchedules: schedule, unfilledNormalShifts, unfilledWebShifts, unfilledWebRevisionShifts, stats };
}
