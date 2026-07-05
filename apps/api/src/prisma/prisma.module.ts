import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// Global, damit nicht jedes Feature-Modul PrismaModule importieren muss.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
