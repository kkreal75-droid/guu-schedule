import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  // относительные пути — сайт работает и в корне домена, и на GitHub Pages (/<repo>/)
  base: './',
})
