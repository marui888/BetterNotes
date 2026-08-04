/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.js` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */


// import './index.css';

// console.log(
//   '👋 This message is being logged by "renderer.js", included via Vite',
// );


import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fortawesome/fontawesome-free/css/all.min.css'
import '../index.css'
import App from './App'

const rendererStartMs = performance.now()

function logRendererStartup(label) {
  console.log(`[startup:renderer] ${label} +${Math.round(performance.now() - rendererStartMs)}ms`)
}

async function mountRoot() {
  logRendererStartup('entry')
  const root = createRoot(document.getElementById('root'))

  if (window.location.hash === '#debug') {
    const { default: DebugWindow } = await import('./debug/DebugWindow')
    logRendererStartup('DebugWindow module loaded')
    root.render(<DebugWindow />)
  } else {
    root.render(<App />)
  }

  logRendererStartup('root render requested')
}

mountRoot()
