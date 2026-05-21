import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

console.log('[Main] Starting React app initialization...');

try {
  const root = createRoot(document.getElementById('root'));
  console.log('[Main] Root element created');
  
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  
  console.log('[Main] App rendered successfully');
} catch (err) {
  console.error('[Main] Failed to render app:', err);
  document.getElementById('root').innerHTML = `
    <div style="padding:40px;text-align:center;color:#f87171;font-family:monospace">
      <h2>⚠ Startup Error</h2>
      <p style="font-size:12px;margin-top:8px;color:#ccc">${err.message}</p>
      <p style="font-size:10px;margin-top:8px;white-space:pre-wrap;color:#999;max-width:800px">${err.stack}</p>
    </div>
  `;
}
