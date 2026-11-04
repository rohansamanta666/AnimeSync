import { useState, useRef, useCallback, useEffect } from 'react';
import { WorkerOutMessage } from '../workers/sha256.worker';

interface UseFileHasherResult {
  hashFile: (file: File) => Promise<{ hash: string; fileSizeBytes: number }>;
  progress: number;
  processedBytes: number;
  totalBytes: number;
  isHashing: boolean;
  error: string | null;
  cancel: () => void;
  reset: () => void;
}

export function useFileHasher(): UseFileHasherResult {
  const [progress, setProgress] = useState<number>(0);
  const [processedBytes, setProcessedBytes] = useState<number>(0);
  const [totalBytes, setTotalBytes] = useState<number>(0);
  const [isHashing, setIsHashing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const resolverRef = useRef<((res: { hash: string; fileSizeBytes: number }) => void) | null>(null);
  const rejecterRef = useRef<((err: Error) => void) | null>(null);

  const initWorker = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }

    const worker = new Worker(new URL('../workers/sha256.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerOutMessage>) => {
      const data = e.data;
      if (data.type === 'PROGRESS') {
        setProgress(data.progress);
        setProcessedBytes(data.processedBytes);
        setTotalBytes(data.totalBytes);
      } else if (data.type === 'COMPLETE') {
        setIsHashing(false);
        setProgress(100);
        if (resolverRef.current) {
          resolverRef.current({ hash: data.hash, fileSizeBytes: data.fileSizeBytes });
          resolverRef.current = null;
          rejecterRef.current = null;
        }
      } else if (data.type === 'ERROR') {
        setIsHashing(false);
        setError(data.error);
        if (rejecterRef.current) {
          rejecterRef.current(new Error(data.error));
          resolverRef.current = null;
          rejecterRef.current = null;
        }
      }
    };

    workerRef.current = worker;
    return worker;
  }, []);

  const hashFile = useCallback(
    (file: File): Promise<{ hash: string; fileSizeBytes: number }> => {
      setError(null);
      setProgress(0);
      setProcessedBytes(0);
      setTotalBytes(file.size);
      setIsHashing(true);

      const worker = initWorker();

      return new Promise((resolve, reject) => {
        resolverRef.current = resolve;
        rejecterRef.current = reject;

        worker.postMessage({
          type: 'START_HASH',
          file,
        });
      });
    },
    [initWorker]
  );

  const cancel = useCallback(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'ABORT' });
      workerRef.current.terminate();
      workerRef.current = null;
    }
    setIsHashing(false);
    setError('Hashing cancelled');
    if (rejecterRef.current) {
      rejecterRef.current(new Error('Hashing cancelled'));
      resolverRef.current = null;
      rejecterRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    cancel();
    setProgress(0);
    setProcessedBytes(0);
    setTotalBytes(0);
    setError(null);
    setIsHashing(false);
  }, [cancel]);

  useEffect(() => {
    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, []);

  return {
    hashFile,
    progress,
    processedBytes,
    totalBytes,
    isHashing,
    error,
    cancel,
    reset,
  };
}
