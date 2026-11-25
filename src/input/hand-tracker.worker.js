let handLandmarker = null;
let active = false;
let initialized = false;
let frameRequestId = 0;
let waitingFrame = null;
let lastTimestamp = 0;

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => reject(new Error(`timeout:${label}`)), ms);
    Promise.resolve(promise).then(
      value => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      error => {
        clearTimeout(timeoutId);
        reject(error);
      },
    );
  });
}

function nextTimestamp(timestamp) {
  lastTimestamp = Math.max(timestamp, lastTimestamp + 1);
  return lastTimestamp;
}

function requestFrame(purpose) {
  return new Promise((resolve, reject) => {
    const requestId = ++frameRequestId;
    waitingFrame = { requestId, purpose, resolve, reject };
    self.postMessage({ type: 'frame-request', requestId, purpose });
  });
}

async function fetchBytes(url, timeout, keep) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`http ${response.status}: ${url}`);
    if (!response.body || !response.body.getReader) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      self.postMessage({ type: 'progress', bytes: bytes.length });
      return keep ? bytes : null;
    }

    const reader = response.body.getReader();
    const parts = [];
    let length = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      self.postMessage({ type: 'progress', bytes: value.length });
      if (keep) parts.push(value);
    }
    if (!keep) return null;

    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`download timeout: ${url}`);
    if (error instanceof Error && error.message.includes(url)) throw error;
    throw new Error(`download failed: ${url} (${error && error.message ? error.message : String(error)})`);
  } finally {
    clearTimeout(timeoutId);
  }
}

async function benchmark(landmarker) {
  const frame = await requestFrame('benchmark');
  const times = [];
  try {
    for (let index = 0; index < 6; index++) {
      const timestamp = nextTimestamp(frame.capturedAt + index * 20);
      const startedAt = performance.now();
      landmarker.detectForVideo(frame.image, timestamp);
      const elapsed = performance.now() - startedAt;
      if (index >= 2) times.push(elapsed);
      if (index === 2 && elapsed > 250) break;
    }
  } finally {
    if (frame.image && typeof frame.image.close === 'function') frame.image.close();
  }
  times.sort((a, b) => a - b);
  return times.length ? times[Math.floor(times.length / 2)] : Infinity;
}

async function loadLandmarker(kits, preference) {
  let lastError = null;
  for (const kit of kits) {
    try {
      const module = await withTimeout(import(kit.bundle), kit.timeout, 'bundle');
      let model = null;
      for (const url of kit.models) {
        try {
          model = await fetchBytes(url, kit.timeout, true);
          break;
        } catch (error) {
          lastError = error;
        }
      }
      if (!model) continue;

      for (const file of ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
        try {
          await fetchBytes(`${kit.wasm}/${file}`, kit.timeout, false);
        } catch (error) {
          lastError = error;
        }
      }

      const fileset = await withTimeout(module.FilesetResolver.forVisionTasks(kit.wasm, true), kit.timeout, 'wasm');
      const loaderModule = await withTimeout(import(/* @vite-ignore */ fileset.wasmLoaderPath), kit.timeout, 'wasm-loader');
      const moduleFactory = loaderModule.default || self.ModuleFactory;
      if (typeof moduleFactory !== 'function') throw new Error('MediaPipe WASM module factory is unavailable');
      const order = preference === 'CPU' ? ['CPU'] : preference === 'GPU' ? ['GPU'] : ['GPU', 'CPU'];
      let best = null;
      let bestMs = Infinity;
      let bestDelegate = '';
      for (const delegate of order) {
        let candidate;
        try {
          self.ModuleFactory = moduleFactory;
          const options = {
            baseOptions: { modelAssetBuffer: model.slice(), delegate },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.5,
            minHandPresenceConfidence: 0.5,
            minTrackingConfidence: 0.5,
          };
          if (delegate === 'GPU' && typeof OffscreenCanvas === 'function') options.canvas = new OffscreenCanvas(1, 1);
          candidate = await withTimeout(module.HandLandmarker.createFromOptions(fileset, options), kit.timeout, 'init');
        } catch (error) {
          lastError = error;
          continue;
        }

        self.postMessage({ type: 'status', message: `AIの速さを測っています…（${delegate}）` });
        let elapsed;
        try {
          elapsed = await benchmark(candidate);
        } catch (error) {
          lastError = error;
          candidate.close();
          continue;
        }

        if (elapsed < bestMs) {
          if (best) best.close();
          best = candidate;
          bestMs = elapsed;
          bestDelegate = delegate;
        } else {
          candidate.close();
        }
        if (bestMs <= 25) break;
      }

      if (best) return { landmarker: best, name: kit.name, delegate: bestDelegate, ms: bestMs };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('AI load failed');
}

function requestNextTrackingFrame() {
  if (!active || waitingFrame) return;
  const requestId = ++frameRequestId;
  waitingFrame = { requestId, purpose: 'tracking' };
  self.postMessage({ type: 'frame-request', requestId, purpose: 'tracking' });
}

async function initialize(data) {
  if (initialized) return;
  initialized = true;
  try {
    const loaded = await loadLandmarker(data.kits, data.delegatePreference);
    handLandmarker = loaded.landmarker;
    self.postMessage({ type: 'ready', name: loaded.name, delegate: loaded.delegate, ms: loaded.ms });
  } catch (error) {
    self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
  }
}

function handleFrame(data) {
  if (!waitingFrame || data.requestId !== waitingFrame.requestId) {
    if (data.image && typeof data.image.close === 'function') data.image.close();
    return;
  }
  const pending = waitingFrame;
  waitingFrame = null;
  if (pending.purpose === 'benchmark') pending.resolve(data);
  else void detect(data);
}

function handleFrameError(data) {
  if (!waitingFrame || data.requestId !== waitingFrame.requestId) return;
  const pending = waitingFrame;
  waitingFrame = null;
  if (pending.purpose === 'benchmark') pending.reject(new Error(data.message || 'Could not capture a camera frame'));
  else {
    self.postMessage({ type: 'error', message: data.message || 'Could not capture a camera frame' });
    requestNextTrackingFrame();
  }
}

function detect(data) {
  const startedAt = performance.now();
  try {
    const result = handLandmarker.detectForVideo(data.image, nextTimestamp(data.capturedAt));
    self.postMessage({
      type: 'result',
      sequence: data.requestId,
      capturedAt: data.capturedAt,
      inputWidth: data.inputWidth,
      inferenceMs: performance.now() - startedAt,
      landmarks: result && result.landmarks ? result.landmarks : [],
    });
  } catch (error) {
    self.postMessage({ type: 'error', message: error && error.message ? error.message : String(error) });
  } finally {
    if (data.image && typeof data.image.close === 'function') data.image.close();
    requestNextTrackingFrame();
  }
}

self.addEventListener('message', event => {
  const data = event.data;
  if (!data) return;
  if (data.type === 'initialize') void initialize(data);
  else if (data.type === 'frame') handleFrame(data);
  else if (data.type === 'frame-error') handleFrameError(data);
  else if (data.type === 'resume') {
    active = true;
    requestNextTrackingFrame();
  } else if (data.type === 'pause') {
    active = false;
  } else if (data.type === 'dispose') {
    active = false;
    if (handLandmarker) handLandmarker.close();
    self.close();
  }
});
