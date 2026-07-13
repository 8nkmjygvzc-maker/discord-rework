import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Server } from 'node:http';
import { MAX_ATTACHMENT_CIPHERTEXT_BYTES } from '@parley/shared';
import { AppModule } from './app.module';
import { GatewayService } from './gateway/gateway.service';

async function bootstrap(): Promise<void> {
  // bodyParser: false → wir registrieren JSON/urlencoded unten selbst, weil das
  // Schlüssel-Backup (verschlüsselter Zustands-Blob) das 100-kB-Standardlimit
  // des automatischen JSON-Parsers überschreiten kann.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  // Hinter einem Reverse-Proxy (Phase 14): TRUST_PROXY setzen, damit Express
  // `req.ip` aus X-Forwarded-For nimmt – sonst drosselt das Rate-Limit alle
  // Nutzer gemeinsam unter der Proxy-IP. Wert = Hop-Zahl (z. B. `1`) oder ein
  // von Express akzeptierter Ausdruck; im Dev ohne Proxy bleibt es aus.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    app.set('trust proxy', /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy);
  }
  // Alle REST-Routen unter /api – so kann der Web-Client im Dev-Modus
  // per Vite-Proxy und in Produktion per Reverse-Proxy ohne CORS arbeiten.
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // Anhang-Uploads (Phase 8) kommen als roher Ciphertext-Body – bewusst ohne
  // Multipart/multer. Greift nur bei application/octet-stream, JSON bleibt
  // beim Standard-Parser.
  app.use(
    express.raw({
      type: 'application/octet-stream',
      limit: MAX_ATTACHMENT_CIPHERTEXT_BYTES + 1024,
    }),
  );
  // 2 MB statt der 100-kB-Voreinstellung: PUT /api/keys/backup trägt den
  // verschlüsselten Client-Zustand (bis ~1 MiB Base64) im JSON-Body.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true }));
  // whitelist: unbekannte Felder werden verworfen statt in die DB zu wandern.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // WebSocket-Gateway teilt sich den HTTP-Server mit der REST-API (Pfad /gateway).
  app.get(GatewayService).attach(app.getHttpServer() as Server);
  console.log(`Parley API läuft auf http://localhost:${port}/api`);
}

void bootstrap();
