import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the bundle also loads from the desktop app's app:// origin
export default defineConfig({ base: './', plugins: [react()], server: { port: 5180 } });
