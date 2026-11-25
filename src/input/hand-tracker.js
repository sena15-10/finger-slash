import { TUNING } from '../config.js';

const INPUT = TUNING.ai;
const HIGH_INPUT_WIDTH = INPUT.inputWidth;
const LOW_INPUT_WIDTH = INPUT.minInputWidth;
const SLOW_FRAME_MS = INPUT.reduceAtMs;
const FAST_FRAME_MS = INPUT.restoreAtMs;
const SLOW_WINDOW_MS = INPUT.reduceAfterMs;
const FAST_WINDOW_MS = INPUT.restoreAfterMs;

export function createAdaptiveFrameSize({
  highWidth = HIGH_INPUT_WIDTH,
  lowWidth = LOW_INPUT_WIDTH,
  slowFrameMs = SLOW_FRAME_MS,
  fastFrameMs = FAST_FRAME_MS,
  slowWindowMs = SLOW_WINDOW_MS,
  fastWindowMs = FAST_WINDOW_MS,
} = {}) {
  let maxWidth = highWidth;
  let slowSince = null;
  let fastSince = null;

  return {
    get maxWidth() {
      return maxWidth;
    },
    update(frameMs, now) {
      if (!Number.isFinite(frameMs) || !Number.isFinite(now)) return maxWidth;

      if (maxWidth === highWidth) {
        fastSince = null;
        if (frameMs < slowFrameMs) {
          slowSince = null;
        } else {
          if (slowSince === null) slowSince = now;
          if (now - slowSince >= slowWindowMs) {
            maxWidth = lowWidth;
            slowSince = null;
          }
        }
      } else {
        slowSince = null;
        if (frameMs > fastFrameMs) {
          fastSince = null;
        } else {
          if (fastSince === null) fastSince = now;
          if (now - fastSince >= fastWindowMs) {
            maxWidth = highWidth;
            fastSince = null;
          }
        }
      }

      return maxWidth;
    },
  };
}

export function getFrameDimensions(video, maxWidth) {
  const sourceWidth = video.videoWidth || 640;
  const sourceHeight = video.videoHeight || 360;
  const scale = Math.min(1, maxWidth / sourceWidth);
  return {
    width: Math.max(1, Math.round(sourceWidth * scale)),
    height: Math.max(1, Math.round(sourceHeight * scale)),
  };
}

function createWorker() {
  if (typeof Worker === 'undefined') throw new Error('Web Workers are not supported');
  return new Worker(new URL('./hand-tracker.worker.js', import.meta.url), { type: 'module' });
}

async function createResizedBitmap(video, size) {
  if (typeof createImageBitmap !== 'function') throw new Error('ImageBitmap is not supported');
  try {
    return await createImageBitmap(video, {
      resizeWidth: size.width,
      resizeHeight: size.height,
      resizeQuality: 'medium',
    });
  } catch (resizeError) {
    try {
      return await createImageBitmap(video);
    } catch (error) {
      throw new Error(error.message || resizeError.message || 'Could not create a camera frame');
    }
  }
}

export function createHandTracker({
  video,
  kits,
  delegatePreference = '',
  onProgress = () => {},
  onStatus = () => {},
  onReady = () => {},
  onResult = () => {},
  onError = () => {},
  onFatal = () => {},
  workerFactory = createWorker,
  bitmapFactory = createResizedBitmap,
  now = () => performance.now(),
  adaptiveFrameSize = createAdaptiveFrameSize(),
}) {
  let worker = null;
  let startPromise = null;
  let resolveStart = null;
  let rejectStart = null;
  let started = false;
  let disposed = false;
  let active = false;
  let capturing = false;
  let waitingRequest = null;
  let info = null;

  function reportError(error) {
    onError(error instanceof Error ? error : new Error(String(error)));
  }

  function fail(error) {
    if (disposed) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    if (!started) {
      started = true;
      rejectStart(failure);
      return;
    }
    reportError(failure);
  }

  function failFatal(error) {
    if (disposed) return;
    const failure = error instanceof Error ? error : new Error(String(error));
    if (!started) {
      fail(failure);
      return;
    }
    dispose();
    onFatal(failure);
  }

  function handleMessage({ data }) {
    if (!data || disposed) return;
    if (data.type === 'progress') onProgress(data.bytes);
    else if (data.type === 'status') onStatus(data.message);
    else if (data.type === 'frame-request') {
      waitingRequest = data;
      void captureNextFrame();
    } else if (data.type === 'ready') {
      info = { name: data.name, delegate: data.delegate, ms: data.ms };
      started = true;
      onReady(info);
      resolveStart(info);
    } else if (data.type === 'result') {
      adaptiveFrameSize.update(data.inferenceMs, now());
      onResult(data);
    } else if (data.type === 'frame-error' || data.type === 'error') {
      fail(new Error(data.message || 'Hand tracking worker failed'));
    }
  }

  async function captureNextFrame() {
    if (disposed || capturing || !waitingRequest) return;
    if (waitingRequest.purpose !== 'benchmark' && !active) return;

    const request = waitingRequest;
    waitingRequest = null;
    capturing = true;
    const capturedAt = now();
    const size = getFrameDimensions(video, adaptiveFrameSize.maxWidth);
    let bitmap;
    try {
      bitmap = await bitmapFactory(video, size);
      if (disposed || (request.purpose !== 'benchmark' && !active)) {
        if (bitmap && typeof bitmap.close === 'function') bitmap.close();
        waitingRequest = request;
        return;
      }
      worker.postMessage({
        type: 'frame',
        requestId: request.requestId,
        capturedAt,
        inputWidth: size.width,
        image: bitmap,
      }, [bitmap]);
    } catch (error) {
      if (bitmap && typeof bitmap.close === 'function') bitmap.close();
      if (!disposed && worker) {
        worker.postMessage({
          type: 'frame-error',
          requestId: request.requestId,
          message: error && error.message ? error.message : String(error),
        });
      }
    } finally {
      capturing = false;
      if (waitingRequest) void captureNextFrame();
    }
  }

  function start() {
    if (startPromise) return startPromise;
    if (disposed) return Promise.reject(new Error('Hand tracking worker has been disposed'));

    startPromise = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    try {
      worker = workerFactory();
      worker.onmessage = handleMessage;
      worker.onerror = event => failFatal(event && event.message ? event.message : 'Hand tracking worker crashed');
      worker.onmessageerror = () => failFatal('Could not read a message from the hand tracking worker');
      const workerKits = typeof kits === 'function' ? kits() : kits;
      worker.postMessage({ type: 'initialize', kits: workerKits, delegatePreference });
    } catch (error) {
      fail(error);
    }
    return startPromise;
  }

  function setActive(value) {
    active = !!value;
    if (!worker || disposed || !started) return;
    worker.postMessage({ type: active ? 'resume' : 'pause' });
    if (active) void captureNextFrame();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    waitingRequest = null;
    if (!started && rejectStart) {
      started = true;
      rejectStart(new Error('Hand tracking worker was stopped'));
    }
    if (worker) worker.terminate();
    worker = null;
  }

  return {
    start,
    resume() {
      setActive(true);
    },
    pause() {
      setActive(false);
    },
    dispose,
    get ready() {
      return started && !disposed;
    },
    get info() {
      return info;
    },
    get inputWidth() {
      return adaptiveFrameSize.maxWidth;
    },
  };
}
