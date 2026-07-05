import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  // Alle REST-Routen unter /api – so kann der Web-Client im Dev-Modus
  // per Vite-Proxy und in Produktion per Reverse-Proxy ohne CORS arbeiten.
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  // whitelist: unbekannte Felder werden verworfen statt in die DB zu wandern.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port);
  console.log(`Parley API läuft auf http://localhost:${port}/api`);
}

void bootstrap();
