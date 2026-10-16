import { FlaskConical, Menu } from 'lucide-react';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { useDemo } from '../../context/DemoContext';
import { useToast } from '../../context/ToastContext';
import { formatPeriod } from '../../lib/format';
import { roleLabels } from '../../lib/permissions';
import { SelectField } from '../ui/SelectField';
import { ProfileMenu } from './ProfileMenu';
import type { Role } from '../../types';

export function DemoDataLabel() {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">
      <FlaskConical className="h-3.5 w-3.5" aria-hidden />
      Demo workspace — sample data
    </span>
  );
}

export function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { role, setRole, period, setPeriod, workspace } = useDemo();
  const notify = useToast();
  // The demo label, period and role switcher belong to the sample workspace only.
  // A real member's role comes from their membership and can't be changed here.
  const isDemo = useWorkspaceSession().mode === 'demo';

  const changeRole = (next: string) => {
    setRole(next as Role);
    notify(`Now previewing as ${roleLabels[next as Role]}. Data on every page is re-scoped for this role.`, 'info');
  };

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 px-4 py-2.5 sm:gap-x-3 sm:px-6">
        <button type="button" onClick={onOpenNav} className="rounded-md p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-teal-600 lg:hidden" aria-label="Open navigation">
          <Menu className="h-5 w-5" aria-hidden />
        </button>
        {isDemo && <DemoDataLabel />}
        {isDemo && (
          <div className="order-last flex w-full gap-2 sm:order-none sm:ml-auto sm:w-auto">
            <SelectField
              label="Reporting period"
              hideLabel
              value={period}
              onChange={setPeriod}
              options={workspace.periods.map((p) => ({ value: p, label: formatPeriod(p) }))}
              className="flex-1 sm:w-44 sm:flex-none"
            />
            <SelectField
              label="Demo role"
              hideLabel
              value={role}
              onChange={changeRole}
              options={(Object.keys(roleLabels) as Role[]).map((r) => ({ value: r, label: `View as: ${roleLabels[r]}` }))}
              className="flex-1 sm:w-56 sm:flex-none"
            />
          </div>
        )}
        <div className={isDemo ? 'ml-auto sm:ml-0' : 'ml-auto'}>
          <ProfileMenu />
        </div>
      </div>
    </header>
  );
}
