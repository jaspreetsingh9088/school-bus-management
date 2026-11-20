import { Injectable } from '@nestjs/common';

/**
 * Used where WebSockets aren't available (Vercel serverless). Apps fall back to polling
 * the REST endpoints, so nothing is lost except instant push to open screens.
 */
@Injectable()
export class NoopRealtime {
  toUser(_userId: string, _event: string, _payload: unknown) {}
  toCompany(_companyId: string, _event: string, _payload: unknown) {}
  toTrip(_tripId: string, _event: string, _payload: unknown) {}
  async closeTrip(_tripId: string) {}
}
