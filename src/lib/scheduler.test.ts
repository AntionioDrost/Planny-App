import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeParsedData,
  type EmployeeData,
  type ParsedData,
  type WeeklyWebRequirement,
} from './parser';
import { deserializeSavedRosterSnapshot } from './scheduleEditor';
import {
  assignShift,
  buildScheduleResultFromAssignments,
  createPlannerContext,
  generateSchedule,
  getFairnessReport,
  getFullDayCompletionBonus,
  HOURS_PER_SHIFT,
  type AssignedShift,
} from './scheduler';

const DAY_ONE = '[15] 06 - 10 April [Tuesday]';
const DAY_TWO = '[15] 07 - 10 April [Wednesday]';
const DAY_THREE = '[16] 13 - 17 April [Monday]';

const createAvailability = (days: string[], value: string = '9:00-17:00') =>
  Object.fromEntries(days.map(day => [day, value]));

const createEmployee = (name: string, overrides: Partial<EmployeeData> = {}): EmployeeData => ({
  name,
  availability: createAvailability([DAY_ONE]),
  isWeb: false,
  isWebRevision: false,
  isWebOnly: false,
  contractHours: 8,
  preferredHours: 8,
  maxHours: 8,
  weeklyPreferredHoursOverride: {},
  weeklyMaxHoursOverride: {},
  fullDayPriority: 1,
  ...overrides,
});

const createRequirement = (
  overrides: Partial<WeeklyWebRequirement> = {}
): WeeklyWebRequirement => ({
  webShifts: 0,
  webShiftDays: [],
  webShiftTimePreference: 'Any',
  webRevisionShifts: 0,
  webRevisionDays: [],
  webRevisionTimePreference: 'Any',
  ...overrides,
});

const createData = (
  employees: EmployeeData[],
  days: string[] = [DAY_ONE],
  requirementOverrides: Record<string, Partial<WeeklyWebRequirement>> = {}
): ParsedData => {
  const weekIds = Array.from(
    new Set(
      days.map(day => {
        const match = day.match(/^\[(.*?)\]/);
        return match ? match[1] : 'default';
      })
    )
  );

  return {
    days,
    closedDays: [],
    employees,
    weeklyWebRequirements: Object.fromEntries(
      weekIds.map(weekId => [weekId, createRequirement(requirementOverrides[weekId])])
    ),
    rosterYear: 2026,
  };
};

