import { StreamingSHA256 } from './sha256';

export interface HashStartMessage {
  type: 'START_HASH';
  file: File;
  chunkSize?: number;
}

export interface HashAbortMessage {
  type: 'ABORT';
}

export type WorkerInMessage = HashStartMessage | HashAbortMessage;

export interface HashProgressMessage {
  type: 'PROGRESS';
  progress: number; // 0 to 100
  processedBytes: number;
  totalBytes: number;
}

export interface HashCompleteMessage {
  type: 'COMPLETE';
  hash: string;
  fileSizeBytes: number;
}

export interface HashErrorMessage {
  type: 'ERROR';
  error: string;
}

export type WorkerOutMessage = HashProgressMessage | HashCompleteMessage | HashErrorMessage;

let isAborted = false;

self.onmessage = async (e: MessageEvent<WorkerInMessage>) => {
  const data = e.data;

  if (data.type === 'ABORT') {
    isAborted = true;
    return;
  }

  if (data.type === 'START_HASH') {
    isAborted = false;
    const file = data.file;
    const chunkSize = data.chunkSize || 4 * 1024 * 1024; // 4 MB chunk
    const totalBytes = file.size;

    try {
      const hasher = new StreamingSHA256();
      let offset = 0;

      while (offset < totalBytes) {
        if (isAborted) {
          self.postMessage({ type: 'ERROR', error: 'Hashing aborted by user' } as HashErrorMessage);
          return;
        }

        const nextOffset = Math.min(offset + chunkSize, totalBytes);
        const slice = file.slice(offset, nextOffset);
        const arrayBuffer = await slice.arrayBuffer();
        const uint8 = new Uint8Array(arrayBuffer);

        hasher.update(uint8);
        offset = nextOffset;

        const progress = Math.min(100, Math.round((offset / totalBytes) * 100));
        self.postMessage({
          type: 'PROGRESS',
          progress,
          processedBytes: offset,
          totalBytes,
        } as HashProgressMessage);
      }

      const finalHash = hasher.digest().toLowerCase();
      self.postMessage({
        type: 'COMPLETE',
        hash: finalHash,
        fileSizeBytes: totalBytes,
      } as HashCompleteMessage);
    } catch (err: any) {
      self.postMessage({
        type: 'ERROR',
        error: err?.message || 'Failed to read file for hashing',
      } as HashErrorMessage);
    }
  }
};

