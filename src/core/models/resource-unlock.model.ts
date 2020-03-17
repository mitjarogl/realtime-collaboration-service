import { Contributor } from './contributor.model';


export class ResourceUnlock {
  user: Partial<Contributor>;
  resourceId: string;
  fieldCode: string;
  changes?: any;
}