const createShift = (
  day: string,
  type: 'Morning' | 'Afternoon',
  kind: 'normal' | 'web' | 'revision' = 'normal'
): AssignedShift => ({
  day,
  type,
  isWeb: kind === 'web',
  isWebRevision: kind === 'revision',
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fairness report', () => {
  it('calculates proportional entitlement from equal claims', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
    ];

    const result = buildScheduleResultFromAssignments(createData(employees, days), {
      A: [],
      B: [],
    });

    expect(result.fairnessReport.groups.total.demandHours).toBe(16);
    expect(result.fairnessReport.employees.A.total?.targetHours).toBeCloseTo(8, 5);
    expect(result.fairnessReport.employees.B.total?.targetHours).toBeCloseTo(8, 5);
  });

  it('calculates load ratios from assigned versus target hours', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
    ];

    const result = buildScheduleResultFromAssignments(createData(employees, days), {
      A: [createShift(DAY_ONE, 'Morning'), createShift(DAY_ONE, 'Afternoon')],
      B: [createShift(DAY_ONE, 'Morning'), createShift(DAY_ONE, 'Afternoon')],
    });

    expect(result.fairnessReport.employees.A.total?.assignedHours).toBe(8);
    expect(result.fairnessReport.employees.A.total?.loadRatio).toBeCloseTo(1, 5);
    expect(result.fairnessReport.employees.B.total?.penalty).toBeCloseTo(0, 5);
  });

  it('uses total-hours fairness as the optimizer penalty', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
    ];

    const result = buildScheduleResultFromAssignments(createData(employees, days), {
      A: [createShift(DAY_ONE, 'Morning')],
      B: [],
    });

    expect(result.fairnessReport.groups.total.penalty).toBeGreaterThan(0);
    expect(result.fairnessReport.totalPenalty).toBeCloseTo(
      result.fairnessReport.groups.total.penalty,
      5
    );
  });

  it('keeps web fairness diagnostic-only in totalPenalty', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 16,
        maxHours: 16,
      }),
    ];

    const result = buildScheduleResultFromAssignments(
      createData(employees, days, {
        '15': {
          webShifts: 1,
          webShiftDays: [DAY_ONE],
          webShiftTimePreference: 'Morning',
        },
      }),
      {
        A: [createShift(DAY_ONE, 'Morning', 'web')],
        B: [],
      }
    );

    expect(result.fairnessReport.groups.web.penalty).toBeGreaterThan(0);
    expect(result.fairnessReport.totalPenalty).toBeCloseTo(
      result.fairnessReport.groups.total.penalty,
      5
    );
  });

  it('keeps revision fairness diagnostic-only in totalPenalty', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        isWebRevision: true,
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        isWebRevision: true,
        preferredHours: 16,
        maxHours: 16,
      }),
    ];

    const result = buildScheduleResultFromAssignments(
      createData(employees, days, {
        '15': {
          webRevisionShifts: 1,
          webRevisionDays: [DAY_ONE],
          webRevisionTimePreference: 'Morning',
        },
      }),
      {
        A: [createShift(DAY_ONE, 'Morning', 'revision')],
        B: [],
      }
    );

    expect(result.fairnessReport.groups.revision.penalty).toBeGreaterThan(0);
    expect(result.fairnessReport.totalPenalty).toBeCloseTo(
      result.fairnessReport.groups.total.penalty,
      5
    );
  });

  it('skips fairness groups when demand exists but no qualified capacity is available', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', { availability: createAvailability(days) }),
      createEmployee('B', { availability: createAvailability(days) }),
    ];
    const result = buildScheduleResultFromAssignments(
      createData(employees, days, {
        '15': {
          webShifts: 1,
          webShiftDays: [DAY_ONE],
          webShiftTimePreference: 'Morning',
        },
      }),
      {
        A: [],
        B: [],
      }
    );

    expect(result.fairnessReport.groups.web.demandHours).toBe(HOURS_PER_SHIFT);
    expect(result.fairnessReport.groups.web.activeEmployees).toBe(0);
    expect(result.fairnessReport.groups.web.jainIndex).toBeNull();
    expect(result.fairnessReport.employees.A.web).toBeNull();
  });

  it('reflects per-week contract hours across a multi-week period', () => {
    const days = [DAY_ONE, DAY_THREE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        preferredHours: 24,
        maxHours: 24,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        preferredHours: 24,
        maxHours: 24,
      }),
    ];

    const report = getFairnessReport(
      createData(employees, days),
      buildScheduleResultFromAssignments(createData(employees, days), { A: [], B: [] })
    );

    expect(report.contractHoursForPeriod).toBe(16);
    expect(report.employees.A.total?.claimHours).toBe(16);
    expect(report.employees.A.total?.targetHours).toBeCloseTo(16, 5);
  });

  it('prefers giving the next hours to the employee who is behind on the fair share', () => {
    const days = [DAY_ONE, DAY_TWO];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
    ];
    const data = createData(employees, days);

    const assignToLeader = buildScheduleResultFromAssignments(data, {
      A: [
        createShift(DAY_ONE, 'Morning'),
        createShift(DAY_ONE, 'Afternoon'),
        createShift(DAY_TWO, 'Morning'),
      ],
      B: [],
    });
    const assignToLagging = buildScheduleResultFromAssignments(data, {
      A: [createShift(DAY_ONE, 'Morning'), createShift(DAY_ONE, 'Afternoon')],
      B: [createShift(DAY_TWO, 'Morning')],
    });

    expect(assignToLagging.fairnessReport.totalPenalty).toBeLessThan(
      assignToLeader.fairnessReport.totalPenalty
    );
  });

  it('improves total fairness when a web shift goes to the employee behind on total hours', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 16,
        maxHours: 16,
      }),
    ];
    const data = createData(employees, days, {
      '15': {
        webShifts: 1,
        webShiftDays: [DAY_ONE],
        webShiftTimePreference: 'Afternoon',
      },
    });

    const assignToLeader = buildScheduleResultFromAssignments(data, {
      A: [createShift(DAY_ONE, 'Morning'), createShift(DAY_ONE, 'Afternoon', 'web')],
      B: [],
    });
    const assignToLagging = buildScheduleResultFromAssignments(data, {
      A: [createShift(DAY_ONE, 'Morning')],
      B: [createShift(DAY_ONE, 'Afternoon', 'web')],
    });

    expect(assignToLagging.fairnessReport.totalPenalty).toBeLessThan(
      assignToLeader.fairnessReport.totalPenalty
    );
    expect(assignToLagging.fairnessReport.totalPenalty).toBeCloseTo(
      assignToLagging.fairnessReport.groups.total.penalty,
      5
    );
  });

  it('can relocate special shifts within allowed times to improve total-hours fairness', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY_ONE];
    const employees = [
      createEmployee('Under Web Only', {
        availability: createAvailability(days, '9:00-13:00'),
        isWeb: true,
        isWebOnly: true,
        preferredHours: 8,
        maxHours: 8,
      }),
      createEmployee('Over Web', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 8,
        maxHours: 8,
      }),
      createEmployee('Morning Normal', {
        availability: createAvailability(days, '9:00-13:00'),
        preferredHours: 4,
        maxHours: 4,
      }),
      createEmployee('Afternoon Normal A', {
        availability: createAvailability(days, '13:00-17:00'),
        preferredHours: 4,
        maxHours: 4,
      }),
      createEmployee('Afternoon Normal B', {
        availability: createAvailability(days, '13:00-17:00'),
        preferredHours: 4,
        maxHours: 4,
      }),
    ];

    const result = generateSchedule(
      createData(employees, days, {
        '15': {
          webShifts: 1,
          webShiftDays: [DAY_ONE],
          webShiftTimePreference: 'Afternoon',
        },
      }),
      1,
      'fairness'
    );

    expect(result.employeeSchedules['Under Web Only']).toContainEqual(
      createShift(DAY_ONE, 'Morning', 'web')
    );
    expect(result.employeeSchedules['Over Web']).toContainEqual(
      createShift(DAY_ONE, 'Morning')
    );
    expect(result.unfilledNormalShifts[DAY_ONE].morning).toBe(0);
    expect(result.unfilledNormalShifts[DAY_ONE].afternoon).toBe(0);
    expect(result.unfilledWebShifts[DAY_ONE].morning).toBe(0);
    expect(result.unfilledWebShifts[DAY_ONE].afternoon).toBe(0);
  });

  it('only includes qualified employees in web fairness', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('Webber', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('Normal', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
    ];

    const result = buildScheduleResultFromAssignments(
      createData(employees, days, {
        '15': {
          webShifts: 1,
          webShiftDays: [DAY_ONE],
          webShiftTimePreference: 'Morning',
        },
      }),
      {
        Webber: [createShift(DAY_ONE, 'Morning', 'web')],
        Normal: [],
      }
    );

    expect(result.fairnessReport.groups.web.activeEmployees).toBe(1);
    expect(result.fairnessReport.employees.Webber.web).not.toBeNull();
    expect(result.fairnessReport.employees.Normal.web).toBeNull();
  });

  it('keeps web and revision diagnostic metrics available from getFairnessReport', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('Webber', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('Reviewer', {
        availability: createAvailability(days),
        isWebRevision: true,
        preferredHours: 16,
        maxHours: 16,
      }),
    ];
    const data = createData(employees, days, {
      '15': {
        webShifts: 1,
        webShiftDays: [DAY_ONE],
        webShiftTimePreference: 'Morning',
        webRevisionShifts: 1,
        webRevisionDays: [DAY_ONE],
        webRevisionTimePreference: 'Afternoon',
      },
    });

    const report = getFairnessReport(data, {
      employeeSchedules: {
        Webber: [createShift(DAY_ONE, 'Morning', 'web')],
        Reviewer: [createShift(DAY_ONE, 'Afternoon', 'revision')],
      },
    });

    expect(report.groups.web.demandHours).toBe(HOURS_PER_SHIFT);
    expect(report.groups.revision.demandHours).toBe(HOURS_PER_SHIFT);
    expect(report.groups.web.activeEmployees).toBe(1);
    expect(report.groups.revision.activeEmployees).toBe(1);
    expect(report.employees.Webber.web).not.toBeNull();
    expect(report.employees.Reviewer.revision).not.toBeNull();
  });
});

