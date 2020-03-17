export interface Contributor {
  id: string;
  name: string;
  email: string;
  image: string;
  resourceId: string;
  socketId: string;
  fieldCodes: FieldCode[];
  lastHeartBeatOccurredAt: number;
}

export class FieldCode {
  fieldCode: string;
  changes: any;
  isLocked: boolean;
}
