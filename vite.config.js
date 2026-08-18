import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  css: {
    postcss: {
      plugins: [tailwindcss(), autoprefixer()],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // React and the country outlines change on nobody's schedule; the app
        // changes on every deploy. Split, so a return visit re-fetches only
        // what actually moved.
        manualChunks: {
          react: ['react', 'react-dom'],
          world: ['./src/lib/world.json'],
        },
      },
    },
  },
})
