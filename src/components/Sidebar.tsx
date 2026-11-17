import type { ReactNode } from 'react';
import { useStore } from '../store';
import { IconBuild, IconCalc, IconDrawing, IconList, IconProjects, IconSettings, Logo } from './Icons';

export type Screen = 'projects' | 'build' | 'drawing' | 'cutting' | 'estimate' | 'settings';

interface Props {
  screen: Screen;
  go(s: Screen): void;
  projectName?: string;
}

function Nav({ on, disabled, onClick, icon, children }: { on: boolean; disabled?: boolean; onClick(): void; icon: ReactNode; children: ReactNode }) {
  return (
    <button type="button" className={on ? 'nav on' : 'nav'} aria-current={on ? 'page' : undefined} disabled={disabled} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

const SAVE_TEXT = { loading: 'Loading…', saved: 'All changes saved', saving: 'Saving…', error: 'Could not save – check disk' } as const;

export function Sidebar({ screen, go, projectName }: Props) {
  const { saveState } = useStore();
  const noProject = !projectName;
  return (
    <nav className="side" aria-label="Main">
      <div className="brand"><Logo />JoineryApp</div>
      <div className="navlabel">Workspace</div>
      <Nav on={screen === 'projects'} onClick={() => go('projects')} icon={<IconProjects />}>Projects</Nav>
      <Nav on={screen === 'build'} disabled={noProject} onClick={() => go('build')} icon={<IconBuild />}>Build</Nav>
      <Nav on={screen === 'drawing'} disabled={noProject} onClick={() => go('drawing')} icon={<IconDrawing />}>Drawings</Nav>
      <Nav on={screen === 'cutting'} disabled={noProject} onClick={() => go('cutting')} icon={<IconList />}>Cutting list</Nav>
      <Nav on={screen === 'estimate'} disabled={noProject} onClick={() => go('estimate')} icon={<IconCalc />}>Estimate &amp; quote</Nav>
      <div className="navlabel">Setup</div>
      <Nav on={screen === 'settings'} onClick={() => go('settings')} icon={<IconSettings />}>Materials &amp; rates</Nav>
      <div className="side-foot">
        {projectName && <><span>Open project</span><span className="side-project">{projectName}</span></>}
        <span style={{ marginTop: 8 }} role="status">
          <span className={`dot ${saveState === 'saving' ? 'saving' : saveState === 'error' ? 'error' : ''}`} />
          {SAVE_TEXT[saveState]}
        </span>
      </div>
    </nav>
  );
}
