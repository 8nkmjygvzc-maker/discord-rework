import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';
import type { Readable } from 'node:stream';

/**
 * Objektspeicher-Zugang (MinIO, S3-kompatibel) für verschlüsselte Anhänge
 * (Phase 8). Hier landen ausschließlich client-seitig verschlüsselte Blobs –
 * der Speicher sieht nie Klartext, Dateinamen oder MIME-Typen.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: Client;
  readonly bucket: string;

  constructor(config: ConfigService) {
    this.client = new Client({
      endPoint: config.get<string>('MINIO_ENDPOINT') ?? 'localhost',
      port: Number(config.get<string>('MINIO_PORT') ?? 9000),
      // Dev-Betrieb läuft ohne TLS; vor einem echten Deployment auf true stellen
      // (dann terminiert ohnehin ein Reverse-Proxy/LB die Verbindungen).
      useSSL: config.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: config.get<string>('MINIO_ROOT_USER') ?? 'parley',
      secretKey: config.get<string>('MINIO_ROOT_PASSWORD') ?? '',
    });
    this.bucket = config.get<string>('MINIO_BUCKET') ?? 'parley-attachments';
  }

  /** Bucket beim Start anlegen, falls er noch nicht existiert (idempotent). */
  async onModuleInit(): Promise<void> {
    if (!(await this.client.bucketExists(this.bucket))) {
      await this.client.makeBucket(this.bucket);
      this.logger.log(`Bucket „${this.bucket}“ angelegt`);
    }
  }

  putObject(objectKey: string, data: Buffer): Promise<unknown> {
    return this.client.putObject(this.bucket, objectKey, data, data.length);
  }

  getObjectStream(objectKey: string): Promise<Readable> {
    return this.client.getObject(this.bucket, objectKey);
  }

  removeObject(objectKey: string): Promise<void> {
    return this.client.removeObject(this.bucket, objectKey);
  }
}
