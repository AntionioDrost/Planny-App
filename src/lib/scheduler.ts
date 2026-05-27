import type { ParsedData, EmployeeData } from './parser';
import { generateLegacySchedule } from './schedulerLegacy';

export type PlannerMode = 'fairness' | 'legacy';
export type ShiftType = 'Morning' | 'Afternoon';
export type SpecialShiftKind = 'web' | 'revision';
export type FairnessGroupKey = 'total' | 'normal' | 'web' | 'revision';
export type AssignedFairnessGroup = Exclude<FairnessGroupKey, 'total'>;

export interface AssignedShift {
  day: string;
  type: ShiftType;
  isWeb: boolean;
  isWebRevision?: boolean;
}

export interface FairnessEmployeeMetrics {
  claimHours: number;
  assignedHours: number;
  targetHours: number;
  loadRatio: number;
  penalty: number;
}

export interface FairnessGroupReport {
  demandHours: number;
  activeEmployees: number;
  sumClaims: number;
  penalty: number;
  jainIndex: number | null;
  gini: number | null;
  cv: number | null;
  employeeNames: string[];
}

export interface ScheduleFairnessEmployeeReport {
  total: FairnessEmployeeMetrics | null;
  normal: FairnessEmployeeMetrics | null;
  web: FairnessEmployeeMetrics | null;
  revision: FairnessEmployeeMetrics | null;
}

export interface ScheduleFairnessReport {
  plannerMode: PlannerMode;
  contractHoursForPeriod: number;
  totalPenalty: number;
  groups: Record<FairnessGroupKey, FairnessGroupReport>;
  employees: Record<string, ScheduleFairnessEmployeeReport>;
}

export interface EmployeeScheduleStats {
  totalAssignedHours: number;
  totalPreferredHours: number;
  totalMaxHours: number;
  preferredHoursPerWeek: number;
  weeklyAssignedHours: Record<string, number>;
}

export interface ScheduleResult {
  plannerMode: PlannerMode;
  employeeSchedules: Record<string, AssignedShift[]>;
  unfilledNormalShifts: Record<string, { morning: number; afternoon: number }>;
  unfilledWebShifts: Record<string, { morning: number; afternoon: number }>;
  unfilledWebRevisionShifts: Record<string, { morning: number; afternoon: number }>;
  fairnessReport: ScheduleFairnessReport;
  stats: Record<string, EmployeeScheduleStats>;
}

export interface DayPartCounts {
  morning: number;
  afternoon: number;
}

export interface ScheduleUnfilledCounts {
  normal: Record<string, DayPartCounts>;
  web: Record<string, DayPartCounts>;
  revision: Record<string, DayPartCounts>;
}

export interface WeekTargets {
  preferred: number;
  minimum: number;
  max: number;
  availableHours: number;
  contractHours: number;
}

export interface PlanningTargets {
  weekOrder: string[];
  byEmployee: Record<string, Record<string, WeekTargets>>;
  cumulativePreferred: Record<string, Record<string, number>>;
  cumulativeMinimum: Record<string, Record<string, number>>;
}

interface FairnessGroupState {
  demandHours: number;
  lambda: number;
  sumClaims: number;
  claimHoursByEmployee: Record<string, number>;
  targetHoursByEmployee: Record<string, number>;
  assignedHoursByEmployee: Record<string, number>;
  employeeNames: string[];
}

interface FairnessState {
  contractHoursForPeriod: number;
  groups: Record<FairnessGroupKey, FairnessGroupState>;
}

export interface PlannerContext {
  data: ParsedData;
  employees: EmployeeData[];
  schedule: Record<string, AssignedShift[]>;
  stats: ScheduleResult['stats'];
  activeDays: string[];
  planningTargets: PlanningTargets;
  fairness: FairnessState;
  plannerMode: PlannerMode;
}

interface ScoredSpecialCandidate {
  emp: EmployeeData;
  day: string;
  type: ShiftType;
  score: number;
}

interface SpecialConversionCandidate {
  worker: EmployeeData;
  replacement: EmployeeData;
  day: string;
  type: ShiftType;
  score: number;
}

interface FairnessDelta {
  employeeName: string;
  group: FairnessGroupKey;
  deltaHours: number;
}

const FAIRNESS_GROUP_ORDER: FairnessGroupKey[] = ['total', 'normal', 'web', 'revision'];
const EPSILON = 1e-9;

export const HOURS_PER_SHIFT = 4;
export const NORMAL_SHIFT_CAPACITY = 2;
export const WEEKLY_MINIMUM_TARGET = 8;
export const DEFAULT_SCHEDULE_ITERATIONS = 520;
export const FAIRNESS_SCORE_WEIGHT = 180;
export const FAIRNESS_DELTA_SCORE_WEIGHT = 90;
const ABSOLUTE_HOURS_GINI_REBALANCE_WEIGHT = 8;
const ABSOLUTE_HOURS_GINI_SCORE_WEIGHT =
  FAIRNESS_SCORE_WEIGHT * ABSOLUTE_HOURS_GINI_REBALANCE_WEIGHT;
const ABSOLUTE_HOURS_REBALANCE_MIN_PENALTY_HEADROOM = 0.2;
const ABSOLUTE_HOURS_REBALANCE_MAX_PENALTY_GROWTH_RATIO = 0.75;

const FAIRNESS_GROUP_WEIGHTS: Record<FairnessGroupKey, number> = {
  total: 1.0,
  normal: 0,
  web: 0,
  revision: 0,
};

