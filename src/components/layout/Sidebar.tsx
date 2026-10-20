import { NavLink } from 'react-router-dom';
import { Building2, FlaskConical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { navItems } from './navigation';
import { Logo } from './Logo';
import { useWorkspaceSession } from '../../auth/WorkspaceSession';
import { useDemo } from '../../context/DemoContext';

/**
 * The main navigation. On large screens it can be collapsed to an icon rail
 * (`collapsed`), with `onToggleCollapse` switching between the two.
 */
export function SidebarContent({ onNavigate, collapsed = false, onToggleCollapse }: { onNavigate?: () => void; collapsed?: boolean; onToggleCollapse?: () => void }) {
  const { workspace } = useDemo();
  const session = useWorkspaceSession();
  // A real workspace never shows the sample company's name.
  const companyName = session.mode === 'real' ? session.membership.companyName ?? 'Your company' : workspace.companyName;
  const departmentName = session.mode === 'real' ? null : workspace.departmentName;
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <div className="flex h-full flex-col bg-navy-900 text-navy-200">
      <div className={collapsed ? 'flex flex-col items-center px-2 pb-4 pt-5' : 'px-5 pb-4 pt-5'}>
        <Logo compact={collapsed} />
        {collapsed ? (
          <span className="mt-5 flex h-9 w-9 items-center justify-center rounded-lg bg-navy-800" title={companyName}>
            <Building2 className="h-4 w-4 text-navy-300" aria-hidden />
            <span className="sr-only">{companyName}</span>
          </span>
        ) : (
          <div className="mt-5 flex items-center gap-2 rounded-lg bg-navy-800 px-3 py-2.5">
            <Building2 className="h-4 w-4 shrink-0 text-navy-300" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{companyName}</p>
              {departmentName && <p className="truncate text-xs text-navy-300">{departmentName}</p>}
            </div>
          </div>
        )}
      </div>
      <nav aria-label="Main" className={`flex-1 overflow-y-auto ${collapsed ? 'px-2' : 'px-3'}`}>
        <ul className="space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={onNavigate}
                title={collapsed ? label : undefined}
                className={({ isActive }) =>
                  `flex items-center rounded-lg py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300 ${
                    collapsed ? 'justify-center px-2' : 'gap-3 px-3'
                  } ${isActive ? 'bg-navy-700 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-teal-300' : 'text-navy-300'}`} aria-hidden />
                    <span className={collapsed ? 'sr-only' : undefined}>{label}</span>
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      {session.mode === 'demo' &&
        (collapsed ? (
          <span className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-lg border border-navy-700" title="Demo workspace: all figures are sample data">
            <FlaskConical className="h-4 w-4 text-teal-300" aria-hidden />
            <span className="sr-only">Demo workspace</span>
          </span>
        ) : (
          <div className="m-3 rounded-lg border border-navy-700 px-3 py-2.5 text-xs text-navy-300">
            <p className="flex items-center gap-1.5 font-medium text-navy-200">
              <FlaskConical className="h-3.5 w-3.5 text-teal-300" aria-hidden /> Demo workspace
            </p>
            <p className="mt-1 leading-relaxed">All figures are sample data. No live providers or billing are connected.</p>
          </div>
        ))}
      {onToggleCollapse && (
        <div className={`border-t border-navy-800 py-2 ${collapsed ? 'px-2' : 'px-3'}`}>
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className={`flex w-full items-center rounded-lg py-2 text-sm text-navy-300 transition-colors hover:bg-navy-800 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300 ${
              collapsed ? 'justify-center px-2' : 'gap-3 px-3'
            }`}
          >
            <ToggleIcon className="h-4 w-4 shrink-0" aria-hidden />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      )}
    </div>
  );
}
