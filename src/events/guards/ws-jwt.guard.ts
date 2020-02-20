import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

@Injectable()
export class WsJwtGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {
  }

  canActivate(context: ExecutionContext): boolean {


    const client = context.switchToWs().getClient();
    // FIXME Check JWT in headers instead
    return client.handshake.query['token'] === 'token';
  }
}