export function generateSchedule(
  data: ParsedData,
  iterations: number = DEFAULT_SCHEDULE_ITERATIONS,
  mode: PlannerMode = 'fairness'
): ScheduleResult {
  if (mode === 'legacy') {
    return generateLegacySchedule(data, iterations);
  }

  let bestSchedule: ScheduleResult | null = null;
  let bestScore = -Infinity;
  const runCount = Math.max(1, iterations);

  for (let i = 0; i < runCount; i++) {
    const currentSchedule = generateSingleSchedule(data);
    const currentScore = scoreSchedule(currentSchedule, data);

    if (currentScore > bestScore || !bestSchedule) {
      bestScore = currentScore;
      bestSchedule = currentSchedule;
    }
  }

  return rebalanceShiftsForAbsoluteHours(data, bestSchedule!);
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

export const isAvailable = (
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  closedDays: string[]
) => {
  if (closedDays.includes(day)) return false;
  const avail = emp.availability[day];
  if (!avail) return false;

  const trimmedAvail = avail.trim();
  if (trimmedAvail.includes('9:00-17:00')) return true;
  if (shiftType === 'Morning' && trimmedAvail.includes('9:00-13:00')) return true;
  if (shiftType === 'Afternoon' && trimmedAvail.includes('13:00-17:00')) return true;
  return false;
};

export const getAvailabilityCount = (
  emp: EmployeeData,
  weekId: string,
  days: string[],
  closedDays: string[]
) => {
  const daysInWeek = days.filter(day => getWeekId(day) === weekId);
  let count = 0;

  for (const day of daysInWeek) {
    if (isAvailable(emp, day, 'Morning', closedDays)) count++;
    if (isAvailable(emp, day, 'Afternoon', closedDays)) count++;
  }

  return count;
};

export const getAvailableHoursForWeek = (
  emp: EmployeeData,
  weekId: string,
  days: string[],
  closedDays: string[]
) => getAvailabilityCount(emp, weekId, days, closedDays) * HOURS_PER_SHIFT;

export const getMaxHours = (emp: EmployeeData, weekId: string) =>
  emp.weeklyMaxHoursOverride[weekId] ?? emp.maxHours;

export const getPreferredHours = (
  emp: EmployeeData,
  weekId: string,
  days: string[],
  closedDays: string[]
) => {
  const pref = emp.weeklyPreferredHoursOverride[weekId] ?? emp.preferredHours;
  const availableHours = getAvailableHoursForWeek(emp, weekId, days, closedDays);
  const max = getMaxHours(emp, weekId);
  return Math.min(pref, availableHours, max);
};

export const getContractHours = (emp: EmployeeData) => emp.contractHours;

export const getMinimumHoursTarget = (
  emp: EmployeeData,
  weekId: string,
  days: string[],
  closedDays: string[]
) => {
  const preferred = getPreferredHours(emp, weekId, days, closedDays);
  const availableHours = getAvailableHoursForWeek(emp, weekId, days, closedDays);
  const max = getMaxHours(emp, weekId);
  return Math.min(WEEKLY_MINIMUM_TARGET, preferred, availableHours, max);
};

export const buildPlanningTargets = (data: ParsedData): PlanningTargets => {
  const weekOrder = getWeekOrder(data.days);
  const byEmployee: PlanningTargets['byEmployee'] = {};
  const cumulativePreferred: PlanningTargets['cumulativePreferred'] = {};
  const cumulativeMinimum: PlanningTargets['cumulativeMinimum'] = {};

  for (const emp of data.employees) {
    byEmployee[emp.name] = {};
    cumulativePreferred[emp.name] = {};
    cumulativeMinimum[emp.name] = {};

    let preferredRunning = 0;
    let minimumRunning = 0;
    for (const weekId of weekOrder) {
      const preferred = getPreferredHours(emp, weekId, data.days, data.closedDays);
      const minimum = getMinimumHoursTarget(emp, weekId, data.days, data.closedDays);
      const max = getMaxHours(emp, weekId);
      const availableHours = getAvailableHoursForWeek(emp, weekId, data.days, data.closedDays);

      byEmployee[emp.name][weekId] = {
        preferred,
        minimum,
        max,
        availableHours,
        contractHours: getContractHours(emp),
      };

      preferredRunning += preferred;
      minimumRunning += minimum;
      cumulativePreferred[emp.name][weekId] = preferredRunning;
      cumulativeMinimum[emp.name][weekId] = minimumRunning;
    }
  }

  return { weekOrder, byEmployee, cumulativePreferred, cumulativeMinimum };
};

export const createEmptyUnfilledCounts = (days: string[]): ScheduleUnfilledCounts => {
  const createCounts = () =>
    Object.fromEntries(days.map(day => [day, { morning: 0, afternoon: 0 }])) as Record<
      string,
      DayPartCounts
    >;

  return {
    normal: createCounts(),
    web: createCounts(),
    revision: createCounts(),
  };
};

const createHoursMap = (employees: EmployeeData[]) =>
  Object.fromEntries(employees.map(employee => [employee.name, 0])) as Record<string, number>;

const getPeriodTotals = (
  planningTargets: PlanningTargets,
  emp: EmployeeData
) => {
  const totals = {
    preferred: 0,
    max: 0,
    available: 0,
  };

  for (const weekId of planningTargets.weekOrder) {
    const targets = planningTargets.byEmployee[emp.name][weekId];
    totals.preferred += targets.preferred;
    totals.max += targets.max;
    totals.available += targets.availableHours;
  }

  return totals;
};

const getContractHoursForPeriod = (planningTargets: PlanningTargets, emp: EmployeeData) =>
  getContractHours(emp) * planningTargets.weekOrder.length;

const getPreferredShiftTypesForPreference = (
  preference: 'Morning' | 'Afternoon' | 'Any'
): ShiftType[] => {
  if (preference === 'Morning') return ['Morning'];
  if (preference === 'Afternoon') return ['Afternoon'];
  return ['Morning', 'Afternoon'];
};

const countAvailableSpecialDays = (
  emp: EmployeeData,
  days: string[],
  preference: 'Morning' | 'Afternoon' | 'Any',
  closedDays: string[]
) => {
  const shiftTypes = getPreferredShiftTypesForPreference(preference);

  return days.reduce((count, day) => {
    const canWork = shiftTypes.some(type => isAvailable(emp, day, type, closedDays));
    return count + (canWork ? 1 : 0);
  }, 0);
};

const getSpecialAvailabilityHoursForPeriod = (
  data: ParsedData,
  emp: EmployeeData,
  kind: SpecialShiftKind
) => {
  if (!isQualifiedForSpecialShift(emp, kind)) {
    return 0;
  }

  let availableDays = 0;

  for (const weekId of getWeekOrder(data.days)) {
    const requirement = data.weeklyWebRequirements?.[weekId];
    if (!requirement) continue;

    const allowedDays =
      kind === 'web' ? requirement.webShiftDays : requirement.webRevisionDays;
    const preference =
      kind === 'web'
        ? requirement.webShiftTimePreference
        : requirement.webRevisionTimePreference;

    availableDays += countAvailableSpecialDays(emp, allowedDays, preference, data.closedDays);
  }

  return availableDays * HOURS_PER_SHIFT;
};

const getDemandHoursByGroup = (data: ParsedData) => {
  const activeDayCount = data.days.filter(day => !data.closedDays.includes(day)).length;
  const normalDemand = activeDayCount * 2 * NORMAL_SHIFT_CAPACITY * HOURS_PER_SHIFT;

  let webDemand = 0;
  let revisionDemand = 0;

  for (const weekId of getWeekOrder(data.days)) {
    const requirement = data.weeklyWebRequirements?.[weekId];
    if (!requirement) continue;

    webDemand += requirement.webShifts * HOURS_PER_SHIFT;
    revisionDemand += requirement.webRevisionShifts * HOURS_PER_SHIFT;
  }

  return {
    total: normalDemand + webDemand + revisionDemand,
    normal: normalDemand,
    web: webDemand,
    revision: revisionDemand,
  };
};

const getAssignedShiftGroup = (shift: AssignedShift): AssignedFairnessGroup => {
  if (shift.isWebRevision) return 'revision';
  if (shift.isWeb) return 'web';
  return 'normal';
};

const createEmptyFairnessEmployeeReport = (): ScheduleFairnessEmployeeReport => ({
  total: null,
  normal: null,
  web: null,
  revision: null,
});

const createFairnessState = (
  data: ParsedData,
  planningTargets: PlanningTargets,
  employeeSchedules: Record<string, AssignedShift[]>
): FairnessState => {
  const groupDemand = getDemandHoursByGroup(data);
  const contractHoursForPeriod =
    planningTargets.weekOrder.length > 0
      ? Math.max(...data.employees.map(employee => getContractHoursForPeriod(planningTargets, employee)), 0)
      : 0;
  const groups = Object.fromEntries(
    FAIRNESS_GROUP_ORDER.map(group => [
      group,
      {
        demandHours: groupDemand[group],
        lambda: FAIRNESS_GROUP_WEIGHTS[group],
        sumClaims: 0,
        claimHoursByEmployee: createHoursMap(data.employees),
        targetHoursByEmployee: createHoursMap(data.employees),
        assignedHoursByEmployee: createHoursMap(data.employees),
        employeeNames: [] as string[],
      },
    ])
  ) as Record<FairnessGroupKey, FairnessGroupState>;

  for (const employee of data.employees) {
    const totals = getPeriodTotals(planningTargets, employee);
    const contractHoursForEmployee = getContractHoursForPeriod(planningTargets, employee);
    const sharedLimit = Math.min(
      totals.preferred,
      totals.max,
      contractHoursForEmployee
    );
    const claimByGroup: Record<FairnessGroupKey, number> = {
      total: Math.min(totals.available, sharedLimit),
      normal: employee.isWebOnly ? 0 : Math.min(totals.available, sharedLimit),
      web: Math.min(getSpecialAvailabilityHoursForPeriod(data, employee, 'web'), sharedLimit),
      revision: Math.min(
        getSpecialAvailabilityHoursForPeriod(data, employee, 'revision'),
        sharedLimit
      ),
    };

    for (const group of FAIRNESS_GROUP_ORDER) {
      groups[group].claimHoursByEmployee[employee.name] =
        claimByGroup[group] > EPSILON ? claimByGroup[group] : 0;
    }

    for (const shift of employeeSchedules[employee.name] ?? []) {
      groups.total.assignedHoursByEmployee[employee.name] += HOURS_PER_SHIFT;
      groups[getAssignedShiftGroup(shift)].assignedHoursByEmployee[employee.name] += HOURS_PER_SHIFT;
    }
  }

  for (const group of FAIRNESS_GROUP_ORDER) {
    const state = groups[group];
    state.sumClaims = Object.values(state.claimHoursByEmployee).reduce(
      (sum, claimHours) => sum + claimHours,
      0
    );

    if (state.demandHours <= EPSILON || state.sumClaims <= EPSILON) {
      state.employeeNames = [];
      continue;
    }

    state.employeeNames = data.employees
      .map(employee => employee.name)
      .filter(employeeName => state.claimHoursByEmployee[employeeName] > EPSILON);

    for (const employeeName of state.employeeNames) {
      state.targetHoursByEmployee[employeeName] =
        (state.demandHours * state.claimHoursByEmployee[employeeName]) / state.sumClaims;
    }
  }

  return {
    contractHoursForPeriod,
    groups,
  };
};

const getFairnessContribution = (
  groupState: FairnessGroupState,
  employeeName: string,
  assignedHours: number
) => {
  const targetHours = groupState.targetHoursByEmployee[employeeName] ?? 0;
  if (targetHours <= EPSILON) return 0;
  const loadRatio = assignedHours / targetHours;
  return (loadRatio - 1) * (loadRatio - 1);
};

const buildEmployeeFairnessMetrics = (
  groupState: FairnessGroupState,
  employeeName: string
): FairnessEmployeeMetrics | null => {
  const claimHours = groupState.claimHoursByEmployee[employeeName] ?? 0;
  const targetHours = groupState.targetHoursByEmployee[employeeName] ?? 0;

  if (
    groupState.demandHours <= EPSILON ||
    groupState.sumClaims <= EPSILON ||
    claimHours <= EPSILON ||
    targetHours <= EPSILON
  ) {
    return null;
  }

  const assignedHours = groupState.assignedHoursByEmployee[employeeName] ?? 0;
  const loadRatio = assignedHours / targetHours;
  return {
    claimHours,
    assignedHours,
    targetHours,
    loadRatio,
    penalty: (loadRatio - 1) * (loadRatio - 1),
  };
};

export const calculateJainIndex = (values: number[]) => {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  const sumSquares = values.reduce((total, value) => total + value * value, 0);
  if (sumSquares <= EPSILON) return null;
  return (sum * sum) / (values.length * sumSquares);
};

export const calculateGiniCoefficient = (values: number[]) => {
  if (values.length === 0) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (mean <= EPSILON) return null;

  let totalDiff = 0;
  for (const left of values) {
    for (const right of values) {
      totalDiff += Math.abs(left - right);
    }
  }

  return totalDiff / (2 * values.length * values.length * mean);
};

export const calculateCoefficientOfVariation = (values: number[]) => {
  if (values.length === 0) return null;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  if (mean <= EPSILON) return null;

  const variance =
    values.reduce((total, value) => total + (value - mean) * (value - mean), 0) / values.length;
  return Math.sqrt(variance) / mean;
};

const buildFairnessReportFromState = (
  data: ParsedData,
  fairnessState: FairnessState,
  plannerMode: PlannerMode
): ScheduleFairnessReport => {
  const employees = Object.fromEntries(
    data.employees.map(employee => [employee.name, createEmptyFairnessEmployeeReport()])
  ) as Record<string, ScheduleFairnessEmployeeReport>;

  const groups = Object.fromEntries(
    FAIRNESS_GROUP_ORDER.map(group => [
      group,
      {
        demandHours: fairnessState.groups[group].demandHours,
        activeEmployees: 0,
        sumClaims: fairnessState.groups[group].sumClaims,
        penalty: 0,
        jainIndex: null,
        gini: null,
        cv: null,
        employeeNames: [] as string[],
      },
    ])
  ) as Record<FairnessGroupKey, FairnessGroupReport>;

  for (const employee of data.employees) {
    for (const group of FAIRNESS_GROUP_ORDER) {
      employees[employee.name][group] = buildEmployeeFairnessMetrics(
        fairnessState.groups[group],
        employee.name
      );
    }
  }

  for (const group of FAIRNESS_GROUP_ORDER) {
    const metrics = fairnessState.groups[group].employeeNames
      .map(employeeName => employees[employeeName][group])
      .filter((entry): entry is FairnessEmployeeMetrics => entry !== null);

    const loadRatios = metrics.map(metric => metric.loadRatio);
    groups[group] = {
      demandHours: fairnessState.groups[group].demandHours,
      activeEmployees: metrics.length,
      sumClaims: fairnessState.groups[group].sumClaims,
      penalty: metrics.reduce((total, metric) => total + metric.penalty, 0),
      jainIndex: calculateJainIndex(loadRatios),
      gini: calculateGiniCoefficient(loadRatios),
      cv: calculateCoefficientOfVariation(loadRatios),
      employeeNames: fairnessState.groups[group].employeeNames,
    };
  }

  const totalPenalty = FAIRNESS_GROUP_ORDER.reduce(
    (total, group) => total + groups[group].penalty * FAIRNESS_GROUP_WEIGHTS[group],
    0
  );

  return {
    plannerMode,
    contractHoursForPeriod: fairnessState.contractHoursForPeriod,
    totalPenalty,
    groups,
    employees,
  };
};

export const getFairnessReport = (
  data: ParsedData,
  result: Pick<ScheduleResult, 'employeeSchedules'> & Partial<Pick<ScheduleResult, 'plannerMode'>>,
  plannerMode: PlannerMode = result.plannerMode ?? 'fairness'
): ScheduleFairnessReport => {
  const planningTargets = buildPlanningTargets(data);
  const fairnessState = createFairnessState(data, planningTargets, result.employeeSchedules);
  return buildFairnessReportFromState(data, fairnessState, plannerMode);
};

const createScheduleStats = (
  data: ParsedData,
  planningTargets: PlanningTargets
): ScheduleResult['stats'] => {
  const stats: ScheduleResult['stats'] = {};

  for (const employee of data.employees) {
    let totalPreferredHours = 0;
    let totalMaxHours = 0;
    const weeklyAssignedHours: Record<string, number> = {};

    for (const weekId of planningTargets.weekOrder) {
      totalPreferredHours += planningTargets.byEmployee[employee.name][weekId].preferred;
      totalMaxHours += planningTargets.byEmployee[employee.name][weekId].max;
      weeklyAssignedHours[weekId] = 0;
    }

    stats[employee.name] = {
      totalAssignedHours: 0,
      totalPreferredHours,
      totalMaxHours,
      preferredHoursPerWeek: employee.preferredHours,
      weeklyAssignedHours,
    };
  }

  return stats;
};

export function buildScheduleResultFromAssignments(
  data: ParsedData,
  employeeSchedules: Record<string, AssignedShift[]>,
  unfilledCounts: ScheduleUnfilledCounts = createEmptyUnfilledCounts(data.days),
  plannerMode: PlannerMode = 'fairness'
): ScheduleResult {
  const planningTargets = buildPlanningTargets(data);
  const dayOrder = new Map(data.days.map((day, index) => [day, index]));
  const schedule: ScheduleResult['employeeSchedules'] = {};
  const stats = createScheduleStats(data, planningTargets);

  for (const employee of data.employees) {
    const normalizedShifts = [...(employeeSchedules[employee.name] ?? [])].sort((left, right) => {
      const dayDiff =
        (dayOrder.get(left.day) ?? Number.MAX_SAFE_INTEGER) -
        (dayOrder.get(right.day) ?? Number.MAX_SAFE_INTEGER);
      if (dayDiff !== 0) return dayDiff;
      if (left.type !== right.type) return left.type === 'Morning' ? -1 : 1;
      const leftPriority = left.isWebRevision ? 2 : left.isWeb ? 1 : 0;
      const rightPriority = right.isWebRevision ? 2 : right.isWeb ? 1 : 0;
      return leftPriority - rightPriority;
    });

    schedule[employee.name] = normalizedShifts;

    for (const shift of normalizedShifts) {
      const weekId = getWeekId(shift.day);
      stats[employee.name].totalAssignedHours += HOURS_PER_SHIFT;
      stats[employee.name].weeklyAssignedHours[weekId] =
        (stats[employee.name].weeklyAssignedHours[weekId] ?? 0) + HOURS_PER_SHIFT;
    }
  }

  const emptyCounts = createEmptyUnfilledCounts(data.days);
  const fairnessReport = buildFairnessReportFromState(
    data,
    createFairnessState(data, planningTargets, schedule),
    plannerMode
  );

  return {
    plannerMode,
    employeeSchedules: schedule,
    unfilledNormalShifts: { ...emptyCounts.normal, ...unfilledCounts.normal },
    unfilledWebShifts: { ...emptyCounts.web, ...unfilledCounts.web },
    unfilledWebRevisionShifts: { ...emptyCounts.revision, ...unfilledCounts.revision },
    fairnessReport,
    stats,
  };
}

export const isWorking = (
  schedule: Record<string, AssignedShift[]>,
  empName: string,
  day: string,
  shiftType: ShiftType
) => schedule[empName].some(shift => shift.day === day && shift.type === shiftType);

export const isWorkingOnDay = (
  schedule: Record<string, AssignedShift[]>,
  empName: string,
  day: string
) => schedule[empName].some(shift => shift.day === day);

export const getShiftForEmployee = (
  schedule: Record<string, AssignedShift[]>,
  empName: string,
  day: string,
  shiftType: ShiftType
) => schedule[empName].find(shift => shift.day === day && shift.type === shiftType);

export const hasSpecialShiftOnDay = (
  schedule: Record<string, AssignedShift[]>,
  empName: string,
  day: string
) => schedule[empName].some(shift => shift.day === day && (shift.isWeb || shift.isWebRevision));

export const getSpecialShiftCountForEmployeeOnDay = (
  schedule: Record<string, AssignedShift[]>,
  empName: string,
  day: string
) => schedule[empName].filter(shift => shift.day === day && (shift.isWeb || shift.isWebRevision)).length;

export const getNormalShiftCount = (
  schedule: Record<string, AssignedShift[]>,
  day: string,
  shiftType: ShiftType
) => {
  let count = 0;
  for (const empName in schedule) {
    if (
      schedule[empName].some(
        shift => shift.day === day && shift.type === shiftType && !shift.isWeb && !shift.isWebRevision
      )
    ) {
      count++;
    }
  }
  return count;
};

export const getSpecialShiftCount = (
  schedule: Record<string, AssignedShift[]>,
  day: string,
  shiftType: ShiftType,
  kind: SpecialShiftKind
) => {
  let count = 0;
  for (const empName in schedule) {
    if (
      schedule[empName].some(
        shift =>
          shift.day === day &&
          shift.type === shiftType &&
          (kind === 'web' ? shift.isWeb : shift.isWebRevision)
      )
    ) {
      count++;
    }
  }
  return count;
};

export const getAssignedHoursUntilWeek = (
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

export const getRemainingNormalAvailabilityCount = (
  ctx: PlannerContext,
  emp: EmployeeData,
  weekId: string
) => {
  const daysInWeek = ctx.activeDays.filter(day => getWeekId(day) === weekId);
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

export const hasRoomForShift = (
  ctx: PlannerContext,
  emp: EmployeeData,
  weekId: string,
  hours: number = HOURS_PER_SHIFT,
  ignoreMax: boolean = false
) => {
  if (ignoreMax) return true;
  return (ctx.stats[emp.name].weeklyAssignedHours[weekId] || 0) + hours <= getMaxHours(emp, weekId);
};

const applyFairnessHoursDelta = (
  fairnessState: FairnessState,
  employeeName: string,
  group: FairnessGroupKey,
  deltaHours: number
) => {
  const current = fairnessState.groups[group].assignedHoursByEmployee[employeeName] ?? 0;
  const next = current + deltaHours;
  fairnessState.groups[group].assignedHoursByEmployee[employeeName] = next > EPSILON ? next : 0;
};

const applyFairnessDeltas = (fairnessState: FairnessState, deltas: FairnessDelta[]) => {
  for (const delta of deltas) {
    if (Math.abs(delta.deltaHours) <= EPSILON) continue;
    applyFairnessHoursDelta(fairnessState, delta.employeeName, delta.group, delta.deltaHours);
  }
};

const createAssignmentFairnessDeltas = (
  employeeName: string,
  group: AssignedFairnessGroup
): FairnessDelta[] => [
  { employeeName, group: 'total', deltaHours: HOURS_PER_SHIFT },
  { employeeName, group, deltaHours: HOURS_PER_SHIFT },
];

const createReclassificationFairnessDeltas = (
  employeeName: string,
  fromGroup: AssignedFairnessGroup,
  toGroup: AssignedFairnessGroup
): FairnessDelta[] => {
  if (fromGroup === toGroup) return [];
  return [
    { employeeName, group: fromGroup, deltaHours: -HOURS_PER_SHIFT },
    { employeeName, group: toGroup, deltaHours: HOURS_PER_SHIFT },
  ];
};

const getProjectedFairnessDelta = (ctx: PlannerContext, deltas: FairnessDelta[]) => {
  const groupedByEmployee = new Map<FairnessGroupKey, Map<string, number>>();

  for (const delta of deltas) {
    if (!groupedByEmployee.has(delta.group)) {
      groupedByEmployee.set(delta.group, new Map<string, number>());
    }
    const byEmployee = groupedByEmployee.get(delta.group)!;
    byEmployee.set(delta.employeeName, (byEmployee.get(delta.employeeName) ?? 0) + delta.deltaHours);
  }

  let deltaPenalty = 0;

  for (const [group, byEmployee] of groupedByEmployee.entries()) {
    const groupState = ctx.fairness.groups[group];
    if (!groupState || groupState.lambda <= EPSILON) continue;

    for (const [employeeName, deltaHours] of byEmployee.entries()) {
      const currentAssigned = groupState.assignedHoursByEmployee[employeeName] ?? 0;
      const beforePenalty = getFairnessContribution(groupState, employeeName, currentAssigned);
      const afterPenalty = getFairnessContribution(
        groupState,
        employeeName,
        currentAssigned + deltaHours
      );
      deltaPenalty += groupState.lambda * (afterPenalty - beforePenalty);
    }
  }

  return deltaPenalty;
};

const getProjectedFairnessDeltaForSlot = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  targetGroup: AssignedFairnessGroup
) => {
  const currentShift = getShiftForEmployee(ctx.schedule, emp.name, day, shiftType);
  if (!currentShift) {
    return getProjectedFairnessDelta(ctx, createAssignmentFairnessDeltas(emp.name, targetGroup));
  }

  return getProjectedFairnessDelta(
    ctx,
    createReclassificationFairnessDeltas(emp.name, getAssignedShiftGroup(currentShift), targetGroup)
  );
};

export const setShiftClassification = (
  shift: AssignedShift,
  group: AssignedFairnessGroup
) => {
  shift.isWeb = group === 'web';
  shift.isWebRevision = group === 'revision';
};

export const reclassifyAssignedShift = (
  ctx: PlannerContext,
  employeeName: string,
  shift: AssignedShift,
  nextGroup: AssignedFairnessGroup
) => {
  const currentGroup = getAssignedShiftGroup(shift);
  if (currentGroup === nextGroup) return;

  applyFairnessDeltas(
    ctx.fairness,
    createReclassificationFairnessDeltas(employeeName, currentGroup, nextGroup)
  );
  setShiftClassification(shift, nextGroup);
};

export const assignShift = (
  ctx: PlannerContext,
  empName: string,
  day: string,
  type: ShiftType,
  isWeb: boolean,
  isWebRevision: boolean = false
) => {
  const group: AssignedFairnessGroup = isWebRevision ? 'revision' : isWeb ? 'web' : 'normal';

  ctx.schedule[empName].push({ day, type, isWeb, isWebRevision });
  ctx.stats[empName].totalAssignedHours += HOURS_PER_SHIFT;

  const weekId = getWeekId(day);
  ctx.stats[empName].weeklyAssignedHours[weekId] += HOURS_PER_SHIFT;
  applyFairnessDeltas(ctx.fairness, createAssignmentFairnessDeltas(empName, group));
};

export const getShiftCandidateCount = (
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
    if ((purpose === 'web' || purpose === 'revision') && hasSpecialShiftOnDay(ctx.schedule, emp.name, day)) {
      return false;
    }
    if (!hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT, ignoreMax)) return false;
    return true;
  }).length;
};

