import http from 'node:http';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig({
  base: '/app/aksk/',
  plugins: [vue(), qiankun('aksk', { useDevMode: true })],
  server: {
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    proxy: {
      // 禁用 keep-alive：后端/nginx 重启后 proxy 不复用死连接（否则窗口期全 502）
      '/api': { target: 'http://localhost:8280', agent: new http.Agent({ keepAlive: false }) }
    }
  }
});
