import { useState } from 'react'
import Icon, { type IconName } from './components/Icon'
import { useData } from './lib/useData'
import Dashboard from './pages/Dashboard'
import Participants from './pages/Participants'
import ParticipantPage from './pages/Participant'
import Scan from './pages/Scan'
import Settings from './pages/Settings'
import Reports from './pages/Reports'
import './App.css'
const links: { path: string; name: string; icon: IconName }[] = [{ path: '/', name: 'Overview', icon: 'grid' }, { path: '/participants', name: 'Participants', icon: 'users' }, { path: '/scan', name: 'Dining scanner', icon: 'scan' }, { path: '/reports', name: 'Reports & history', icon: 'chart' }, { path: '/settings', name: 'Event settings', icon: 'settings' }]
export default function App() {
 const path = window.location.pathname; const health = useData<{connected: boolean}>('/health', 15000); const [menu, setMenu] = useState(false)
 const active = links.find(l => l.path === '/' ? path === '/' : path.startsWith(l.path))
 const detailId = path.match(/^\/participants\/([^/]+)$/)?.[1]
 let page = <div className="empty"><h1>Page not found</h1><a href="/">Back to overview</a></div>
 if (path === '/') page = <Dashboard/>
 else if (path === '/participants') page = <Participants/>
 else if (detailId) page = <ParticipantPage id={detailId}/>
 else if (path === '/scan') page = <Scan/>
 else if (path === '/settings') page = <Settings/>
 else if (path === '/reports') page = <Reports/>
 if (path === '/scan') return <Scan/>
 return <div className="app-shell"><aside className={'sidebar' + (menu ? ' mobile-open' : '')}><a className="brand" href="/"><span className="brand-mark"><Icon name="fork" size={24}/></span>tablepass<span className="brand-period">.</span></a><div className="event-card"><span className="event-monogram">E</span><div><strong>Event dining</strong><span>Local operations workspace</span></div><Icon name="chevron" size={14}/></div><p className="nav-caption">WORKSPACE</p><nav>{links.map(l => <a key={l.path} className={'nav-link' + (active?.path === l.path ? ' active' : '')} href={l.path}><Icon name={l.icon}/>{l.name}{l.path === '/scan' && <span className="nav-mini">QR</span>}</a>)}</nav><div className="sidebar-bottom"><div className="local-note"><span className="live-dot"/><strong>Made for the event floor</strong><p>One QR. Every meal.<br/>Keep the line moving.</p></div><div className="workspace-foot"><span className="mini-logo"><Icon name="fork" size={16}/></span><div>Local event network<small>Direct operational access</small></div></div></div></aside><div className="main-shell"><header className="topbar"><div className="breadcrumb"><button className="mobile-toggle" onClick={() => setMenu(!menu)} aria-label="Toggle navigation"><Icon name="grid"/></button><span>Workspace</span><span className="slash">/</span><strong>{active?.name ?? 'Participant details'}</strong></div><div className="topbar-right"><span className={'connection ' + (health.data?.connected && !health.error ? 'online' : health.loading ? '' : 'offline')}><span className="live-dot"/>{health.data?.connected && !health.error ? 'Database connected' : health.loading ? 'Connecting' : 'Database disconnected'}</span><span className="network-label"><Icon name="wifi" size={15}/> Local network</span></div></header><main>{page}</main><footer className="app-footer"><span>TABLEPASS <span className="footer-dot">·</span> EVENT DINING OPERATIONS</span><span>Keep the welcome warm. Keep the queue short.</span></footer></div></div>
}
