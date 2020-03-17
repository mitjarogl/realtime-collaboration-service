import { Logger, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ResourceUnlock } from '../core/models/resource-unlock.model';
import { ResourceUpdateState } from '../core/models/resource-update-state.model';
import { KvStoreService } from '../services/kv-store.service';
import { Contributor, FieldCode } from './../core/models/contributor.model';
import { EventTypeEnum } from './../core/models/event-type.enum';
import { ResourceJoin } from './../core/models/resource-join.model';
import { ResourceLeave } from './../core/models/resource-leave.model';
import { ResourceLock } from './../core/models/resource-lock.model';
import { ResourceUnlockAllFields } from './../core/models/resource-unlock-all-fields.model';
import { WsJwtGuard } from './guards/ws-jwt.guard';

@UseGuards(WsJwtGuard)
@WebSocketGateway({ pingInterval: 2000, pingTimeout: 2000 })
export class EventsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  readonly MAX_HEARTBEAT_BEFORE_FLAGGED_AS_NON_ACTIVE = 5 * 60 * 1000; // Five minutes

  @WebSocketServer()
  server: Server;

  constructor(private readonly kvStore: KvStoreService) {}

  afterInit(server: Server): any {
    Logger.log('Socket established on server');
  }

  handleConnection(socket: Socket, ...args: any[]): any {
    Logger.log('Socket connected to server: ' + socket.id);
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    Logger.error(`Contributor with socket id ${socket.id} disconnected`);

    const resourceId = await this.kvStore.get(socket.id);
    if (!resourceId) {
      return;
    }
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(resourceId)) || []
    );
    const indexOf = contributors.findIndex(val => val.socketId === socket.id);
    if (indexOf !== -1) {
      // Remove disconnected user
      contributors.splice(indexOf, 1);

      // Save contributors to store
      await this.kvStore.storeObject(resourceId, contributors);

      // Remove disconnected socket from store
      await this.kvStore.remove(socket.id);

      this.server
        .to(resourceId)
        .emit(EventTypeEnum.RESOURCE_LEAVE, contributors);
    }
  }

  @SubscribeMessage(EventTypeEnum.RESOURCE_JOIN)
  async resourceJoin(
    @MessageBody() data: ResourceJoin,
    @ConnectedSocket() socket: Socket
  ): Promise<void> {
    Logger.log(
      `Contributor ${data.contributor.id} joined resource ${data.resourceId}`
    );
    const resourceId = data.resourceId;

    socket.join(resourceId);
    // Save socket to store
    await this.kvStore.set(socket.id, resourceId);

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(resourceId)) || []
    );

    // Set Global user data
    const indexOf = contributors.findIndex(
      value => value.id === data.contributor.id
    );

    // TODO Check if user has already state open
    if (indexOf !== -1) {
      contributors[indexOf].id = data.contributor.id;
      contributors[indexOf].socketId = socket.id;
      contributors[indexOf].resourceId = resourceId;
      contributors[indexOf].name = data.contributor.name;
      contributors[indexOf].lastHeartBeatOccurredAt = Date.now();
    } else {
      contributors.push({
        id: data.contributor.id,
        socketId: socket.id,
        name: data.contributor.name,
        resourceId,
        lastHeartBeatOccurredAt: Date.now(),
      } as any);
    }

    // Save contributors to store
    await this.kvStore.storeObject(resourceId, contributors);

    // Notify all clients in room
    this.server.to(resourceId).emit(EventTypeEnum.RESOURCE_JOIN, contributors);
  }

  @SubscribeMessage(EventTypeEnum.RESOURCE_LEAVE)
  async resourceLeave(
    @MessageBody() data: ResourceLeave,
    @ConnectedSocket() socket: Socket
  ): Promise<void> {
    Logger.log(
      `Contributor ${data.contributor.id} leave resource ${data.resourceId}`
    );
    const resourceId = data.resourceId;

    socket.leave(resourceId);
    // Remove socket from store
    await this.kvStore.remove(socket.id);

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(resourceId)) || []
    );

    // Set Global user data
    const indexOf = contributors.findIndex(
      value => value.id === data.contributor.id
    );
    // FIXME Remove user or should be socket (eg. User can be in multiple browsers)
    contributors.splice(indexOf, 1);

    // Save contributors to store
    await this.kvStore.storeObject(resourceId, contributors);

    // Notify all clients
    this.server.to(resourceId).emit(EventTypeEnum.RESOURCE_LEAVE, contributors);
  }

  @SubscribeMessage(EventTypeEnum.RESOURCE_LOCK)
  async resourceLock(
    @MessageBody() data: ResourceLock,
    @ConnectedSocket() socket: Socket
  ): Promise<void> {
    Logger.log(
      `Contributor ${data.contributor.id} has locked ${data.fieldCode}`
    );
    const resourceId = data.resourceId;

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(resourceId)) || []
    );

    // Set lock
    const indexOfContributor = contributors.findIndex(
      value => value.id === data.contributor.id
    );

    if (indexOfContributor !== -1) {
      // Initialization if not exists
      if (!contributors[indexOfContributor].fieldCodes) {
        contributors[indexOfContributor].fieldCodes = [];
      }

      contributors[indexOfContributor].lastHeartBeatOccurredAt = Date.now();

      // Add only if already not exists
      if (!this._isContributorAlreadyLockedField(contributors, data)) {
        contributors[indexOfContributor].fieldCodes.push({
          fieldCode: data.fieldCode,
          changes: null,
          isLocked: true,
        } as FieldCode);
      }
    }

    // Save contributors to store
    await this.kvStore.storeObject(resourceId, contributors);

    // Notify all clients
    this.server.to(resourceId).emit(EventTypeEnum.RESOURCE_LOCK, contributors);
  }

  @SubscribeMessage(EventTypeEnum.RESOURCE_UNLOCK)
  async resourceUnlock(
    @MessageBody() data: ResourceUnlock,
    @ConnectedSocket() socket: Socket
  ): Promise<void> {
    const resourceId = data.resourceId;
    Logger.log(
      `Contributor ${data.user.id} unlocked ${data.fieldCode} in ${resourceId}`
    );

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(resourceId)) || []
    );
    if (!contributors) {
      return;
    }

    // Release lock
    const indexOfContributor = contributors.findIndex(
      value => value.id === data.user.id
    );
    if (indexOfContributor !== -1) {
      contributors[indexOfContributor].lastHeartBeatOccurredAt = Date.now();
      const indexOfFieldCode = contributors[
        indexOfContributor
      ].fieldCodes.findIndex(val => val.fieldCode === data.fieldCode);
      contributors[indexOfContributor].fieldCodes = contributors[
        indexOfContributor
      ].fieldCodes.filter(value => value.isLocked); // Remove already unlocked fields
      if (indexOfFieldCode !== -1) {
        contributors[indexOfContributor].fieldCodes[indexOfFieldCode].changes =
          data.changes;
        contributors[indexOfContributor].fieldCodes[
          indexOfFieldCode
        ].isLocked = false;
      }
    }

    // Save contributors to store
    await this.kvStore.storeObject(resourceId, contributors);

    // Notify all clients
    Logger.log(
      `Emit ${
        EventTypeEnum.RESOURCE_UNLOCK
      } event to contributors in ${resourceId}, contributors: ${JSON.stringify(
        contributors
      )}`
    );
    this.server
      .to(resourceId)
      .emit(EventTypeEnum.RESOURCE_UNLOCK, contributors);
  }

  @SubscribeMessage(EventTypeEnum.RESOURCE_UNLOCK_ALL_FIELDS)
  async resourceUnlockAllFields(
    @MessageBody() data: ResourceUnlockAllFields,
    @ConnectedSocket() socket: Socket
  ): Promise<void> {
    const resourceId = data.resourceId;
    Logger.log(
      `Contributor ${data.contributor.id} unlocked all fields in ${resourceId}`
    );

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(resourceId)) || []
    );
    if (!contributors) {
      return;
    }

    // Release all fields lock
    const indexOfContributor = contributors.findIndex(
      value => value.id === data.contributor.id
    );

    if (indexOfContributor !== -1) {
      if (contributors[indexOfContributor]) {
        contributors[indexOfContributor].fieldCodes = [];
        contributors[indexOfContributor].lastHeartBeatOccurredAt = Date.now();
      }
    }

    // Save contributors to store
    await this.kvStore.storeObject(resourceId, contributors);

    // Notify all clients
    Logger.log(
      `Emit ${
        EventTypeEnum.RESOURCE_UNLOCK_ALL_FIELDS
      } event to contributors in ${resourceId}, contributors: ${JSON.stringify(
        contributors
      )}`
    );
    this.server
      .to(resourceId)
      .emit(EventTypeEnum.RESOURCE_UNLOCK_ALL_FIELDS, contributors);
  }

  @SubscribeMessage(EventTypeEnum.RESOURCE_UPDATE_STATE)
  async resourceUpdateState(
    @MessageBody() resourceUpdateState: ResourceUpdateState,
    @ConnectedSocket() socket: Socket
  ): Promise<void> {
    const resourceId = resourceUpdateState.resourceId;
    Logger.log(
      `Contributor ${resourceUpdateState.user.id} updated state in ${resourceId}`
    );

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(resourceId)) || []
    );

    // Notify all clients
    Logger.log(
      `Emit ${
        EventTypeEnum.RESOURCE_UPDATE_STATE
      } event to contributors in ${resourceId}, contributors: ${JSON.stringify(
        contributors
      )}`
    );
    this.server
      .to(resourceId)
      .emit(EventTypeEnum.RESOURCE_UPDATE_STATE, resourceUpdateState);
  }

  private _isContributorAlreadyLockedField(
    contributors: Contributor[],
    resourceLock: ResourceLock
  ): boolean {
    for (const contributor of contributors) {
      // Check if contributor has field code & if is locked
      if (
        contributor.resourceId === resourceLock.resourceId &&
        contributor.fieldCodes &&
        contributor.fieldCodes.findIndex(
          fieldCode =>
            fieldCode.fieldCode === resourceLock.fieldCode && fieldCode.isLocked
        ) !== -1
      ) {
        return true;
      }
    }
    return false;
  }

  private _notifyAndRemoveNonActiveContributors(
    contributors: Contributor[]
  ): Contributor[] {
    const minimalThresholdForInactivity =
      Date.now() - this.MAX_HEARTBEAT_BEFORE_FLAGGED_AS_NON_ACTIVE;
    const nonActiveContributors = contributors.filter(
      value => value.lastHeartBeatOccurredAt < minimalThresholdForInactivity
    );
    const stillActiveContributors = contributors.filter(
      value => value.lastHeartBeatOccurredAt >= minimalThresholdForInactivity
    );

    if (nonActiveContributors.length) {
      for (const nonActive of nonActiveContributors) {
        // Notify still connected contributor but not active
        if (this.server.clients().sockets[nonActive.socketId]) {
          this.server
            .clients()
            .sockets[nonActive.socketId].emit(
              EventTypeEnum.RESOURCE_NOTIFY_NON_ACTIVE_CONTRIBUTOR,
              nonActive
            );
        }
      }
    }

    return stillActiveContributors;
  }
}
