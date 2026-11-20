import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ADMIN_ROLES, AuthUser } from '../common/auth';
import { TripAccessService } from '../trips/trip-access.service';

/**
 * Socket.IO channel for live data.
 *   Connect with  io(url, { auth: { token } })
 *   Rooms:        user:<id> (own alerts), company:<id> (admins), trip:<id> (after trip:subscribe)
 *   Events out:   bus:position, trip:status, student:status, alert, notification
 */
@WebSocketGateway({ cors: { origin: true } })
export class RealtimeGateway implements OnGatewayConnection {
  private readonly log = new Logger(RealtimeGateway.name);
  @WebSocketServer() server: Server;

  constructor(private readonly jwt: JwtService, private readonly access: TripAccessService) {}

  handleConnection(client: Socket) {
    try {
      const user = this.jwt.verify<AuthUser & { purpose?: string }>(client.handshake.auth?.token ?? '');
      if (user.purpose) throw new Error('ticket');
      client.data.user = user;
      client.join(`user:${user.sub}`);
      if (user.companyId && ADMIN_ROLES.includes(user.role)) client.join(`company:${user.companyId}`);
    } catch {
      client.emit('error', { message: 'Unauthorized' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('trip:subscribe')
  async subscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { tripId?: string }) {
    const user: AuthUser | undefined = client.data.user;
    if (!user || !body?.tripId || !(await this.access.canWatch(body.tripId, user))) {
      return { ok: false };
    }
    await client.join(`trip:${body.tripId}`);
    return { ok: true };
  }

  @SubscribeMessage('trip:unsubscribe')
  async unsubscribe(@ConnectedSocket() client: Socket, @MessageBody() body: { tripId?: string }) {
    if (body?.tripId) await client.leave(`trip:${body.tripId}`);
    return { ok: true };
  }

  toUser(userId: string, event: string, payload: unknown) {
    this.server?.to(`user:${userId}`).emit(event, payload);
  }

  toCompany(companyId: string, event: string, payload: unknown) {
    this.server?.to(`company:${companyId}`).emit(event, payload);
  }

  toTrip(tripId: string, event: string, payload: unknown) {
    this.server?.to(`trip:${tripId}`).emit(event, payload);
  }

  /** Parents lose live access as soon as the trip ends (spec 10). */
  async closeTrip(tripId: string) {
    this.server?.in(`trip:${tripId}`).socketsLeave(`trip:${tripId}`);
  }
}
