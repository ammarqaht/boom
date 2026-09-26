import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

/*
 * ختمُ البناء.
 *
 * المتصفّح يخزّن الصفحة، فيبقى يعرض حزمةَ الأمس وعللاً أُصلحت — ولا سبيل
 * إلى الجزم أيُّ نسخةٍ تعمل إلا بأن تقولها النسخةُ نفسها. فيُحقن الوقتُ
 * هنا، ويُقرأ في أسفل الشريط الجانبيّ.
 */
const BUILD = new Date()
  .toLocaleString('sv-SE', { timeZone: 'Asia/Riyadh' })
  .slice(0, 16);

export default defineConfig({
  define: { __BUILD__: JSON.stringify(BUILD) },
  plugins: [react(), tailwindcss()],
  server: {
    // أثناء التطوير: الواجهة على 5173 والسيرفر على 3000
    proxy: {
      '/api': 'http://localhost:3000',
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
})
