import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { RedisService } from 'nestjs-redis';
import * as Redis from 'ioredis';

@Injectable()
export class KvStoreService {

  client: Redis.Redis;
  readonly EXPIRE_IN_ONE_DAY = 60 * 60 * 24;
  readonly EXPIRE_IN_FIVE_DAYS = 60 * 60 * 24 * 5;

  constructor(
    private readonly redisService: RedisService,
  ) {
    try {
      this.client = this.redisService.getClient();

    } catch (error) {
      throw new Error('Could not connect to Redis client');
      // Logger.error('Could not connect to Redis client');
    }
  }

  async set(key: string, value: string | Buffer | number | any[]): Promise<void> {
    await this.client.set(key, value, 'EX', this.EXPIRE_IN_FIVE_DAYS);
  }

  async get(key: string): Promise<any> {
    return this.client.get(key);
  }

  async remove(key: string): Promise<any> {
    await this.client.del(key);
  }

  async storeObject(key: string, object: Object): Promise<void> {
    await this.client.set(key, JSON.stringify(object), 'EX', this.EXPIRE_IN_FIVE_DAYS);
  }

  async getObject(key: string): Promise<any> {
    return JSON.parse(await this.client.get(key));
  }
}