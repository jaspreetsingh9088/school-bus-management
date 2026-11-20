/**
 * Per-company safety and notification settings. Every value here is a default
 * from Requirements v2 that a company can override in companies.settings.
 */
export interface CompanySettings {
  timezone: string;
  /** Wait at a morning stop before a no-show can be marked (spec 4.4) */
  waitSecondsMorning: number;
  /** Wait at an afternoon stop when no adult is there (spec 4.2) */
  waitSecondsAfternoon: number;
  /** Parents must mark an absence this many minutes before the stop time (spec 4.3) */
  absenceCutoffMinutes: number;
  /** "Bus approaching" alert distance (spec 8) */
  approachDistanceM: number;
  /** Bus counts as arrived at a stop inside this radius */
  arrivalRadiusM: number;
  /** No GPS for this long during a trip = signal lost */
  signalLostSeconds: number;
  /** Above this speed the driver cannot mark students (spec 4.7) */
  drivingLockKmh: number;
  /** Used for distance-based ETA until a routing provider is plugged in */
  avgSpeedKmh: number;
  /** Straight-line distance × this factor ≈ road distance */
  roadFactor: number;
}

export const DEFAULT_SETTINGS: CompanySettings = {
  timezone: 'Asia/Kolkata',
  waitSecondsMorning: 120,
  waitSecondsAfternoon: 180,
  absenceCutoffMinutes: 30,
  approachDistanceM: 1000,
  arrivalRadiusM: 50,
  signalLostSeconds: 120,
  drivingLockKmh: 10,
  avgSpeedKmh: 22,
  roadFactor: 1.3,
};

export function resolveSettings(raw: unknown): CompanySettings {
  const overrides = raw && typeof raw === 'object' ? (raw as Partial<CompanySettings>) : {};
  return { ...DEFAULT_SETTINGS, ...overrides };
}
