import { useMemo, useState } from 'react';
import { Sidebar, type Screen } from './components/Sidebar';
import { calculate } from './lib/estimate';
import { CuttingList } from './screens/CuttingList';
import { DrawingEditor } from './screens/DrawingEditor';
import { Estimate } from './screens/Estimate';
import { Projects } from './screens/Projects';
import { SettingsScreen } from './screens/Settings';
import { useStore } from './store';

export function App() {
  const { data } = useStore();
  const [screen, setScreen] = useState<Screen>('projects');
  const [projectId, setProjectId] = useState<string | null>(data.projects[0]?.id ?? null);
  const [unitId, setUnitId] = useState<string | null>(null);

  const project = data.projects.find((p) => p.id === projectId) ?? null;
  const calc = useMemo(() => (project ? calculate(project, data.settings) : null), [project, data.settings]);

  const open = (id: string, to: Screen = 'drawing') => {
    setProjectId(id);
    setUnitId(null);
    setScreen(to);
  };

  const go = (s: Screen) => setScreen(project || s === 'projects' || s === 'settings' ? s : 'projects');

  let content;
  if (screen === 'settings') content = <SettingsScreen />;
  else if (!project || !calc || screen === 'projects') content = <Projects activeId={project?.id ?? null} open={open} openUnit={(pid, uid) => { open(pid); setUnitId(uid); }} />;
  else if (screen === 'drawing') content = <DrawingEditor project={project} unitId={unitId} setUnitId={setUnitId} go={go} />;
  else if (screen === 'cutting') content = <CuttingList project={project} calc={calc} go={go} />;
  else content = <Estimate project={project} calc={calc} go={go} />;

  return (
    <div className="app">
      <Sidebar screen={screen} go={go} projectName={project?.name} />
      <main className="main">{content}</main>
    </div>
  );
}
