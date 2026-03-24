import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'path';
import { componentTagger } from 'lovable-tagger';
import { handleWspScreenerRequest } from './server/wsp-screener-route';
import { handleWspSymbolDetailRequest } from './server/wsp-symbol-detail-route';

function wspApiPlugin(): Plugin {
  const middleware = async (req: any, res: any, next: () => void) => {
    if (req.url?.startsWith('/api/wsp-screener')) {
      await handleWspScreenerRequest(req, res);
      return;
    }
    if (req.url?.startsWith('/api/wsp-symbol-detail')) {
      await handleWspSymbolDetailRequest(req, res);
      return;
    }
    next();
  };

  return {
    name: 'wsp-api-plugin',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => ({
  server: {
    host: '::',
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [react(), wspApiPlugin(), mode === 'development' && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
}));
