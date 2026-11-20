import { Injectable } from '@nestjs/common';
import { AuthUser, tenantOf } from '../common/auth';
import { Db, InjectDb } from '../db/db.module';
import { incidents } from '../db/schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { TripAccessService } from './trip-access.service';

export interface IncidentInput {
  type: 'SOS' | 'BREAKDOWN' | 'DELAY' | 'ACCIDENT' | 'OTHER';
  tripId?: string;
  note?: string;
  lat?: number;
  lng?: number;
  photoUrl?: string;
}

const LABEL: Record<IncidentInput['type'], string> = {
  SOS: 'SOS', BREAKDOWN: 'Breakdown', DELAY: 'Delay', ACCIDENT: 'Accident', OTHER: 'Incident',
};

/** SOS and incident reports from crew and parents (spec 4.6). Admins decide what parents are told. */
@Injectable()
export class IncidentsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly access: TripAccessService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async raise(user: AuthUser, input: IncidentInput) {
    const companyId = tenantOf(user);
    if (input.tripId) {
      if (user.role === 'PARENT') await this.access.getForCompany(input.tripId, companyId);
      else await this.access.getForCrew(input.tripId, user);
    }
    const [row] = await this.db.insert(incidents).values({ companyId, raisedById: user.sub, ...input }).returning();
    const urgent = input.type === 'SOS' || input.type === 'ACCIDENT';
    const where = input.lat !== undefined && input.lng !== undefined ? ` Location: https://maps.google.com/?q=${input.lat},${input.lng}` : '';
    await this.notifications.notify({
      companyId,
      userIds: await this.notifications.adminUserIds(companyId),
      type: `INCIDENT_${input.type}`,
      title: `${LABEL[input.type]} reported by ${user.name}`,
      body: `${input.note ?? ''}${where}`.trim() || 'No details given.',
      data: { incidentId: row.id, ...(input.tripId ? { tripId: input.tripId } : {}) },
      safety: true,
      sms: urgent,
    });
    this.realtime.toCompany(companyId, 'alert', { type: `INCIDENT_${input.type}`, incident: row });
    return row;
  }
}
