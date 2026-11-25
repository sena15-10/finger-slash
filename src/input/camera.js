function cover(videoWidth, videoHeight, width, height) {
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const drawWidth = videoWidth * scale;
  const drawHeight = videoHeight * scale;
  return {
    s: scale,
    dw: drawWidth,
    dh: drawHeight,
    ox: (width - drawWidth) / 2,
    oy: (height - drawHeight) / 2,
  };
}

export function createCamera({ video, width, height, onDisconnect }) {
  return {
    video,
    stream: null,
    ready: false,
    vw: 640,
    vh: 360,
    cv: null,
    async start() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        const error = new Error('nomedia');
        error.name = 'NoMediaDevices';
        throw error;
      }

      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: 'user',
          width: { ideal: 640 },
          height: { ideal: 360 },
          frameRate: { ideal: 30 },
        },
      });
      this.stream.getVideoTracks().forEach(track => {
        track.addEventListener('ended', () => {
          if (this.stream) onDisconnect();
        });
      });

      const currentVideo = this.video;
      currentVideo.srcObject = this.stream;
      currentVideo.muted = true;
      currentVideo.playsInline = true;
      await currentVideo.play();
      if (!(currentVideo.readyState >= 2 && currentVideo.videoWidth)) {
        await new Promise(resolve => currentVideo.addEventListener('loadeddata', resolve, { once: true }));
      }

      this.vw = currentVideo.videoWidth || 640;
      this.vh = currentVideo.videoHeight || 360;
      this.cv = cover(this.vw, this.vh, width, height);
      this.ready = true;
      currentVideo.addEventListener('resize', () => {
        if (currentVideo.videoWidth && (currentVideo.videoWidth !== this.vw || currentVideo.videoHeight !== this.vh)) {
          this.vw = currentVideo.videoWidth;
          this.vh = currentVideo.videoHeight;
          this.cv = cover(this.vw, this.vh, width, height);
        }
      });
    },
    stop() {
      this.ready = false;
      if (this.stream) {
        const stream = this.stream;
        this.stream = null;
        stream.getTracks().forEach(track => track.stop());
      }
      try {
        this.video.pause();
      } catch (error) {
        // The video may not have started yet.
      }
      this.video.srcObject = null;
    },
  };
}
