import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ConfigModule } from '../config/config.module';
import { TokenService } from './token.service';

@Module({ imports: [PrismaModule, ConfigModule], providers: [TokenService], exports: [TokenService] })
export class AuthModule {}
