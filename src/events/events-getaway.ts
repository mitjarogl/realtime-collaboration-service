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
import { ProjectUnlock } from 'src/core/models/project-unlock.model';
import { ProjectUpdateState } from 'src/core/models/project-update-state.model';
import { Contributor, FieldCode } from './../core/models/contributor.model';
import { EventTypeEnum } from './../core/models/event-type.enum';
import { ProjectJoin } from './../core/models/project-join.model';
import { ProjectLeave } from './../core/models/project-leave.model';
import { ProjectLock } from './../core/models/project-lock.model';
import { ProjectUnlockAllFields } from './../core/models/project-unlock-all-fields.model';
import { KvStoreService } from './../services/kv-store.service';
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

    const projectId = await this.kvStore.get(socket.id);
    if (!projectId) {
      return;
    }
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(projectId)) || [],
    );
    const indexOf = contributors.findIndex(val => val.socketId === socket.id);
    if (indexOf !== -1) {
      // Remove disconnected user
      contributors.splice(indexOf, 1);

      // Save contributors to store
      await this.kvStore.storeObject(projectId, contributors);

      // Remove disconnected socket from store
      await this.kvStore.remove(socket.id);

      this.server.to(projectId).emit(EventTypeEnum.PROJECT_LEAVE, contributors);
    }
  }

  @SubscribeMessage(EventTypeEnum.PROJECT_JOIN)
  async projectJoin(
    @MessageBody() data: ProjectJoin,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    Logger.log(
      `Contributor ${data.contributor.id} joined project ${data.projectId}`,
    );
    const projectId = data.projectId;

    socket.join(projectId);
    // Save socket to store
    await this.kvStore.set(socket.id, projectId);

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(projectId)) || [],
    );

    // Set Global user data
    const indexOf = contributors.findIndex(
      value => value.id === data.contributor.id,
    );

    // TODO Check if user has already state open
    if (indexOf !== -1) {
      contributors[indexOf].id = data.contributor.id;
      contributors[indexOf].socketId = socket.id;
      contributors[indexOf].projectId = projectId;
      contributors[indexOf].name = data.contributor.name;
      contributors[indexOf].lastHeartBeatOccurredAt = Date.now();
    } else {
      contributors.push({
        id: data.contributor.id,
        socketId: socket.id,
        name: data.contributor.name,
        projectId,
        lastHeartBeatOccurredAt: Date.now(),
      } as any);
    }

    // Save contributors to store
    await this.kvStore.storeObject(projectId, contributors);

    // Notify all clients in room
    this.server.to(projectId).emit(EventTypeEnum.PROJECT_JOIN, contributors);
  }

  @SubscribeMessage(EventTypeEnum.PROJECT_LEAVE)
  async projectLeave(
    @MessageBody() data: ProjectLeave,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    Logger.log(
      `Contributor ${data.contributor.id} leave project ${data.projectId}`,
    );
    const projectId = data.projectId;

    socket.leave(projectId);
    // Remove socket from store
    await this.kvStore.remove(socket.id);

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(projectId)) || [],
    );

    // Set Global user data
    const indexOf = contributors.findIndex(
      value => value.id === data.contributor.id,
    );
    // FIXME Remove user or should be socket (eg. User can be in multiple browsers)
    contributors.splice(indexOf, 1);

    // Save contributors to store
    await this.kvStore.storeObject(projectId, contributors);

    // Notify all clients
    this.server.to(projectId).emit(EventTypeEnum.PROJECT_LEAVE, contributors);
  }

  @SubscribeMessage(EventTypeEnum.PROJECT_LOCK)
  async projectLock(
    @MessageBody() data: ProjectLock,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    Logger.log(
      `Contributor ${data.contributor.id} has locked ${data.fieldCode}`,
    );
    const projectId = data.projectId;

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(projectId)) || [],
    );

    // Set lock
    const indexOfContributor = contributors.findIndex(
      value => value.id === data.contributor.id,
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
    await this.kvStore.storeObject(projectId, contributors);

    // Notify all clients
    this.server.to(projectId).emit(EventTypeEnum.PROJECT_LOCK, contributors);
  }

  @SubscribeMessage(EventTypeEnum.PROJECT_UNLOCK)
  async projectUnlock(
    @MessageBody() data: ProjectUnlock,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const projectId = data.projectId;
    Logger.log(
      `Contributor ${data.user.id} unlocked ${data.fieldCode} in ${projectId}`,
    );

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(projectId)) || [],
    );
    if (!contributors) {
      return;
    }

    // Release lock
    const indexOfContributor = contributors.findIndex(
      value => value.id === data.user.id,
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
    await this.kvStore.storeObject(projectId, contributors);

    // Notify all clients
    Logger.log(
      `Emit ${
        EventTypeEnum.PROJECT_UNLOCK
      } event to contributors in ${projectId}, contributors: ${JSON.stringify(
        contributors,
      )}`,
    );
    this.server.to(projectId).emit(EventTypeEnum.PROJECT_UNLOCK, contributors);
  }

  @SubscribeMessage(EventTypeEnum.PROJECT_UNLOCK_ALL_FIELDS)
  async projectUnlockAllFields(
    @MessageBody() data: ProjectUnlockAllFields,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const projectId = data.projectId;
    Logger.log(
      `Contributor ${data.contributor.id} unlocked all fields in ${projectId}`,
    );

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(projectId)) || [],
    );
    if (!contributors) {
      return;
    }

    // Release all fields lock
    const indexOfContributor = contributors.findIndex(
      value => value.id === data.contributor.id,
    );

    if (indexOfContributor !== -1) {
      if (contributors[indexOfContributor]) {
        contributors[indexOfContributor].fieldCodes = [];
        contributors[indexOfContributor].lastHeartBeatOccurredAt = Date.now();
      }
    }

    // Save contributors to store
    await this.kvStore.storeObject(projectId, contributors);

    // Notify all clients
    Logger.log(
      `Emit ${
        EventTypeEnum.PROJECT_UNLOCK_ALL_FIELDS
      } event to contributors in ${projectId}, contributors: ${JSON.stringify(
        contributors,
      )}`,
    );
    this.server
      .to(projectId)
      .emit(EventTypeEnum.PROJECT_UNLOCK_ALL_FIELDS, contributors);
  }

  @SubscribeMessage(EventTypeEnum.PROJECT_UPDATE_STATE)
  async projectUpdateState(
    @MessageBody() projectUpdateState: ProjectUpdateState,
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const projectId = projectUpdateState.projectId;
    Logger.log(
      `Contributor ${projectUpdateState.user.id} updated state in ${projectId}`,
    );

    // Retrieve contributors from store
    const contributors: Contributor[] = this._notifyAndRemoveNonActiveContributors(
      (await this.kvStore.getObject(projectId)) || [],
    );

    // Notify all clients
    Logger.log(
      `Emit ${
        EventTypeEnum.PROJECT_UPDATE_STATE
      } event to contributors in ${projectId}, contributors: ${JSON.stringify(
        contributors,
      )}`,
    );
    this.server
      .to(projectId)
      .emit(EventTypeEnum.PROJECT_UPDATE_STATE, projectUpdateState);
  }

  private _isContributorAlreadyLockedField(
    contributors: Contributor[],
    projectLock: ProjectLock,
  ): boolean {
    for (const contributor of contributors) {
      // Check if contributor has field code & if is locked
      if (
        contributor.projectId === projectLock.projectId &&
        contributor.fieldCodes &&
        contributor.fieldCodes.findIndex(
          fieldCode =>
            fieldCode.fieldCode === projectLock.fieldCode && fieldCode.isLocked,
        ) !== -1
      ) {
        return true;
      }
    }
    return false;
  }

  private _notifyAndRemoveNonActiveContributors(
    contributors: Contributor[],
  ): Contributor[] {
    const minimalThresholdForInactivity =
      Date.now() - this.MAX_HEARTBEAT_BEFORE_FLAGGED_AS_NON_ACTIVE;
    const nonActiveContributors = contributors.filter(
      value => value.lastHeartBeatOccurredAt < minimalThresholdForInactivity,
    );
    const stillActiveContributors = contributors.filter(
      value => value.lastHeartBeatOccurredAt >= minimalThresholdForInactivity,
    );

    if (nonActiveContributors.length) {
      for (const nonActive of nonActiveContributors) {
        // Notify still connected contributor but not active
        if (this.server.clients().sockets[nonActive.socketId]) {
          this.server
            .clients()
            .sockets[nonActive.socketId].emit(
              EventTypeEnum.PROJECT_NOTIFY_NON_ACTIVE_CONTRIBUTOR,
              nonActive,
            );
        }
      }
    }

    return stillActiveContributors;
  }
}
