import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import express from 'express';
import type { Server } from 'node:http';
import { MAX_ATTACHMENT_CIPHERTEXT_BYTES } from '@parley/shared';
import { AppModule } from './app.module';
import { GatewayService } from './gateway/gateway.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
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
  // whitelist: unbekannte Felder werden verworfen statt in die DB zu wandern.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  // WebSocket-Gateway teilt sich den HTTP-Server mit der REST-API (Pfad /gateway).
  app.get(GatewayService).attach(app.getHttpServer() as Server);
  console.log(`Parley API läuft auf http://localhost:${port}/api`);
}

void bootstrap();
