export function createMotion({ width, height, lerp, getContext }) {
  const motionWidth = 96;
  const motionHeight = 54;
  const motionThreshold = 26;
  const Motion = {
    cv: null,
    c: null,
    prev: null,
    mask: null,
    dil: null,
    tmp: null,
    raw: null,
    vis: null,
    vc: null,
    img: null,
    energy: 0,
    primed: false,
    lastVT: -1,
    init() {
      if (this.cv) return;
      this.cv = document.createElement('canvas');
      this.cv.width = motionWidth;
      this.cv.height = motionHeight;
      this.c = this.cv.getContext('2d', { willReadFrequently: true });
      this.vis = document.createElement('canvas');
      this.vis.width = motionWidth;
      this.vis.height = motionHeight;
      this.vc = this.vis.getContext('2d');
      this.img = this.vc.createImageData(motionWidth, motionHeight);
      const length = motionWidth * motionHeight;
      this.prev = new Uint8Array(length);
      this.mask = new Float32Array(length);
      this.dil = new Uint8Array(length);
      this.tmp = new Uint8Array(length);
      this.raw = new Uint8Array(length);
    },
    reset() {
      this.init();
      this.prev.fill(0);
      this.mask.fill(0);
      this.dil.fill(0);
      this.energy = 0;
      this.primed = false;
      this.lastVT = -1;
    },
    update(video, cover) {
      if (video.readyState < 2 || video.currentTime === this.lastVT) return;
      this.lastVT = video.currentTime;
      const scale = motionWidth / width;
      const context = this.c;
      context.save();
      context.translate(motionWidth, 0);
      context.scale(-1, 1);
      context.drawImage(video, cover.ox * scale, cover.oy * scale, cover.dw * scale, cover.dh * scale);
      context.restore();

      const data = context.getImageData(0, 0, motionWidth, motionHeight).data;
      const length = motionWidth * motionHeight;
      const previous = this.prev;
      const raw = this.raw;
      const mask = this.mask;
      let moving = 0;
      for (let i = 0, j = 0; i < length; i++, j += 4) {
        const gray = (data[j] * 77 + data[j + 1] * 150 + data[j + 2] * 29) >> 8;
        const difference = gray > previous[i] ? gray - previous[i] : previous[i] - gray;
        previous[i] = gray;
        const changed = difference > motionThreshold ? 1 : 0;
        raw[i] = changed;
        moving += changed;
      }

      if (!this.primed) {
        this.primed = true;
        return;
      }
      const fraction = moving / length;
      if (fraction > 0.5) {
        for (let i = 0; i < length; i++) mask[i] *= 0.5;
        this.energy *= 0.8;
      } else {
        for (let i = 0; i < length; i++) mask[i] = raw[i] ? 1 : mask[i] * 0.62;
        this.energy = lerp(this.energy, fraction, 0.35);
      }

      const temporary = this.tmp;
      const dilated = this.dil;
      for (let y = 0; y < motionHeight; y++) {
        for (let x = 0; x < motionWidth; x++) {
          const i = y * motionWidth + x;
          temporary[i] = (mask[i] > 0.5 || (x > 0 && mask[i - 1] > 0.5) || (x < motionWidth - 1 && mask[i + 1] > 0.5)) ? 1 : 0;
        }
      }
      for (let y = 0; y < motionHeight; y++) {
        for (let x = 0; x < motionWidth; x++) {
          const i = y * motionWidth + x;
          dilated[i] = (temporary[i] || (y > 0 && temporary[i - motionWidth]) || (y < motionHeight - 1 && temporary[i + motionWidth])) ? 1 : 0;
        }
      }
    },
    coverage(x, y, radius) {
      const scale = motionWidth / width;
      const centerX = x * scale;
      const centerY = y * scale;
      const scaledRadius = radius * scale;
      let total = 0;
      let hit = 0;
      const x0 = Math.max(0, Math.floor(centerX - scaledRadius));
      const x1 = Math.min(motionWidth - 1, Math.ceil(centerX + scaledRadius));
      const y0 = Math.max(0, Math.floor(centerY - scaledRadius));
      const y1 = Math.min(motionHeight - 1, Math.ceil(centerY + scaledRadius));
      for (let yy = y0; yy <= y1; yy++) {
        for (let xx = x0; xx <= x1; xx++) {
          const dx = xx + 0.5 - centerX;
          const dy = yy + 0.5 - centerY;
          if (dx * dx + dy * dy <= scaledRadius * scaledRadius) {
            total++;
            if (this.dil[yy * motionWidth + xx]) hit++;
          }
        }
      }
      return total >= 6 ? hit / total : 0;
    },
    draw(alpha) {
      const context = getContext();
      const pixels = this.img.data;
      const mask = this.mask;
      for (let i = 0, j = 0; i < mask.length; i++, j += 4) {
        pixels[j] = 61;
        pixels[j + 1] = 242;
        pixels[j + 2] = 255;
        pixels[j + 3] = mask[i] * 215;
      }
      this.vc.putImageData(this.img, 0, 0);
      context.save();
      context.imageSmoothingEnabled = true;
      context.globalCompositeOperation = 'lighter';
      context.globalAlpha = alpha;
      context.drawImage(this.vis, 0, 0, width, height);
      context.restore();
    },
  };
  return Motion;
}
