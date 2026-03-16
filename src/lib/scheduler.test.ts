import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmployeeData, ParsedData, WeeklyWebRequirement } from './parser';
import { generateSchedule, generateSingleSchedule, getMinimumHoursTarget } from './scheduler';

const DAY = '[15] 06 - 10 April [Tuesday]';
const DAY_TWO = '[15] 07 - 10 April [Wednesday]';
const DAY_THREE = '[15] 08 - 10 April [Thursday]';
const DAY_WEEK_TWO = '[16] 13 - 17 April [Monday]';
const DAY_WEEK_TWO_TWO = '[16] 14 - 17 April [Tuesday]';
const WEEK_ID = '15';

const createAvailability = (days: string[], value: string = '9:00-17:00') =>
  Object.fromEntries(days.map(day => [day, value]));

const createEmployee = (name: string, overrides: Partial<EmployeeData> = {}): EmployeeData => ({
  name,
  availability: { [DAY]: '9:00-17:00' },
  isWeb: false,
  isWebRevision: false,
  isWebOnly: false,
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
  requirementOverrides: Partial<WeeklyWebRequirement> = {},
  days: string[] = [DAY]
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
      weekIds.map(weekId => [weekId, createRequirement(requirementOverrides)])
    ),
    rosterYear: 2026,
  };
};

const countSpecialShifts = (employeeSchedules: ReturnType<typeof generateSingleSchedule>['employeeSchedules'], empName: string) =>
  employeeSchedules[empName].filter(shift => shift.isWeb || shift.isWebRevision);

const getUnfilledSpecialTotal = (result: ReturnType<typeof generateSingleSchedule>) =>
  result.unfilledWebShifts[DAY].morning +
  result.unfilledWebShifts[DAY].afternoon +
  result.unfilledWebRevisionShifts[DAY].morning +
  result.unfilledWebRevisionShifts[DAY].afternoon;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateSingleSchedule special shift day limits', () => {
  it('assigns at most one web shift per employee per day', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const webOnly = createEmployee('Web Only', {
      isWebOnly: true,
    });

    const result = generateSingleSchedule(
      createData([webOnly], {
        webShifts: 2,
        webShiftDays: [DAY],
        webShiftTimePreference: 'Morning',
      })
    );

    expect(countSpecialShifts(result.employeeSchedules, webOnly.name)).toHaveLength(1);
    expect(result.unfilledWebShifts[DAY].morning + result.unfilledWebShifts[DAY].afternoon).toBe(1);
  });

  it('counts web and revision together toward the per-day special cap', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const specialist = createEmployee('Specialist', {
      isWebOnly: true,
      isWebRevision: true,
    });

    const result = generateSingleSchedule(
      createData([specialist], {
        webShifts: 1,
        webShiftDays: [DAY],
        webShiftTimePreference: 'Afternoon',
        webRevisionShifts: 1,
        webRevisionDays: [DAY],
        webRevisionTimePreference: 'Morning',
      })
    );

    expect(countSpecialShifts(result.employeeSchedules, specialist.name)).toHaveLength(1);
    expect(getUnfilledSpecialTotal(result)).toBe(1);
  });

  it('still allows one normal shift plus one special shift on the same day', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const webber = createEmployee('Webber', {
      isWeb: true,
      fullDayPriority: 5,
    });
    const morningOnly = createEmployee('Morning Only', {
      availability: { [DAY]: '9:00-13:00' },
      preferredHours: 4,
      maxHours: 4,
    });
    const helper = createEmployee('Helper');

    const result = generateSingleSchedule(
      createData([webber, morningOnly, helper], {
        webShifts: 1,
        webShiftDays: [DAY],
        webShiftTimePreference: 'Morning',
      })
    );

    const shifts = result.employeeSchedules[webber.name];
    const specialShifts = shifts.filter(shift => shift.isWeb || shift.isWebRevision);
    const normalShifts = shifts.filter(shift => !shift.isWeb && !shift.isWebRevision);

    expect(shifts).toHaveLength(2);
    expect(specialShifts).toHaveLength(1);
    expect(normalShifts).toHaveLength(1);
    expect(shifts.every(shift => shift.day === DAY)).toBe(true);
  });

  it('does not schedule more web shifts in a week than configured', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const webOnly = createEmployee('Web Only', {
      isWebOnly: true,
      availability: {
        [DAY]: '9:00-17:00',
        [DAY_TWO]: '9:00-17:00',
      },
    });

    const result = generateSingleSchedule(
      createData(
        [webOnly],
        {
          webShifts: 1,
          webShiftDays: [DAY, DAY_TWO],
          webShiftTimePreference: 'Any',
        },
        [DAY, DAY_TWO]
      )
    );

    const webShifts = result.employeeSchedules[webOnly.name].filter(shift => shift.isWeb);
    expect(webShifts).toHaveLength(1);
  });
});

