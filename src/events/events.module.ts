import { EventsGateway } from './events-getaway';
import { Module } from '@nestjs/common';
import { KvStoreService } from 'src/services/kv-store.service';



@Module({
  providers: [EventsGateway, KvStoreService],
})
export class EventsModule { }