export const getTimePreferenceStages = (
  preference: 'Morning' | 'Afternoon' | 'Any'
): ShiftType[][] => {
  if (preference === 'Morning') return [['Morning'], ['Afternoon']];
  if (preference === 'Afternoon') return [['Afternoon'], ['Morning']];
  return [['Morning', 'Afternoon']];
};

export const isQualifiedForSpecialShift = (emp: EmployeeData, kind: SpecialShiftKind) => {
  if (kind === 'revision') return !!emp.isWebRevision;
  return !!(emp.isWeb || emp.isWebOnly);
};

export const getOrderedSpecialDays = (
  ctx: PlannerContext,
  allowedDays: string[],
  shiftTypes: ShiftType[],
  purpose: SpecialShiftKind
) =>
  [...allowedDays].sort((left, right) => {
    const bestLeft = Math.max(...shiftTypes.map(type => getShiftCandidateCount(ctx, left, type, purpose)), 0);
    const bestRight = Math.max(
      ...shiftTypes.map(type => getShiftCandidateCount(ctx, right, type, purpose)),
      0
    );
    return bestLeft - bestRight;
  });

export const createPlannerContext = (
  data: ParsedData,
  plannerMode: PlannerMode = 'fairness'
): PlannerContext => {
  const planningTargets = buildPlanningTargets(data);
  const schedule = Object.fromEntries(
    data.employees.map(employee => [employee.name, []])
  ) as Record<string, AssignedShift[]>;
  const stats = createScheduleStats(data, planningTargets);

  return {
    data,
    employees: data.employees,
    schedule,
    stats,
    activeDays: data.days.filter(day => !data.closedDays.includes(day)),
    planningTargets,
    fairness: createFairnessState(data, planningTargets, schedule),
    plannerMode,
  };
};

