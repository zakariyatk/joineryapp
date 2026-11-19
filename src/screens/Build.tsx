import type { Screen } from '../components/Sidebar';
import type { Project } from '../types';
import { Build3D } from './Build3D';
import { BuildDraw } from './BuildDraw';

interface Props { project: Project; go(s: Screen): void }

/** Build: draw the plan, or look at it in 3D. Projects saved in the old wall-length mode open on Draw plan. */
export function Build({ project, go }: Props) {
  return project.buildMode === '3d' ? <Build3D project={project} go={go} /> : <BuildDraw project={project} go={go} />;
}
