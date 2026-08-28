/** Webview entry: mount the React root. Vite lib-mode entry (media/main.js). */

import { createRoot } from 'react-dom/client'
import { App } from './App'
import { SettingsApp } from './SettingsApp'
import './styles/base.css'

const container = document.getElementById('root')
if (container === null) throw new Error('missing #root container')
const surface = document.body.dataset['dshSurface']
createRoot(container).render(surface === 'settings' ? <SettingsApp /> : <App />)
