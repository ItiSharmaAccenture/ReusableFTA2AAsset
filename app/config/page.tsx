import type { Metadata } from 'next';
import { Plus_Jakarta_Sans } from 'next/font/google';

import ConfigPanel from '@/components/config/ConfigPanel';
import { getCopilotModeState } from '@/lib/copilot-mode';
import './config.css';

const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Configuration — CMTPlay My Day',
};

export const dynamic = 'force-dynamic';

/** /config — operator settings. Currently one: the Copilot demo mode. */
export default async function ConfigPage() {
  const initial = await getCopilotModeState();
  return <ConfigPanel initial={initial} fontClassName={jakarta.variable} />;
}