export const getEmployeePressure = (ctx: PlannerContext, emp: EmployeeData, weekId: string) => {
  const targets = ctx.planningTargets.byEmployee[emp.name][weekId];
  const assignedThisWeek = ctx.stats[emp.name].weeklyAssignedHours[weekId] || 0;
  const assignedUntilNow = getAssignedHoursUntilWeek(
    ctx.stats,
    emp.name,
    ctx.planningTargets.weekOrder,
    weekId
  );
  const cumulativeMinimum = ctx.planningTargets.cumulativeMinimum[emp.name][weekId] || 0;
  const weekMinimumDebt = Math.max(0, targets.minimum - assignedThisWeek);
  const cumulativeMinimumDebt = Math.max(0, cumulativeMinimum - assignedUntilNow);
  const remainingNormalAvailability = getRemainingNormalAvailabilityCount(ctx, emp, weekId);
  const weekMinimumNeedRatio =
    targets.minimum > 0 ? weekMinimumDebt / Math.max(HOURS_PER_SHIFT, targets.minimum) : 0;
  const cumulativeMinimumNeedRatio =
    cumulativeMinimum > 0
      ? cumulativeMinimumDebt / Math.max(HOURS_PER_SHIFT, cumulativeMinimum)
      : 0;
  const weekExtraAboveMinimum = Math.max(0, assignedThisWeek - targets.minimum);
  const cumulativeExtraAboveMinimum = Math.max(0, assignedUntilNow - cumulativeMinimum);
  const lastChanceShiftPressure = Math.max(
    0,
    Math.ceil(weekMinimumDebt / HOURS_PER_SHIFT) - remainingNormalAvailability
  );
  const weekIndex = ctx.planningTargets.weekOrder.indexOf(weekId);
  const previousWeekId = weekIndex > 0 ? ctx.planningTargets.weekOrder[weekIndex - 1] : null;
  const previousWeekAssigned = previousWeekId
    ? (ctx.stats[emp.name].weeklyAssignedHours[previousWeekId] || 0)
    : 0;
  const previousWeekPreferred = previousWeekId
    ? ctx.planningTargets.byEmployee[emp.name][previousWeekId].preferred
    : 0;
  const previousWeekOverRatio = previousWeekId
    ? Math.max(0, previousWeekAssigned - previousWeekPreferred) /
      Math.max(HOURS_PER_SHIFT, previousWeekPreferred || HOURS_PER_SHIFT)
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

export const getFullDayCompletionBonus = (
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

  if (alreadyOther && priority >= 2) {
    score += 36 + priority * 14;
  } else if (!alreadyAny && priority >= 4 && purpose !== 'revision') {
    score -= 12 + priority * 4;
  }

  return score;
};

export const getModeWeights = () => ({
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
});

const scoreNormalCandidateBase = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  forceFill: boolean,
  hoursDelta: number
) => {
  const weekId = getWeekId(day);
  const weights = getModeWeights();
  const pressure = getEmployeePressure(ctx, emp, weekId);
  const scarcity = Math.max(0, 6 - getShiftCandidateCount(ctx, day, shiftType, 'normal', forceFill));
  const projectedAssignedThisWeek = pressure.assignedThisWeek + hoursDelta;
  const projectedAssignedUntilNow = pressure.assignedUntilNow + hoursDelta;
  const weeklyOverPreferred = Math.max(0, projectedAssignedThisWeek - pressure.preferredTarget);
  const weeklyOverMax = Math.max(0, projectedAssignedThisWeek - pressure.maxTarget);
  const cumulativeOverPreferred = Math.max(
    0,
    projectedAssignedUntilNow - (ctx.planningTargets.cumulativePreferred[emp.name][weekId] || 0)
  );

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
    if (projectedAssignedThisWeek > pressure.maxTarget) {
      score -= 360;
    }
  } else {
    score -= weeklyOverPreferred * (weights.overPreferred * 1.2);
    score -= cumulativeOverPreferred * (weights.overPreferred * 0.6);
    score -= weeklyOverMax * (weights.overMax * 1.45);
    if (projectedAssignedThisWeek > pressure.maxTarget) {
      score -= 180;
    }
  }

  return score;
};