describe('preferred hour penalties', () => {
  it('uses preferred as the minimum target when preferred is below the weekly minimum', () => {
    const days = [DAY, DAY_TWO];
    const lowPreference = createEmployee('Low Preference', {
      availability: createAvailability(days),
      preferredHours: 4,
      maxHours: 16,
    });

    expect(getMinimumHoursTarget(lowPreference, WEEK_ID, days, [])).toBe(4);
  });

  it('does not give high-preferred employees automatic priority after minimum is met', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY, DAY_TWO, DAY_THREE];
    const sharedAvailability = createAvailability(days);
    const highPreference = createEmployee('High Preference', {
      availability: sharedAvailability,
      preferredHours: 40,
      maxHours: 24,
    });
    const peers = [
      createEmployee('Peer A', {
        availability: sharedAvailability,
        preferredHours: 8,
        maxHours: 24,
      }),
      createEmployee('Peer B', {
        availability: sharedAvailability,
        preferredHours: 8,
        maxHours: 24,
      }),
      createEmployee('Peer C', {
        availability: sharedAvailability,
        preferredHours: 8,
        maxHours: 24,
      }),
    ];

    const result = generateSingleSchedule(
      createData([highPreference, ...peers], {}, days)
    );

    const assignments = [highPreference, ...peers].map(
      employee => result.stats[employee.name].weeklyAssignedHours[WEEK_ID] || 0
    );
    const peerAssignments = peers.map(
      employee => result.stats[employee.name].weeklyAssignedHours[WEEK_ID] || 0
    );
    const highPreferenceAssigned = result.stats[highPreference.name].weeklyAssignedHours[WEEK_ID] || 0;

    expect(Math.max(...assignments) - Math.min(...assignments)).toBeLessThanOrEqual(4);
    expect(highPreferenceAssigned - Math.min(...peerAssignments)).toBeLessThanOrEqual(4);
  });

  it('can exceed preferred hours when normal coverage requires it', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY];
    const employees = [
      createEmployee('Coverage A', {
        availability: createAvailability(days),
        preferredHours: 4,
        maxHours: 8,
      }),
      createEmployee('Coverage B', {
        availability: createAvailability(days),
        preferredHours: 4,
        maxHours: 8,
      }),
    ];

    const result = generateSingleSchedule(createData(employees, {}, days));

    expect(result.unfilledNormalShifts[DAY].morning + result.unfilledNormalShifts[DAY].afternoon).toBe(0);
    for (const employee of employees) {
      expect(result.stats[employee.name].weeklyAssignedHours[WEEK_ID] || 0).toBeGreaterThan(employee.preferredHours);
    }
  });

  it('keeps cumulative extra hours balanced across weeks when preferred differs', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY, DAY_TWO, DAY_WEEK_TWO, DAY_WEEK_TWO_TWO];
    const sharedAvailability = createAvailability(days);
    const employees = [
      createEmployee('High Preference', {
        availability: sharedAvailability,
        preferredHours: 40,
        maxHours: 16,
      }),
      createEmployee('Peer A', {
        availability: sharedAvailability,
        preferredHours: 8,
        maxHours: 16,
      }),
      createEmployee('Peer B', {
        availability: sharedAvailability,
        preferredHours: 8,
        maxHours: 16,
      }),
    ];

    const result = generateSingleSchedule(createData(employees, {}, days));
    const highPreferenceAssigned = result.stats['High Preference'].totalAssignedHours;
    const peerAssignments = [
      result.stats['Peer A'].totalAssignedHours,
      result.stats['Peer B'].totalAssignedHours,
    ];

    expect(highPreferenceAssigned).toBeLessThanOrEqual(Math.max(...peerAssignments));
    expect(Math.max(...peerAssignments) - Math.min(...peerAssignments)).toBeLessThanOrEqual(4);
  });

  it('supports generateSchedule without an explicit iterations argument', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);

    const days = [DAY];
    const data = createData(
      [
        createEmployee('Planner A', {
          availability: createAvailability(days),
        }),
        createEmployee('Planner B', {
          availability: createAvailability(days),
        }),
      ],
      {},
      days
    );

    const result = generateSchedule(data);

    expect(result.employeeSchedules['Planner A']).toBeDefined();
    expect(result.employeeSchedules['Planner B']).toBeDefined();
    expect(result.stats['Planner A'].weeklyAssignedHours[WEEK_ID] || 0).toBeGreaterThanOrEqual(0);
    expect(result.stats['Planner B'].weeklyAssignedHours[WEEK_ID] || 0).toBeGreaterThanOrEqual(0);
  });
});
