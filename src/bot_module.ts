import { Global, Module } from '@nestjs/common';
import { BotService } from './bot_service';

@Module({
  providers: [BotService],
})
@Global()
export class BotModule {}
