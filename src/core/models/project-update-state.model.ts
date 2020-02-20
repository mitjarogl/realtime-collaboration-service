import { Contributor } from './contributor.model';



export class ProjectUpdateState {
  user: Partial<Contributor>;
  projectId: string;
  changes: any;
}
