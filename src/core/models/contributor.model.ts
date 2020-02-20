export interface Contributor {
  id: string;
  name: string;
  email: string;
  image: string;
  projectId: string;
  socketId: string;
  fieldCodes: FieldCode[];
  lastHeartBeatOccurredAt: number;

}

export class FieldCode {
  fieldCode: string;
  changes: any;
  isLocked: boolean;
}

