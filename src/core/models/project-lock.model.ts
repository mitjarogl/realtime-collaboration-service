import { Contributor } from './contributor.model';

export class ProjectLock {
  contributor: Partial<Contributor>;
  projectId: string;
  fieldCode: string;
}
