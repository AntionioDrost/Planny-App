import type { ParsedData, EmployeeData } from './parser';
import {
  assignShift,
  buildPlanningTargets,
  buildScheduleResultFromAssignments,
  createPlannerContext,
  getAssignedHoursUntilWeek,
  getEmployeePressure,
  getFullDayCompletionBonus,
  getFullDayPriority,
  getModeWeights,
  getNormalShiftCount,
  getShiftCandidateCount,
  getShiftForEmployee,
  getTimePreferenceStages,
  getWeekId,
  getOrderedSpecialDays,
  hasRoomForShift,
  hasSpecialShiftOnDay,
  HOURS_PER_SHIFT,
  isAvailable,
  isQualifiedForSpecialShift,
  isWorking,
  NORMAL_SHIFT_CAPACITY,
  setShiftClassification,
  type AssignedShift,
  type PlannerContext,
  type ScheduleResult,
  type ShiftType,
  type SpecialShiftKind,
} from './scheduler';

const scoreLegacyNormalCandidate = (
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
  const cumulativeOverPreferred = Math.max(
    0,
    pressure.assignedUntilNow - (ctx.planningTargets.cumulativePreferred[emp.name][weekId] || 0)
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

const scoreLegacyWebCandidate = (
  ctx: PlannerContext,
  emp: EmployeeData,
  day: string,
  shiftType: ShiftType,
  isRevision: boolean
) => {
  const weekId = getWeekId(day);
  const weights = getModeWeights();
  const pressure = getEmployeePressure(ctx, emp, weekId);
  const scarcity = Math.max(
    0,
    5 - getShiftCandidateCount(ctx, day, shiftType, isRevision ? 'revision' : 'web')
  );
  const normalScarcity = Math.max(0, 5 - getShiftCandidateCount(ctx, day, shiftType, 'normal'));
  const weeklyOverPreferred = Math.max(0, pressure.assignedThisWeek - pressure.preferredTarget);
  const cumulativeOverPreferred = Math.max(
    0,
    pressure.assignedUntilNow - (ctx.planningTargets.cumulativePreferred[emp.name][weekId] || 0)
  );
  const weeklyOverMax = Math.max(0, pressure.assignedThisWeek - pressure.maxTarget);

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

  if (pressure.assignedThisWeek + HOURS_PER_SHIFT > pressure.maxTarget) {
    score -= 280;
  }

  score += Math.random() * weights.noise;
  return score;
};

const scoreLegacySchedule = (result: ScheduleResult, data: ParsedData) => {
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

    for (const shiftsOnDay of dayMap.values()) {
      const normalCount = shiftsOnDay.filter(shift => !shift.isWeb && !shift.isWebRevision).length;
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
};

export function generateLegacySchedule(
  data: ParsedData,
  iterations: number
): ScheduleResult {
  let bestSchedule: ScheduleResult | null = null;
  let bestScore = -Infinity;
  const runCount = Math.max(1, iterations);

  for (let i = 0; i < runCount; i++) {
    const currentSchedule = generateLegacySingleSchedule(data);
    const currentScore = scoreLegacySchedule(currentSchedule, data);
    if (currentScore > bestScore || !bestSchedule) {
      bestScore = currentScore;
      bestSchedule = currentSchedule;
    }
  }

  return bestSchedule!;
}

export function generateLegacySingleSchedule(data: ParsedData): ScheduleResult {
  const ctx = createPlannerContext(data, 'legacy');
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
    isRevision: boolean
  ) => {
    let remaining = count;
    const preferredOrder: ShiftType[] =
      timePreference === 'Morning'
        ? ['Morning', 'Afternoon']
        : timePreference === 'Afternoon'
          ? ['Afternoon', 'Morning']
          : ['Morning', 'Afternoon'];

    const dayOrder = [...allowedDays].sort((left, right) => {
      const bestLeft = Math.max(
        ...preferredOrder.map(type =>
          getShiftCandidateCount(ctx, left, type, isRevision ? 'revision' : 'web')
        ),
        0
      );
      const bestRight = Math.max(
        ...preferredOrder.map(type =>
          getShiftCandidateCount(ctx, right, type, isRevision ? 'revision' : 'web')
        ),
        0
      );
      return bestLeft - bestRight;
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
            const score =
              scoreLegacyWebCandidate(ctx, emp, day, type, isRevision) +
              (emp.isWebOnly ? 1200 : 0);
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
      true
    );

    const allowedWebDays = requirement.webShiftDays.filter(
      day => getWeekId(day) === weekId && !data.closedDays.includes(day)
    );
    assignPreferredSpecialShifts(
      weekId,
      requirement.webShifts,
      allowedWebDays,
      requirement.webShiftTimePreference,
      false
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

            const score = scoreLegacyNormalCandidate(ctx, emp, day, type, false) + 90;
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

            const score = scoreLegacyNormalCandidate(ctx, emp, day, type, false) + 24;
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
        const allAvailableEmployees = employees.filter(
          emp =>
            !emp.isWebOnly &&
            isAvailable(emp, slot.day, slot.type, data.closedDays) &&
            !isWorking(schedule, emp.name, slot.day, slot.type)
        );

        if (allAvailableEmployees.length === 0) break;

        const withinMaxEmployees = allAvailableEmployees.filter(emp =>
          hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT)
        );
        const availableEmployees =
          withinMaxEmployees.length > 0 ? withinMaxEmployees : allAvailableEmployees;

        let bestEmployee = availableEmployees[0];
        let bestScore = -Infinity;

        for (const emp of availableEmployees) {
          const score = scoreLegacyNormalCandidate(ctx, emp, slot.day, slot.type, true);
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
            scoreLegacyNormalCandidate(ctx, left, slot.day, slot.type, true) -
            scoreLegacyNormalCandidate(ctx, right, slot.day, slot.type, true)
        );

        for (const emp of workersOnSpecial) {
          if (missing <= 0) break;
          const shift = getShiftForEmployee(schedule, emp.name, slot.day, slot.type);
          if (!shift) continue;
          setShiftClassification(shift, 'normal');
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
    for (const employeeName in schedule) {
      for (const shift of schedule[employeeName]) {
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
      const shiftOrder =
        preference === 'Morning'
          ? (['Morning', 'Afternoon'] as ShiftType[])
          : preference === 'Afternoon'
            ? (['Afternoon', 'Morning'] as ShiftType[])
            : (['Morning', 'Afternoon'] as ShiftType[]);

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

          idleCandidates.sort((left, right) => {
            const rightScore =
              scoreLegacyWebCandidate(ctx, right, day, type, kind === 'revision') +
              (right.isWebOnly ? 1200 : 0);
            const leftScore =
              scoreLegacyWebCandidate(ctx, left, day, type, kind === 'revision') +
              (left.isWebOnly ? 1200 : 0);
            return rightScore - leftScore;
          });

          if (idleCandidates.length > 0) {
            const chosen = idleCandidates[0];
            assignShift(ctx, chosen.name, day, type, kind === 'web', kind === 'revision');
            remaining--;
            continue;
          }

          const normalWorkers = employees.filter(emp => {
            if (emp.isWebOnly) return false;
            if (!isQualifiedForSpecialShift(emp, kind)) return false;
            if (hasSpecialShiftOnDay(schedule, emp.name, day)) return false;
            const shift = getShiftForEmployee(schedule, emp.name, day, type);
            return !!shift && !shift.isWeb && !shift.isWebRevision;
          });

          normalWorkers.sort((left, right) => {
            const rightScore =
              scoreLegacyWebCandidate(ctx, right, day, type, kind === 'revision') +
              (right.isWebOnly ? 1200 : 0);
            const leftScore =
              scoreLegacyWebCandidate(ctx, left, day, type, kind === 'revision') +
              (left.isWebOnly ? 1200 : 0);
            return rightScore - leftScore;
          });

          for (const worker of normalWorkers) {
            const allReplacementCandidates = employees.filter(
              emp =>
                emp.name !== worker.name &&
                !emp.isWebOnly &&
                isAvailable(emp, day, type, data.closedDays) &&
                !isWorking(schedule, emp.name, day, type)
            );

            const replacementCandidates = allReplacementCandidates.some(emp =>
              hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT)
            )
              ? allReplacementCandidates.filter(emp =>
                  hasRoomForShift(ctx, emp, weekId, HOURS_PER_SHIFT)
                )
              : allReplacementCandidates;

            replacementCandidates.sort(
              (left, right) =>
                scoreLegacyNormalCandidate(ctx, right, day, type, true) -
                scoreLegacyNormalCandidate(ctx, left, day, type, true)
            );

            if (replacementCandidates.length === 0) continue;

            const replacement = replacementCandidates[0];
            const shift = getShiftForEmployee(schedule, worker.name, day, type);
            if (!shift) continue;

            setShiftClassification(shift, kind);
            assignShift(ctx, replacement.name, day, type, false, false);
            remaining--;
            break;
          }
        }
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

  return buildScheduleResultFromAssignments(
    data,
    schedule,
    {
      normal: unfilledNormalShifts,
      web: unfilledWebShifts,
      revision: unfilledWebRevisionShifts,
    },
    'legacy'
  );
}
