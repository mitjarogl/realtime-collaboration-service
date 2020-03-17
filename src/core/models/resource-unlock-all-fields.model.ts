import { Contributor } from './contributor.model';

export class ResourceUnlockAllFields {
  contributor: Partial<Contributor>;
  resourceId: string;
}
