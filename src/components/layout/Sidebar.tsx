import { NavLink } from 'react-router-dom';
import { Building2, FlaskConical } from 'lucide-react';
import { navItems } from './navigation';
import { Logo } from './Logo';
import { useDemo } from '../../context/DemoContext';

export function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { workspace } = useDemo();
  return (
    <div className="flex h-full flex-col bg-navy-900 text-navy-200">
      <div className="px-5 pb-4 pt-5">
        <Logo />
        <div className="mt-5 flex items-center gap-2 rounded-lg bg-navy-800 px-3 py-2.5">
          <Building2 className="h-4 w-4 shrink-0 text-navy-300" aria-hidden />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{workspace.companyName}</p>
            <p className="truncate text-xs text-navy-300">{workspace.departmentName}</p>
          </div>
        </div>
      </div>
      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3">
        <ul className="space-y-0.5">
          {navItems.map(({ to, label, icon: Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                end={to === '/'}
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-300 ${
                    isActive ? 'bg-navy-700 text-white' : 'text-navy-200 hover:bg-navy-800 hover:text-white'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon className={`h-4 w-4 ${isActive ? 'text-teal-300' : 'text-navy-300'}`} aria-hidden />
                    {label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="m-3 rounded-lg border border-navy-700 px-3 py-2.5 text-xs text-navy-300">
        <p className="flex items-center gap-1.5 font-medium text-navy-200">
          <FlaskConical className="h-3.5 w-3.5 text-teal-300" aria-hidden /> Demo workspace
        </p>
        <p className="mt-1 leading-relaxed">All figures are sample data. No live providers or billing are connected.</p>
      </div>
    </div>
  );
}
