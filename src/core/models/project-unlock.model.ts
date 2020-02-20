import { Contributor } from './contributor.model';


export class ProjectUnlock {
  user: Partial<Contributor>;
  projectId: string;
  fieldCode: string;
  changes?: any;
}
