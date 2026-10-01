import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './styles/globals.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { NestboxMark } from './components/NestboxMark';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');
createRoot(root).render(
  <StrictMode>
    <div className="flex h-full items-center justify-center gap-3 bg-app">
      <NestboxMark className="size-10" />
      <span className="font-mono text-fg">nestbox</span>
    </div>
  </StrictMode>,
);
