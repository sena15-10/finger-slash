import assert from 'node:assert/strict';
import test from 'node:test';
import { createAdaptiveFrameSize, createHandTracker, getFrameDimensions } from '../src/input/hand-tracker.js';

function createFakeWorker() {
  return {
    messages: [],
    terminated: false,
    postMessage(message) {
      this.messages.push(message);
    },
    emit(data) {
      this.onmessage({ data });
    },
    terminate() {
      this.terminated = true;
    },
  };
}

function readyTracker({ bitmapFactory, video = { videoWidth: 1280, videoHeight: 720 } }) {
  const worker = createFakeWorker();
  const tracker = createHandTracker({
    video,
    kits: [],
    workerFactory: () => worker,
    bitmapFactory,
  });
  const ready = tracker.start();
  worker.emit({ type: 'ready', name: 'test', delegate: 'CPU', ms: 12 });
  return { worker, tracker, ready };
}

test('adaptive input size scales down only after sustained slow inference and recovers with hysteresis', () => {
  const adaptive = createAdaptiveFrameSize({
    highWidth: 640,
    lowWidth: 480,
    slowFrameMs: 85,
    fastFrameMs: 45,
    slowWindowMs: 750,
    fastWindowMs: 2500,
  });

  assert.equal(adaptive.update(100, 0), 640);
  assert.equal(adaptive.update(100, 749), 640);
  assert.equal(adaptive.update(100, 750), 480);
  assert.equal(adaptive.update(60, 1000), 480);
  assert.equal(adaptive.update(40, 1001), 480);
  assert.equal(adaptive.update(40, 3501), 640);
});

test('frame dimensions preserve camera aspect ratio while respecting the adaptive width cap', () => {
  assert.deepEqual(getFrameDimensions({ videoWidth: 1280, videoHeight: 720 }, 640), { width: 640, height: 360 });
  assert.deepEqual(getFrameDimensions({ videoWidth: 640, videoHeight: 480 }, 480), { width: 480, height: 360 });
  assert.deepEqual(getFrameDimensions({ videoWidth: 320, videoHeight: 240 }, 640), { width: 320, height: 240 });
});

test('worker requests capture one resized frame and return it without building a queue', async () => {
  const sizes = [];
  const bitmap = { close() {} };
  const { worker, tracker, ready } = readyTracker({
    bitmapFactory: async (_video, size) => {
      sizes.push(size);
      return bitmap;
    },
  });
  await ready;
  tracker.resume();
  worker.emit({ type: 'frame-request', requestId: 1, purpose: 'tracking' });
  await new Promise(resolve => setImmediate(resolve));

  const frames = worker.messages.filter(message => message.type === 'frame');
  assert.equal(frames.length, 1);
  assert.equal(frames[0].requestId, 1);
  assert.deepEqual(sizes, [{ width: 640, height: 360 }]);
  assert.deepEqual(frames[0].image, bitmap);
  tracker.dispose();
});

test('a frame captured after pause is discarded and the outstanding request resumes with a fresh capture', async () => {
  const deferred = [];
  const closed = [];
  const { worker, tracker, ready } = readyTracker({
    bitmapFactory: () => new Promise(resolve => deferred.push(resolve)),
  });
  await ready;
  tracker.resume();
  worker.emit({ type: 'frame-request', requestId: 4, purpose: 'tracking' });
  tracker.pause();
  deferred[0]({ close: () => closed.push('stale') });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(closed, ['stale']);
  assert.equal(worker.messages.some(message => message.type === 'frame'), false);

  tracker.resume();
  deferred[1]({ close() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(worker.messages.filter(message => message.type === 'frame').length, 1);
  tracker.dispose();
});

test('a crashed worker is terminated and reported as a fatal tracking error', async () => {
  const worker = createFakeWorker();
  const fatalErrors = [];
  const tracker = createHandTracker({
    video: { videoWidth: 640, videoHeight: 360 },
    kits: [],
    workerFactory: () => worker,
    onFatal: error => fatalErrors.push(error.message),
  });
  const ready = tracker.start();
  worker.emit({ type: 'ready', name: 'test', delegate: 'CPU', ms: 12 });
  await ready;
  worker.onerror({ message: 'worker crashed' });

  assert.deepEqual(fatalErrors, ['worker crashed']);
  assert.equal(worker.terminated, true);
  assert.equal(tracker.ready, false);
});
