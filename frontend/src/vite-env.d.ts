/// <reference types="vite/client" />

interface Window {
  io?: {
    on: (event: string, callback: (data: any) => void) => void;
    off: (event: string, callback: (data: any) => void) => void;
    emit: (event: string, data: any) => void;
  };
}
