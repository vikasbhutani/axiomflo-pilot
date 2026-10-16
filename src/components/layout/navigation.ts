import { Bot, FileBarChart, LayoutDashboard, PlugZap, Settings, Table2, Users, type LucideIcon } from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

export const navItems: NavItem[] = [
  { to: '/', label: 'Overview', icon: LayoutDashboard },
  { to: '/usage', label: 'Usage Explorer', icon: Table2 },
  { to: '/teams', label: 'Teams & Users', icon: Users },
  { to: '/providers', label: 'AI Providers', icon: PlugZap },
  { to: '/showback', label: 'Monthly Showback', icon: FileBarChart },
  { to: '/assistant', label: 'AI Cost Assistant', icon: Bot },
  { to: '/settings', label: 'Settings', icon: Settings },
];
