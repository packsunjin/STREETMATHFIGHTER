import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // admin-server는 단독 실행(루트 경로)될 수도, 통합 서버에서 /admin 아래에
  // 마운트되어 실행될 수도 있음. 절대 경로를 쓰면 /admin 마운트 시 깨지므로
  // 항상 상대 경로로 에셋을 참조하게 함(index.js/dashboard.js와 동일한 규칙).
  base: './',
  plugins: [react()],
})