const scoreNormalCandidate = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  forceFill: boolean
) => {
  const currentShift = getShiftForEmployee(ctx.schedule, emp.name, day, shiftType);
  const hoursDelta = currentShift ? 0 : HOURS_PER_SHIFT;
  const fairnessDelta = getProjectedFairnessDeltaForSlot(ctx, emp, day, shiftType, 'normal');
  return (
    scoreNormalCandidateBase(ctx, emp, day, shiftType, forceFill, hoursDelta) -
    fairnessDelta * FAIRNESS_DELTA_SCORE_WEIGHT +
    Math.random() * getModeWeights().noise
  );
};

const scoreWebCandidateBase = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  isRevision: boolean,
  hoursDelta: number
) => {
  const weekId = getWeekId(day);
  const weights = getModeWeights();
  const pressure = getEmployeePressure(ctx, emp, weekId);
  const scarcity = Math.max(
    0,
    5 - getShiftCandidateCount(ctx, day, shiftType, isRevision ? 'revision' : 'web')
  );
  const normalScarcity = Math.max(0, 5 - getShiftCandidateCount(ctx, day, shiftType, 'normal'));
  const projectedAssignedThisWeek = pressure.assignedThisWeek + hoursDelta;
  const projectedAssignedUntilNow = pressure.assignedUntilNow + hoursDelta;
  const weeklyOverPreferred = Math.max(0, projectedAssignedThisWeek - pressure.preferredTarget);
  const cumulativeOverPreferred = Math.max(
    0,
    projectedAssignedUntilNow - (ctx.planningTargets.cumulativePreferred[emp.name][weekId] || 0)
  );
  const weeklyOverMax = Math.max(0, projectedAssignedThisWeek - pressure.maxTarget);

  let score = 0;
  score += pressure.weekMinimumNeedRatio * (weights.weekMinimum * 1.3);
  score += pressure.cumulativeMinimumNeedRatio * weights.cumulativeMinimum;
  score -= pressure.weekExtraAboveMinimum * weights.weekFairness;
  score -= pressure.cumulativeExtraAboveMinimum * weights.cumulativeFairness;
  score += scarcity * (weights.scarcity + 6);
  score += getFullDayCompletionBonus(
    ctx,
    emp,
    day,
    shiftType,
    isRevision ? 'revision' : 'web'
  ) * weights.fullDay;

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

  if (projectedAssignedThisWeek > pressure.maxTarget) {
    score -= 280;
  }

  return score;
};

const scoreWebCandidate = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  isRevision: boolean
) => {
  const targetGroup: AssignedFairnessGroup = isRevision ? 'revision' : 'web';
  const currentShift = getShiftForEmployee(ctx.schedule, emp.name, day, shiftType);
  const hoursDelta = currentShift ? 0 : HOURS_PER_SHIFT;
  const fairnessDelta = getProjectedFairnessDeltaForSlot(
    ctx,
    emp,
    day,
    shiftType,
    targetGroup
  );

  return (
    scoreWebCandidateBase(ctx, emp, day, shiftType, isRevision, hoursDelta) -
    fairnessDelta * FAIRNESS_DELTA_SCORE_WEIGHT +
    Math.random() * getModeWeights().noise
  );
};

