import type { Direction, TripStudentStatus as S } from '../db/schema';

/**
 * Student statuses on a trip (Requirements v2, section 4.1).
 * Crew can only move a child along these arrows. Admins can override any status with a note.
 * ABSENT is set only from a parent's absence (system), never by the crew.
 */
const MORNING: Partial<Record<S, S[]>> = {
  SCHEDULED: ['BOARDED', 'NO_SHOW'],
  NO_SHOW: ['BOARDED'], // child arrived late, bus still there
  BOARDED: ['AT_SCHOOL'],
};

const AFTERNOON: Partial<Record<S, S[]>> = {
  SCHEDULED: ['BOARDED', 'NO_SHOW'], // NO_SHOW = child did not come to the bus at school
  NO_SHOW: ['BOARDED'],
  BOARDED: ['HANDED_OVER', 'DROPPED_ALONE', 'HELD'],
  HELD: ['HANDED_OVER', 'RETURNED'],
};

export function crewCanMove(direction: Direction, from: S, to: S): boolean {
  const table = direction === 'MORNING' ? MORNING : AFTERNOON;
  return (table[from] ?? []).includes(to);
}

/** Statuses that mean the child is still in the crew's care on the bus. A trip can't end with any of these. */
export const ON_BOARD: S[] = ['BOARDED', 'HELD'];

export function blocksTripEnd(status: S): boolean {
  return ON_BOARD.includes(status);
}

/** Parent message for each status change. `null` = no message. */
export function parentMessage(
  to: S,
  ctx: { student: string; stop?: string; school?: string; adult?: string },
): { title: string; body: string; safety: boolean; sms: boolean } | null {
  switch (to) {
    case 'BOARDED':
      return { title: `${ctx.student} has boarded the bus`, body: `Boarded${ctx.stop ? ` at ${ctx.stop}` : ''}.`, safety: true, sms: false };
    case 'NO_SHOW':
      return { title: `${ctx.student} was not at the bus`, body: 'The bus waited and has moved on. Please contact the transport office if this is unexpected.', safety: true, sms: true };
    case 'AT_SCHOOL':
      return { title: `${ctx.student} has reached school`, body: `Arrived at ${ctx.school ?? 'school'}.`, safety: true, sms: false };
    case 'HANDED_OVER':
      return { title: `${ctx.student} has been dropped off`, body: `Handed over to ${ctx.adult ?? 'an authorized adult'}${ctx.stop ? ` at ${ctx.stop}` : ''}.`, safety: true, sms: false };
    case 'DROPPED_ALONE':
      return { title: `${ctx.student} has been dropped off`, body: `Dropped at ${ctx.stop ?? 'the stop'} to go home alone, as you allowed.`, safety: true, sms: false };
    case 'HELD':
      return { title: `No one was at the stop for ${ctx.student}`, body: `${ctx.student} is safe on the bus. Please come to ${ctx.stop ?? 'the stop'} or call the transport office now.`, safety: true, sms: true };
    case 'RETURNED':
      return { title: `${ctx.student} is being taken back`, body: `No authorized adult was found. ${ctx.student} is being returned to ${ctx.school ?? 'school'}. The transport office will call you.`, safety: true, sms: true };
    default:
      return null;
  }
}
