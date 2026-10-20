import { NavLink } from 'react-router-dom';
import { Bot, TrendingDown } from 'lucide-react';

/** Switches between the assistant's chat and its Upgrade Analysis view. */
export function AssistantTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${isActive ? 'border-teal-700 text-teal-900' : 'border-transparent text-slate-600 hover:text-slate-900'}`;
  return (
    <nav aria-label="AI Cost Assistant" className="mb-4 flex gap-1 border-b border-slate-200">
      <NavLink to="/assistant" end className={tab}>
        <Bot className="h-4 w-4" aria-hidden /> Chat
      </NavLink>
      <NavLink to="/assistant/upgrade" className={tab}>
        <TrendingDown className="h-4 w-4" aria-hidden /> Upgrade Analysis
      </NavLink>
    </nav>
  );
}
