import { generateSchedule } from '../lib/scheduler';
import type { ParsedData } from '../lib/parser';
import type { PlannerMode } from '../lib/scheduler';

type ScheduleWorkerRequest = {
  data: ParsedData;
  mode?: PlannerMode;
};

self.onmessage = (event: MessageEvent<ScheduleWorkerRequest>) => {
  try {
    const schedule = generateSchedule(
      event.data.data,
      undefined,
      event.data.mode ?? 'fairness'
    );
    self.postMessage({ type: 'result', schedule });
  } catch (error) {
    self.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown worker error',
    });
  }
};

export {};
