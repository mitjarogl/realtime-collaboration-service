import { Contributor } from './contributor.model';



export class ResourceUpdateState {
  user: Partial<Contributor>;
  resourceId: string;
  changes: any;
}
