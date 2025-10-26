import { MainLoggerModule, startApp } from '@maktd/naddons';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { botConfig, loggerConfig } from './config';
import { UnoModule } from './uno/uno.module';

// TODO: implemnet services and repos
// TODO: tests

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
    UnoModule,
  ],
})
class RootModule {}

const appPromise: Promise<NestFastifyApplication> = startApp(
  RootModule,
  { http: { disable: true }, openapi: { enabled: false } },
);

export default appPromise;
