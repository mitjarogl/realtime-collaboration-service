import { Contributor } from './contributor.model';

export class ProjectUnlockAllFields {
  contributor: Partial<Contributor>;
  projectId: string;
}
