import { distanceM } from '../src/common/geo';
import { normalizePhone, hashPassword, verifyPassword } from '../src/common/passwords';
import { hhmmToMinutes, zoned } from '../src/common/time';
import { blocksTripEnd, crewCanMove, parentMessage } from '../src/trips/status-machine';
import { estimateEtas } from '../src/trips/tracking.service';

describe('student status rules', () => {
  it('lets the crew board, drop and hold only along allowed paths', () => {
    expect(crewCanMove('MORNING', 'SCHEDULED', 'BOARDED')).toBe(true);
    expect(crewCanMove('MORNING', 'BOARDED', 'AT_SCHOOL')).toBe(true);
    expect(crewCanMove('MORNING', 'NO_SHOW', 'BOARDED')).toBe(true);
    expect(crewCanMove('MORNING', 'SCHEDULED', 'AT_SCHOOL')).toBe(false); // must board first
    expect(crewCanMove('MORNING', 'BOARDED', 'HANDED_OVER')).toBe(false); // no home drop in the morning
    expect(crewCanMove('AFTERNOON', 'BOARDED', 'HELD')).toBe(true);
    expect(crewCanMove('AFTERNOON', 'HELD', 'RETURNED')).toBe(true);
    expect(crewCanMove('AFTERNOON', 'BOARDED', 'RETURNED')).toBe(false); // hold comes first
    expect(crewCanMove('AFTERNOON', 'HANDED_OVER', 'BOARDED')).toBe(false);
  });

  it('never lets the crew mark a child absent', () => {
    expect(crewCanMove('MORNING', 'SCHEDULED', 'ABSENT')).toBe(false);
    expect(crewCanMove('AFTERNOON', 'SCHEDULED', 'ABSENT')).toBe(false);
  });

  it('blocks ending a trip while a child is on board or held', () => {
    expect(blocksTripEnd('BOARDED')).toBe(true);
    expect(blocksTripEnd('HELD')).toBe(true);
    expect(blocksTripEnd('HANDED_OVER')).toBe(false);
  });

  it('texts parents for no-shows and held children', () => {
    expect(parentMessage('HELD', { student: 'Aarav' })).toMatchObject({ safety: true, sms: true });
    expect(parentMessage('NO_SHOW', { student: 'Aarav' })).toMatchObject({ sms: true });
    expect(parentMessage('BOARDED', { student: 'Aarav' })).toMatchObject({ safety: true, sms: false });
    expect(parentMessage('SCHEDULED', { student: 'Aarav' })).toBeNull();
  });
});

describe('geo and ETA', () => {
  it('measures distance', () => {
    const d = distanceM({ lat: 12.9716, lng: 77.5946 }, { lat: 12.9816, lng: 77.5946 });
    expect(d).toBeGreaterThan(1100);
    expect(d).toBeLessThan(1120);
  });

  it('adds up distance along the remaining stops', () => {
    const stops = [
      { routeStopId: 'a', sequence: 1, name: 'A', lat: 12.98, lng: 77.6, arrivedAt: null, approachNotified: false },
      { routeStopId: 'b', sequence: 2, name: 'B', lat: 12.99, lng: 77.6, arrivedAt: null, approachNotified: false },
    ];
    const etas = estimateEtas({ lat: 12.97, lng: 77.6 }, stops, { avgSpeedKmh: 36, roadFactor: 1 });
    expect(etas[0].distanceM).toBeGreaterThan(1100);
    expect(etas[1].distanceM).toBeGreaterThan(2200);
    expect(etas[1].etaSeconds).toBeCloseTo(etas[1].distanceM / 10, -1); // 36 km/h = 10 m/s
  });
});

describe('helpers', () => {
  it('normalises Indian mobile numbers', () => {
    expect(normalizePhone('98450 12345')).toBe('+919845012345');
    expect(normalizePhone('09845012345')).toBe('+919845012345');
    expect(normalizePhone('+44 7700 900123')).toBe('+447700900123');
    expect(normalizePhone('12345')).toBeNull();
  });

  it('works in the company time zone', () => {
    const at = new Date('2026-11-20T20:00:00Z'); // 01:30 next day in India
    expect(zoned(at, 'Asia/Kolkata')).toEqual({ date: '2026-11-21', minutes: 90 });
    expect(hhmmToMinutes('07:30')).toBe(450);
  });

  it('hashes passwords', async () => {
    const h = await hashPassword('secret-1');
    expect(await verifyPassword('secret-1', h)).toBe(true);
    expect(await verifyPassword('secret-2', h)).toBe(false);
  });
});
