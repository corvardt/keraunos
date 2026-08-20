import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // What `functions/msg.js` does in production, for the dev server.
    //
    // EUMETSAT sends no CORS header and the IR layer reads its tiles back, so
    // the request cannot be made from the page. Both environments answer the
    // same path, so `ir.js` knows only that the Meteosat dishes live at `/msg`
    // and never learns which of the two is carrying it.
    proxy: {
      "/msg": {
        target: "https://view.eumetsat.int",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/msg/, "/geoserver/wms"),
      },
    },
  },
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
