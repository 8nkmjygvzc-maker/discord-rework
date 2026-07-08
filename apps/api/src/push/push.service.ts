import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as webpush from 'web-push';
import type { PushPayload } from '@parley/shared';
import { PrismaService } from '../prisma/prisma.service';
import { PresenceService } from '../gateway/presence.service';
import { SubscribeDto } from './dto/subscribe.dto';

/** Mehr braucht kein Mensch: großzügiges Limit gespeicherter Browser pro Konto. */
const MAX_SUBSCRIPTIONS_PER_USER = 10;

/**
 * Web-Push (Phase 12). Sendet inhaltsarme Benachrichtigungen an die beim Nutzer
 * registrierten Browser-Subscriptions – aber nur, wenn er OFFLINE ist (bei
 * offener Gateway-Verbindung übernimmt die In-App-/Notification-API aus Phase 9).
 * Wegen E2EE enthält der Push keinen Nachrichtentext, nur Absender/Kanal als
 * Metadaten und eine URL zum Öffnen der App.
 *
 * Ohne VAPID-Schlüssel (`.env`) ist Push deaktiviert – die App läuft normal.
 */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private enabled = false;
  private publicKeyValue = '';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly presence: PresenceService,
  ) {}

  onModuleInit(): void {
    const publicKey = this.config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = this.config.get<string>('VAPID_PRIVATE_KEY');
    const subject = this.config.get<string>('VAPID_SUBJECT') || 'mailto:admin@parley.local';
    if (publicKey && privateKey) {
      webpush.setVapidDetails(subject, publicKey, privateKey);
      this.publicKeyValue = publicKey;
      this.enabled = true;
      this.logger.log('Web-Push aktiviert (VAPID konfiguriert)');
    } else {
      this.logger.warn('VAPID-Schlüssel fehlen – Web-Push ist deaktiviert');
    }
  }

  /** Öffentlicher VAPID-Schlüssel für den Client (leer, wenn Push aus ist). */
  get publicKey(): string {
    return this.publicKeyValue;
  }

  /** Speichert/aktualisiert eine Subscription (Schlüssel: eindeutiger Endpoint). */
  async subscribe(userId: string, dto: SubscribeDto): Promise<void> {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
      // Endpoint kann von einem anderen Konto stammen (geteiltes Gerät) → userId
      // mit aktualisieren, damit die Subscription dem aktuellen Nutzer gehört.
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
    // Deckel pro Nutzer: die ältesten Subscriptions über dem Limit entfernen –
    // sonst könnte ein Konto die Tabelle unbegrenzt wachsen lassen.
    const excess = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: MAX_SUBSCRIPTIONS_PER_USER,
      select: { id: true },
    });
    if (excess.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: excess.map((e) => e.id) } },
      });
    }
  }

  /** Entfernt eine Subscription dieses Nutzers (Abmelden / Logout). */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  }

  /**
   * Pusht an einen Nutzer – aber nur, wenn er gerade offline ist. Best-effort:
   * Fehler brechen den auslösenden Vorgang (Nachricht senden) nicht ab.
   */
  async pushToUserIfOffline(userId: string, payload: PushPayload): Promise<void> {
    if (!this.enabled) return;
    if (await this.presence.isOnline(userId)) return;
    await this.sendToUser(userId, payload);
  }

  private async sendToUser(userId: string, payload: PushPayload): Promise<void> {
    const subs = await this.prisma.pushSubscription.findMany({ where: { userId } });
    if (subs.length === 0) return;
    const body = JSON.stringify(payload);
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          );
        } catch (err) {
          const code = (err as { statusCode?: number }).statusCode;
          // 404/410 = Subscription abgelaufen/abbestellt → aufräumen.
          if (code === 404 || code === 410) {
            await this.prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
          } else {
            this.logger.warn(`Push an ${userId} fehlgeschlagen (${code ?? 'Fehler'})`);
          }
        }
      }),
    );
  }
}
