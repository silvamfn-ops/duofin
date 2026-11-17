// Web Worker for 100% local receipt OCR using Tesseract.js
// Install dependency: npm install tesseract.js

import { createWorker, Worker } from 'tesseract.js';

let workerInstance: Worker | null = null;

self.onmessage = async (event: MessageEvent<{ type: 'SCAN' | 'TERMINATE'; imageBlob?: Blob | string }>) => {
  const { type, imageBlob } = event.data;

  if (type === 'TERMINATE') {
    if (workerInstance) {
      await workerInstance.terminate();
      workerInstance = null;
    }
    self.close();
    return;
  }

  if (type === 'SCAN' && imageBlob) {
    try {
      self.postMessage({ status: 'LOADING_ENGINE' });

      if (!workerInstance) {
        workerInstance = await createWorker('por', 1, {
          logger: (m) => {
            if (m.status === 'recognizing text') {
              self.postMessage({ status: 'PROGRESS', progress: Math.round(m.progress * 100) });
            }
          },
        });
      }

      self.postMessage({ status: 'RECOGNIZING' });
      const { data } = await workerInstance.recognize(imageBlob);

      self.postMessage({
        status: 'SUCCESS',
        text: data.text,
        confidence: data.confidence,
      });
    } catch (error) {
      self.postMessage({
        status: 'ERROR',
        error: error instanceof Error ? error.message : 'Erro desconhecido no OCR local',
      });
    }
  }
};