describe('normalization and snapshots', () => {
  it('defaults contractHours to 8 when normalizing employee data', () => {
    const data = normalizeParsedData({
      days: [DAY_ONE],
      closedDays: [],
      employees: [
        {
          ...createEmployee('A'),
          contractHours: undefined as unknown as number,
        },
      ],
      weeklyWebRequirements: { '15': createRequirement() },
      rosterYear: 2026,
    });

    expect(data.employees[0].contractHours).toBe(8);
  });

  it('normalizes old saved snapshots without contract hours or fairness report', () => {
    const raw = JSON.stringify({
      version: 1,
      savedAt: '2026-04-24T10:00:00.000Z',
      data: {
        days: [DAY_ONE],
        closedDays: [],
        employees: [
          {
            name: 'A',
            availability: { [DAY_ONE]: '9:00-17:00' },
            isWeb: false,
            isWebRevision: false,
            isWebOnly: false,
            preferredHours: 8,
            maxHours: 8,
            weeklyPreferredHoursOverride: { '15': null },
            weeklyMaxHoursOverride: { '15': null },
            fullDayPriority: 1,
          },
        ],
        weeklyWebRequirements: { '15': createRequirement() },
        rosterYear: 2026,
      },
      generatedSchedule: {
        employeeSchedules: { A: [] },
        unfilledNormalShifts: { [DAY_ONE]: { morning: 0, afternoon: 0 } },
        unfilledWebShifts: { [DAY_ONE]: { morning: 0, afternoon: 0 } },
        unfilledWebRevisionShifts: { [DAY_ONE]: { morning: 0, afternoon: 0 } },
        stats: {
          A: {
            totalAssignedHours: 0,
            totalPreferredHours: 8,
            totalMaxHours: 8,
            preferredHoursPerWeek: 8,
            weeklyAssignedHours: { '15': 0 },
          },
        },
      },
      schedule: {
        employeeSchedules: { A: [] },
        unfilledNormalShifts: { [DAY_ONE]: { morning: 0, afternoon: 0 } },
        unfilledWebShifts: { [DAY_ONE]: { morning: 0, afternoon: 0 } },
        unfilledWebRevisionShifts: { [DAY_ONE]: { morning: 0, afternoon: 0 } },
        stats: {
          A: {
            totalAssignedHours: 0,
            totalPreferredHours: 8,
            totalMaxHours: 8,
            preferredHoursPerWeek: 8,
            weeklyAssignedHours: { '15': 0 },
          },
        },
      },
    });

    const snapshot = deserializeSavedRosterSnapshot(raw);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.data.employees[0].contractHours).toBe(8);
    expect(snapshot?.generatedSchedule.plannerMode).toBe('fairness');
    expect(snapshot?.schedule.fairnessReport.totalPenalty).toBeGreaterThanOrEqual(0);
  });
});

