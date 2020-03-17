import { Contributor } from './contributor.model';

export class ResourceLock {
  contributor: Partial<Contributor>;
  resourceId: string;
  fieldCode: string;
}