function scoreSchedule(result: ScheduleResult, data: ParsedData): number {
  let score = 0;
  const planningTargets = buildPlanningTargets(data);

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
    for (const emp of data.employees) {
      const targets = planningTargets.byEmployee[emp.name][weekId];
      const assignedWeek = result.stats[emp.name].weeklyAssignedHours[weekId] || 0;
      const assignedUntilWeek = getAssignedHoursUntilWeek(
        result.stats,
        emp.name,
        planningTargets.weekOrder,
        weekId
      );
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
      }

      if (assignedUntilWeek > cumulativePreferred) {
        score -= (assignedUntilWeek - cumulativePreferred) * 60;
      }
    }
  }

  score -= result.fairnessReport.totalPenalty * FAIRNESS_SCORE_WEIGHT;
  score -= getScheduleAbsoluteHoursGini(data, result) * ABSOLUTE_HOURS_GINI_SCORE_WEIGHT;

  for (const emp of data.employees) {
    const shifts = result.employeeSchedules[emp.name];
    const dayMap = new Map<string, AssignedShift[]>();
    for (const shift of shifts) {
      if (!dayMap.has(shift.day)) dayMap.set(shift.day, []);
      dayMap.get(shift.day)!.push(shift);
    }

    for (const shiftsOnDay of dayMap.values()) {
      const normalCount = shiftsOnDay.filter(shift => !shift.isWeb && !shift.isWebRevision).length;
      const totalCount = shiftsOnDay.length;
      if (totalCount >= 2 && getFullDayPriority(emp) >= 2) {
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

const getSpecialCandidateScore = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  type: ShiftType,
  kind: SpecialShiftKind
) =>
  scoreWebCandidate(ctx, emp, day, type, kind === 'revision') +
  (emp.isWebOnly ? 1200 : 0);

const getAllowedRelocationOptions = (
  data: ParsedData,
  shift: AssignedShift,
  kind: AssignedFairnessGroup
) => {
  if (kind === 'normal') {
    return { days: [shift.day], types: [shift.type] };
  }

  const weekId = getWeekId(shift.day);
  const requirement = data.weeklyWebRequirements?.[weekId];
  if (!requirement) return { days: [] as string[], types: [] as ShiftType[] };

  const days =
    kind === 'web' ? requirement.webShiftDays : requirement.webRevisionDays;
  const preference =
    kind === 'web'
      ? requirement.webShiftTimePreference
      : requirement.webRevisionTimePreference;
  const types = Array.from(new Set(getTimePreferenceStages(preference).flat()));

  return {
    days: days.filter(day => getWeekId(day) === weekId && !data.closedDays.includes(day)),
    types,
  };
};

const cloneEmployeeSchedules = (result: ScheduleResult) =>
  Object.fromEntries(
    Object.entries(result.employeeSchedules).map(([employeeName, shifts]) => [
      employeeName,
      shifts.map(shift => ({ ...shift })),
    ])
  ) as Record<string, AssignedShift[]>;

const getScheduleAbsoluteHoursGini = (data: ParsedData, result: ScheduleResult) =>
  calculateGiniCoefficient(
    data.employees.map(employee => result.stats[employee.name]?.totalAssignedHours ?? 0)
  ) ?? 0;

const getProjectedAbsoluteHoursGiniAfterMove = (
  data: ParsedData,
  result: ScheduleResult,
  fromEmployeeName: string,
  toEmployeeName: string
) =>
  calculateGiniCoefficient(
    data.employees.map(employee => {
      const assignedHours = result.stats[employee.name]?.totalAssignedHours ?? 0;
      if (employee.name === fromEmployeeName) return assignedHours - HOURS_PER_SHIFT;
      if (employee.name === toEmployeeName) return assignedHours + HOURS_PER_SHIFT;
      return assignedHours;
    })
  ) ?? 0;

const getProjectedTotalPenaltyAfterMove = (
  result: ScheduleResult,
  fromEmployeeName: string,
  toEmployeeName: string
) => {
  const fromMetric = result.fairnessReport.employees[fromEmployeeName]?.total;
  const toMetric = result.fairnessReport.employees[toEmployeeName]?.total;
  if (!fromMetric || !toMetric) return result.fairnessReport.totalPenalty;

  const contribution = (metric: FairnessEmployeeMetrics, assignedHours: number) => {
    if (metric.targetHours <= EPSILON) return 0;
    const loadRatio = assignedHours / metric.targetHours;
    return (loadRatio - 1) * (loadRatio - 1);
  };

  const before =
    contribution(fromMetric, fromMetric.assignedHours) +
    contribution(toMetric, toMetric.assignedHours);
  const after =
    contribution(fromMetric, fromMetric.assignedHours - HOURS_PER_SHIFT) +
    contribution(toMetric, toMetric.assignedHours + HOURS_PER_SHIFT);

  return result.fairnessReport.totalPenalty - before + after;
};

const canReceiveRelocatedShift = (
  data: ParsedData,
  result: ScheduleResult,
  employee: EmployeeData,
  day: string,
  type: ShiftType,
  kind: AssignedFairnessGroup
) => {
  const weekId = getWeekId(day);

  if (kind === 'normal' && employee.isWebOnly) return false;
  if (kind !== 'normal' && !isQualifiedForSpecialShift(employee, kind)) return false;
  if (!isAvailable(employee, day, type, data.closedDays)) return false;
  if (isWorking(result.employeeSchedules, employee.name, day, type)) return false;
  if (kind !== 'normal' && hasSpecialShiftOnDay(result.employeeSchedules, employee.name, day)) {
    return false;
  }
  return (
    (result.stats[employee.name].weeklyAssignedHours[weekId] || 0) + HOURS_PER_SHIFT <=
    getMaxHours(employee, weekId)
  );
};

const rebalanceShiftsForTotalFairness = (
  data: ParsedData,
  initialResult: ScheduleResult
) => {
  let currentResult = initialResult;

  for (let iteration = 0; iteration < 40; iteration++) {
    let bestMove:
      | {
          fromEmployeeName: string;
          fromShiftIndex: number;
          toEmployee: EmployeeData;
          day: string;
          type: ShiftType;
          kind: AssignedFairnessGroup;
          projectedPenalty: number;
          secondaryGain: number;
        }
      | null = null;

    for (const fromEmployee of data.employees) {
      const shifts = currentResult.employeeSchedules[fromEmployee.name] ?? [];

      for (let shiftIndex = 0; shiftIndex < shifts.length; shiftIndex++) {
        const shift = shifts[shiftIndex];
        const kind = getAssignedShiftGroup(shift);

        const { days, types } = getAllowedRelocationOptions(data, shift, kind);
        if (days.length === 0 || types.length === 0) continue;

        for (const day of days) {
          for (const type of types) {
            for (const toEmployee of data.employees) {
              if (toEmployee.name === fromEmployee.name) continue;
              if (
                !canReceiveRelocatedShift(
                  data,
                  currentResult,
                  toEmployee,
                  day,
                  type,
                  kind
                )
              ) {
                continue;
              }

              const projectedPenalty = getProjectedTotalPenaltyAfterMove(
                currentResult,
                fromEmployee.name,
                toEmployee.name
              );
              const secondaryGain =
                kind !== 'normal'
                  ? Number(!!toEmployee.isWebOnly) - Number(!!fromEmployee.isWebOnly)
                  : 0;
              const improvesPenalty =
                projectedPenalty + EPSILON < currentResult.fairnessReport.totalPenalty;
              const improvesTieBreak =
                Math.abs(projectedPenalty - currentResult.fairnessReport.totalPenalty) <=
                  EPSILON && secondaryGain > 0;

              if (
                (improvesPenalty || improvesTieBreak) &&
                (!bestMove ||
                  projectedPenalty + EPSILON < bestMove.projectedPenalty ||
                  (Math.abs(projectedPenalty - bestMove.projectedPenalty) <= EPSILON &&
                    secondaryGain > bestMove.secondaryGain))
              ) {
                bestMove = {
                  fromEmployeeName: fromEmployee.name,
                  fromShiftIndex: shiftIndex,
                  toEmployee,
                  day,
                  type,
                  kind,
                  projectedPenalty,
                  secondaryGain,
                };
              }
            }
          }
        }
      }
    }

    if (!bestMove) break;

    const nextSchedules = cloneEmployeeSchedules(currentResult);
    nextSchedules[bestMove.fromEmployeeName].splice(bestMove.fromShiftIndex, 1);
    nextSchedules[bestMove.toEmployee.name].push({
      day: bestMove.day,
      type: bestMove.type,
      isWeb: bestMove.kind === 'web',
      isWebRevision: bestMove.kind === 'revision',
    });

    currentResult = buildScheduleResultFromAssignments(
      data,
      nextSchedules,
      {
        normal: currentResult.unfilledNormalShifts,
        web: currentResult.unfilledWebShifts,
        revision: currentResult.unfilledWebRevisionShifts,
      },
      currentResult.plannerMode
    );
  }

  return currentResult;
};

const getAbsoluteHoursRebalancePenaltyCeiling = (initialPenalty: number) =>
  initialPenalty +
  Math.max(
    ABSOLUTE_HOURS_REBALANCE_MIN_PENALTY_HEADROOM,
    initialPenalty * ABSOLUTE_HOURS_REBALANCE_MAX_PENALTY_GROWTH_RATIO
  );

const getAbsoluteHoursRebalanceObjective = (
  data: ParsedData,
  result: ScheduleResult,
  absoluteHoursGini: number = getScheduleAbsoluteHoursGini(data, result)
) =>
  result.fairnessReport.totalPenalty +
  absoluteHoursGini * ABSOLUTE_HOURS_GINI_REBALANCE_WEIGHT;

const rebalanceShiftsForAbsoluteHours = (
  data: ParsedData,
  initialResult: ScheduleResult
) => {
  let currentResult = initialResult;
  const penaltyCeiling = getAbsoluteHoursRebalancePenaltyCeiling(
    initialResult.fairnessReport.totalPenalty
  );

  for (let iteration = 0; iteration < 40; iteration++) {
    const currentGini = getScheduleAbsoluteHoursGini(data, currentResult);
    const currentObjective = getAbsoluteHoursRebalanceObjective(
      data,
      currentResult,
      currentGini
    );
    let bestMove:
      | {
          fromEmployeeName: string;
          fromShiftIndex: number;
          toEmployee: EmployeeData;
          day: string;
          type: ShiftType;
          kind: AssignedFairnessGroup;
          projectedPenalty: number;
          projectedGini: number;
          projectedObjective: number;
          secondaryGain: number;
        }
      | null = null;

    for (const fromEmployee of data.employees) {
      const shifts = currentResult.employeeSchedules[fromEmployee.name] ?? [];

      for (let shiftIndex = 0; shiftIndex < shifts.length; shiftIndex++) {
        const shift = shifts[shiftIndex];
        const kind = getAssignedShiftGroup(shift);
        const { days, types } = getAllowedRelocationOptions(data, shift, kind);
        if (days.length === 0 || types.length === 0) continue;

        for (const day of days) {
          for (const type of types) {
            for (const toEmployee of data.employees) {
              if (toEmployee.name === fromEmployee.name) continue;
              if (
                !canReceiveRelocatedShift(
                  data,
                  currentResult,
                  toEmployee,
                  day,
                  type,
                  kind
                )
              ) {
                continue;
              }

              const projectedGini = getProjectedAbsoluteHoursGiniAfterMove(
                data,
                currentResult,
                fromEmployee.name,
                toEmployee.name
              );
              if (projectedGini + EPSILON >= currentGini) continue;

              const projectedPenalty = getProjectedTotalPenaltyAfterMove(
                currentResult,
                fromEmployee.name,
                toEmployee.name
              );
              if (projectedPenalty > penaltyCeiling + EPSILON) continue;

              const projectedObjective =
                projectedPenalty +
                projectedGini * ABSOLUTE_HOURS_GINI_REBALANCE_WEIGHT;
              if (projectedObjective + EPSILON >= currentObjective) continue;

              const secondaryGain =
                kind !== 'normal'
                  ? Number(!!toEmployee.isWebOnly) - Number(!!fromEmployee.isWebOnly)
                  : 0;

              if (
                !bestMove ||
                projectedObjective + EPSILON < bestMove.projectedObjective ||
                (Math.abs(projectedObjective - bestMove.projectedObjective) <= EPSILON &&
                  (projectedGini + EPSILON < bestMove.projectedGini ||
                    (Math.abs(projectedGini - bestMove.projectedGini) <= EPSILON &&
                      secondaryGain > bestMove.secondaryGain)))
              ) {
                bestMove = {
                  fromEmployeeName: fromEmployee.name,
                  fromShiftIndex: shiftIndex,
                  toEmployee,
                  day,
                  type,
                  kind,
                  projectedPenalty,
                  projectedGini,
                  projectedObjective,
                  secondaryGain,
                };
              }
            }
          }
        }
      }
    }

    if (!bestMove) break;

    const nextSchedules = cloneEmployeeSchedules(currentResult);
    nextSchedules[bestMove.fromEmployeeName].splice(bestMove.fromShiftIndex, 1);
    nextSchedules[bestMove.toEmployee.name].push({
      day: bestMove.day,
      type: bestMove.type,
      isWeb: bestMove.kind === 'web',
      isWebRevision: bestMove.kind === 'revision',
    });

    currentResult = buildScheduleResultFromAssignments(
      data,
      nextSchedules,
      {
        normal: currentResult.unfilledNormalShifts,
        web: currentResult.unfilledWebShifts,
        revision: currentResult.unfilledWebRevisionShifts,
      },
      currentResult.plannerMode
    );
  }

  return currentResult;
};

const findBestRequiredSpecialCandidate = (
  ctx: PlannerContext,
  weekId: string,
  allowedDays: string[],
  shiftTypes: ShiftType[],
  kind: SpecialShiftKind
): ScoredSpecialCandidate | null => {
  let best: ScoredSpecialCandidate | null = null;

  for (const day of getOrderedSpecialDays(ctx, allowedDays, shiftTypes, kind)) {
    for (const type of shiftTypes) {
      const candidatePool = ctx.employees.filter(emp => {
        if (!isQualifiedForSpecialShift(emp, kind)) return false;
        if (!isAvailable(emp, day, type, ctx.data.closedDays)) return false;
        if (isWorking(ctx.schedule, emp.name, day, type)) return false;
        if (hasSpecialShiftOnDay(ctx.schedule, emp.name, day)) return false;
        if (!hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT)) return false;
        return true;
      });

      const prioritizedPool = [
        ...candidatePool.filter(emp => emp.isWebOnly),
        ...candidatePool.filter(emp => !emp.isWebOnly),
      ];

      for (const emp of prioritizedPool) {
        const score = getSpecialCandidateScore(ctx, emp, day, type, kind);
        if (!best || score > best.score) {
          best = { emp, day, type, score };
        }
      }
    }
  }

  return best;
};

const tryAssignOptionalSpecialInStage = (
  ctx: PlannerContext,
  weekId: string,
  allowedDays: string[],
  shiftTypes: ShiftType[],
  kind: SpecialShiftKind
) => {
  const idleCandidate = findBestRequiredSpecialCandidate(ctx, weekId, allowedDays, shiftTypes, kind);
  if (idleCandidate) {
    assignShift(
      ctx,
      idleCandidate.emp.name,
      idleCandidate.day,
      idleCandidate.type,
      kind === 'web',
      kind === 'revision'
    );
    return true;
  }

  let bestConversion: SpecialConversionCandidate | null = null;

  for (const day of getOrderedSpecialDays(ctx, allowedDays, shiftTypes, kind)) {
    for (const type of shiftTypes) {
      const normalWorkers = ctx.employees.filter(emp => {
        if (emp.isWebOnly) return false;
        if (!isQualifiedForSpecialShift(emp, kind)) return false;
        if (hasSpecialShiftOnDay(ctx.schedule, emp.name, day)) return false;
        const shift = getShiftForEmployee(ctx.schedule, emp.name, day, type);
        return !!shift && !shift.isWeb && !shift.isWebRevision;
      });

      for (const worker of normalWorkers) {
        const replacementCandidates = ctx.employees.filter(emp => {
          if (emp.name === worker.name || emp.isWebOnly) return false;
          if (!isAvailable(emp, day, type, ctx.data.closedDays)) return false;
          if (isWorking(ctx.schedule, emp.name, day, type)) return false;
          return hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT);
        });

        for (const replacement of replacementCandidates) {
          const specialBaseScore = scoreWebCandidateBase(
            ctx,
            worker,
            day,
            type,
            kind === 'revision',
            0
          );
          const replacementBaseScore = scoreNormalCandidateBase(
            ctx,
            replacement,
            day,
            type,
            true,
            HOURS_PER_SHIFT
          );
          const fairnessDelta = getProjectedFairnessDelta(ctx, [
            ...createReclassificationFairnessDeltas(worker.name, 'normal', kind),
            ...createAssignmentFairnessDeltas(replacement.name, 'normal'),
          ]);
          const score =
            specialBaseScore +
            replacementBaseScore -
            fairnessDelta * FAIRNESS_DELTA_SCORE_WEIGHT +
            Math.random() * getModeWeights().noise;

          if (!bestConversion || score > bestConversion.score) {
            bestConversion = {
              worker,
              replacement,
              day,
              type,
              score,
            };
          }
        }
      }
    }
  }

  if (!bestConversion) return false;

  const shift = getShiftForEmployee(
    ctx.schedule,
    bestConversion.worker.name,
    bestConversion.day,
    bestConversion.type
  );
  if (!shift) return false;

  reclassifyAssignedShift(ctx, bestConversion.worker.name, shift, kind);
  assignShift(ctx, bestConversion.replacement.name, bestConversion.day, bestConversion.type, false, false);
  return true;
};

