import { MainLoggerModule, startApp } from '@maktd/naddons';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { BotModule } from './bot_module';
import { botConfig, loggerConfig } from './config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        loggerConfig,
        botConfig,
      ],
    }),
    MainLoggerModule.forRoot(loggerConfig()),
    BotModule,
  ],
})
class RootModule {}

const appPromise: Promise<NestFastifyApplication> = startApp(
  RootModule,
  { http: { disable: true }, openapi: { enabled: false } },
);

export default appPromise;
