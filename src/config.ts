import { MainLoggerModuleConfig } from '@maktd/naddons';
import { registerAs } from '@nestjs/config';
import ev from 'env-var';

const globalDefaults = {
  appName: 'FARMIX-TMA-TG-BOT',
};

export const loggerConfig = registerAs('logger', (): MainLoggerModuleConfig => {
  const levels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

  return {
    name: ev.get('APP_NAME').default(globalDefaults.appName).asString(),
    level: ev.get('LOG_LEVEL').default('info').asEnum(levels),
    pretty: ev.get('LOG_PRETTY').default('0').asBool(),
    prettyOptions: {
      singleLine: ev.get('LOG_PRETTY_SINGLE_LINE').default('0').asBool(),
    },
    throttleLimit: ev.get('LOG_THROTTLE_LIMIT').default('0').asIntPositive(),
    throttleLimitTttMs: ev.get('LOG_THROTTLE_LIMIT_TTL_MS').default('60000').asIntPositive(),
  };
});

export const botConfig = registerAs('bot', () => {
  const secretKey = ev.get('TG_BOT_SECRET_KEY').required().asString();
  const testEnv = ev.get('TG_BOT_IS_TEST_ENV').default('false').asBool();

  return {
    secretKey,
    testEnv,
  };
});

export const unoConfig = registerAs('uno', () => {
  const maxRoomsForOwner = ev.get('UNO_MAX_ROOMS_FOR_OWNER').default('5').asIntPositive();
  const maxRoomParticipants = ev.get('MAX_ROOM_PARTICIPANTS').default('2').asIntPositive();

  return {
    maxRoomsForOwner,
    maxRoomParticipants,
  };
});