export function generateSingleSchedule(data: ParsedData): ScheduleResult {
  const ctx = createPlannerContext(data, 'fairness');
  const { employees, schedule, activeDays, planningTargets } = ctx;

  const unfilledNormalShifts: ScheduleResult['unfilledNormalShifts'] = {};
  const unfilledWebShifts: ScheduleResult['unfilledWebShifts'] = {};
  const unfilledWebRevisionShifts: ScheduleResult['unfilledWebRevisionShifts'] = {};

  for (const day of data.days) {
    unfilledNormalShifts[day] = { morning: 0, afternoon: 0 };
    unfilledWebShifts[day] = { morning: 0, afternoon: 0 };
    unfilledWebRevisionShifts[day] = { morning: 0, afternoon: 0 };
  }

  const assignPreferredSpecialShifts = (
    weekId: string,
    count: number,
    allowedDays: string[],
    timePreference: 'Morning' | 'Afternoon' | 'Any',
    kind: SpecialShiftKind
  ) => {
    let remaining = count;
    const stages = getTimePreferenceStages(timePreference);

    while (remaining > 0) {
      let best: ScoredSpecialCandidate | null = null;
      for (const stage of stages) {
        best = findBestRequiredSpecialCandidate(ctx, weekId, allowedDays, stage, kind);
        if (best) break;
      }

      if (!best) break;

      assignShift(
        ctx,
        best.emp.name,
        best.day,
        best.type,
        kind === 'web',
        kind === 'revision'
      );
      remaining--;
    }

    return remaining;
  };

  for (const weekId of planningTargets.weekOrder) {
    const requirement = data.weeklyWebRequirements?.[weekId];
    if (!requirement) continue;

    const allowedRevisionDays = requirement.webRevisionDays.filter(
      day => getWeekId(day) === weekId && !data.closedDays.includes(day)
    );
    assignPreferredSpecialShifts(
      weekId,
      requirement.webRevisionShifts,
      allowedRevisionDays,
      requirement.webRevisionTimePreference,
      'revision'
    );

    const allowedWebDays = requirement.webShiftDays.filter(
      day => getWeekId(day) === weekId && !data.closedDays.includes(day)
    );
    assignPreferredSpecialShifts(
      weekId,
      requirement.webShifts,
      allowedWebDays,
      requirement.webShiftTimePreference,
      'web'
    );
  }

  const assignNormalByMinimumGoal = (weekId: string) => {
    const daysInWeek = activeDays.filter(day => getWeekId(day) === weekId);
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
    const daysInWeek = activeDays.filter(day => getWeekId(day) === weekId);
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
    const daysInWeek = activeDays.filter(day => getWeekId(day) === weekId);
    const shiftSlots = daysInWeek.flatMap(day =>
      (['Morning', 'Afternoon'] as ShiftType[]).map(type => ({ day, type }))
    );
    shiftSlots.sort((left, right) => {
      const leftCount = getShiftCandidateCount(ctx, left.day, left.type, 'normal', true);
      const rightCount = getShiftCandidateCount(ctx, right.day, right.type, 'normal', true);
      return leftCount - rightCount;
    });

    for (const slot of shiftSlots) {
      while (getNormalShiftCount(schedule, slot.day, slot.type) < NORMAL_SHIFT_CAPACITY) {
        const availableEmployees = employees.filter(emp => {
          if (emp.isWebOnly) return false;
          if (!isAvailable(emp, slot.day, slot.type, data.closedDays)) return false;
          if (isWorking(schedule, emp.name, slot.day, slot.type)) return false;
          return hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT);
        });

        if (availableEmployees.length === 0) break;

        let bestEmployee = availableEmployees[0];
        let bestScore = -Infinity;

        for (const emp of availableEmployees) {
          const score = scoreNormalCandidate(ctx, emp, slot.day, slot.type, true);
          if (score > bestScore) {
            bestScore = score;
            bestEmployee = emp;
          }
        }

        assignShift(ctx, bestEmployee.name, slot.day, slot.type, false, false);
      }

      let missing = NORMAL_SHIFT_CAPACITY - getNormalShiftCount(schedule, slot.day, slot.type);
      if (missing > 0) {
        const workersOnSpecial = employees.filter(emp => {
          if (emp.isWebOnly) return false;
          const shift = getShiftForEmployee(schedule, emp.name, slot.day, slot.type);
          return !!shift && (shift.isWeb || shift.isWebRevision);
        });

        workersOnSpecial.sort(
          (left, right) =>
            scoreNormalCandidate(ctx, left, slot.day, slot.type, true) -
            scoreNormalCandidate(ctx, right, slot.day, slot.type, true)
        );

        for (const emp of workersOnSpecial) {
          if (missing <= 0) break;
          const shift = getShiftForEmployee(schedule, emp.name, slot.day, slot.type);
          if (!shift) continue;
          reclassifyAssignedShift(ctx, emp.name, shift, 'normal');
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
    const requirement = data.weeklyWebRequirements?.[weekId];
    if (!requirement) continue;

    const allowedWebDays = requirement.webShiftDays.filter(
      day => getWeekId(day) === weekId && !data.closedDays.includes(day)
    );
    const allowedRevisionDays = requirement.webRevisionDays.filter(
      day => getWeekId(day) === weekId && !data.closedDays.includes(day)
    );

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
      kind: SpecialShiftKind,
      targetCount: number,
      allowedDays: string[],
      preference: 'Morning' | 'Afternoon' | 'Any'
    ) => {
      let remaining = targetCount;
      const stages = getTimePreferenceStages(preference);

      while (remaining > 0) {
        let assigned = false;
        for (const stage of stages) {
          if (tryAssignOptionalSpecialInStage(ctx, weekId, allowedDays, stage, kind)) {
            assigned = true;
            remaining--;
            break;
          }
        }
        if (!assigned) break;
      }

      return remaining;
    };

    const remainingWeb = fillOptionalSpecialShifts(
      'web',
      Math.max(0, requirement.webShifts - assignedWeb),
      allowedWebDays,
      requirement.webShiftTimePreference
    );
    const remainingRevision = fillOptionalSpecialShifts(
      'revision',
      Math.max(0, requirement.webRevisionShifts - assignedRevision),
      allowedRevisionDays,
      requirement.webRevisionTimePreference
    );

    if (remainingWeb > 0) {
      const day = allowedWebDays[0] ?? activeDays.find(activeDay => getWeekId(activeDay) === weekId);
      if (day) {
        if (requirement.webShiftTimePreference === 'Afternoon') {
          unfilledWebShifts[day].afternoon += remainingWeb;
        } else {
          unfilledWebShifts[day].morning += remainingWeb;
        }
      }
    }

    if (remainingRevision > 0) {
      const day =
        allowedRevisionDays[0] ?? activeDays.find(activeDay => getWeekId(activeDay) === weekId);
      if (day) {
        if (requirement.webRevisionTimePreference === 'Afternoon') {
          unfilledWebRevisionShifts[day].afternoon += remainingRevision;
        } else {
          unfilledWebRevisionShifts[day].morning += remainingRevision;
        }
      }
    }
  }

  for (const emp of employees) {
    const byDay = new Map<string, AssignedShift[]>();
    for (const shift of schedule[emp.name]) {
      if (!byDay.has(shift.day)) byDay.set(shift.day, []);
      byDay.get(shift.day)!.push(shift);
    }

    for (const shiftsOnDay of byDay.values()) {
      const specialShifts = shiftsOnDay.filter(shift => shift.isWeb || shift.isWebRevision);
      if (specialShifts.length <= 1) continue;

      specialShifts.sort((left, right) => {
        const leftPriority = left.isWebRevision ? 2 : 1;
        const rightPriority = right.isWebRevision ? 2 : 1;
        return rightPriority - leftPriority;
      });

      for (const shift of specialShifts.slice(1)) {
        setShiftClassification(shift, 'normal');
      }
    }
  }

  return rebalanceShiftsForTotalFairness(
    data,
    buildScheduleResultFromAssignments(
      data,
      schedule,
      {
        normal: unfilledNormalShifts,
        web: unfilledWebShifts,
        revision: unfilledWebRevisionShifts,
      },
      'fairness'
    )
  );
}