describe('legacy vs fairness', () => {
  it('only gives full-day candidate weighting to employees with priority 2 or higher', () => {
    const days = [DAY_ONE];
    const employees = [
      createEmployee('Priority One', {
        availability: createAvailability(days),
        fullDayPriority: 1,
        preferredHours: 8,
        maxHours: 8,
      }),
      createEmployee('Priority Two', {
        availability: createAvailability(days),
        fullDayPriority: 2,
        preferredHours: 8,
        maxHours: 8,
      }),
    ];
    const ctx = createPlannerContext(createData(employees, days), 'fairness');

    assignShift(ctx, 'Priority One', DAY_ONE, 'Morning', false, false);
    assignShift(ctx, 'Priority Two', DAY_ONE, 'Morning', false, false);

    expect(
      getFullDayCompletionBonus(ctx, employees[0], DAY_ONE, 'Afternoon', 'normal')
    ).toBe(0);
    expect(
      getFullDayCompletionBonus(ctx, employees[1], DAY_ONE, 'Afternoon', 'normal')
    ).toBeGreaterThan(0);
  });

  it('does not give default priority employees a full-day scheduling preference', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY_ONE];
    const employees = [
      createEmployee('A', {
        availability: createAvailability(days),
        fullDayPriority: 1,
        preferredHours: 8,
        maxHours: 8,
      }),
      createEmployee('B', {
        availability: createAvailability(days),
        fullDayPriority: 1,
        preferredHours: 8,
        maxHours: 8,
      }),
    ];

    const result = generateSchedule(createData(employees, days), 1, 'fairness');

    expect(result.employeeSchedules.A).toHaveLength(2);
    expect(result.employeeSchedules.B).toHaveLength(2);
  });

  it('keeps or improves fairness relative to the legacy planner on a deterministic scenario', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY_ONE, DAY_TWO];
    const employees = [
      createEmployee('High Preference', {
        availability: createAvailability(days),
        preferredHours: 24,
        maxHours: 24,
        contractHours: 8,
      }),
      createEmployee('Peer A', {
        availability: createAvailability(days),
        preferredHours: 8,
        maxHours: 24,
        contractHours: 8,
      }),
      createEmployee('Peer B', {
        availability: createAvailability(days),
        preferredHours: 8,
        maxHours: 24,
        contractHours: 8,
      }),
    ];
    const data = createData(employees, days);

    const fairness = generateSchedule(data, 1, 'fairness');
    const legacy = generateSchedule(data, 1, 'legacy');

    const fairnessUnfilled =
      fairness.unfilledNormalShifts[DAY_ONE].morning +
      fairness.unfilledNormalShifts[DAY_ONE].afternoon +
      fairness.unfilledNormalShifts[DAY_TWO].morning +
      fairness.unfilledNormalShifts[DAY_TWO].afternoon;
    const legacyUnfilled =
      legacy.unfilledNormalShifts[DAY_ONE].morning +
      legacy.unfilledNormalShifts[DAY_ONE].afternoon +
      legacy.unfilledNormalShifts[DAY_TWO].morning +
      legacy.unfilledNormalShifts[DAY_TWO].afternoon;

    expect(fairness.fairnessReport.totalPenalty).toBeLessThanOrEqual(
      legacy.fairnessReport.totalPenalty
    );
    expect(fairnessUnfilled).toBeLessThanOrEqual(legacyUnfilled);
  });

  it('keeps special-shift constraints intact for both planners', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY_ONE, DAY_TWO];
    const employees = [
      createEmployee('Specialist', {
        availability: createAvailability(days),
        isWeb: true,
        isWebRevision: true,
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('Support', {
        availability: createAvailability(days),
        isWeb: true,
        preferredHours: 16,
        maxHours: 16,
      }),
      createEmployee('Normal', {
        availability: createAvailability(days),
        preferredHours: 16,
        maxHours: 16,
      }),
    ];
    const data = createData(employees, days, {
      '15': {
        webShifts: 1,
        webShiftDays: [DAY_ONE, DAY_TWO],
        webShiftTimePreference: 'Any',
        webRevisionShifts: 1,
        webRevisionDays: [DAY_ONE, DAY_TWO],
        webRevisionTimePreference: 'Any',
      },
    });

    for (const mode of ['fairness', 'legacy'] as const) {
      const result = generateSchedule(data, 1, mode);
      for (const employee of employees) {
        const specialsByDay = result.employeeSchedules[employee.name].reduce<Record<string, number>>(
          (counts, shift) => {
            if (shift.isWeb || shift.isWebRevision) {
              counts[shift.day] = (counts[shift.day] ?? 0) + 1;
            }
            return counts;
          },
          {}
        );

        expect(Object.values(specialsByDay).every(count => count <= 1)).toBe(true);
      }
    }
  });
});
