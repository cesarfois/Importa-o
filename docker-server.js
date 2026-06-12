/**
 * @file docker-server.js
 * @description Production server for Docker environment.
 * Imports the proxy app and adds static file serving for the Vite build.
 * proxy-server.js stays untouched for Netlify / local dev.
 */

import path from 'path';
import express from 'express';
import { fileURLToPath } from 'url';

// Import the proxy app (all proxy routes, API routes, scheduler, tokenManager)
// proxy-server.js won't auto-start since it's being imported, not run directly
import app from './proxy-server.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 5173;
const distPath = path.join(__dirname, 'dist');

// ----------------------------------------------------------------------------
// Static File Serving
// ----------------------------------------------------------------------------

app.use(express.static(distPath));

// SPA fallback: serve index.html for client-side routes
app.use((req, res, next) => {
  // Don't intercept API/proxy paths
  if (
    req.path.startsWith('/api/') ||
    req.path.startsWith('/DocuWare') ||
    req.path.startsWith('/docuware-proxy') ||
    req.path.startsWith('/discovery')
  ) {
    return next();
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// ----------------------------------------------------------------------------
// Start Server
// ----------------------------------------------------------------------------

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`===============================================`);
  console.log(`   RCSVision Docker Server`);
  console.log(`   Port:   ${PORT}`);
  console.log(`   Static: ${distPath}`);
  console.log(`   Proxy:  Active`);
  console.log(`===============================================`);
});

server.setTimeout(300000);
