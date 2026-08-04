import { capitalConcurrency, normalizeCapitalEvent, progressForDirection, shouldAnimateCapitalEvent } from './build/capital-events.61cda934a5.js';

const COLORS = {
  blue: '#28a9ff',
  amber: '#ffb45d',
  red: '#ff6577',
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));
const smooth = (t) => t * t * (3 - 2 * t);

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function relativeAge(timestamp) {
  if (!timestamp) return 'TIME UNKNOWN';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return `${seconds}S AGO`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}M AGO`;
  return `${Math.floor(seconds / 3600)}H AGO`;
}

export class CapitalField {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true });
    this.metrics = null;
    this.latest = null;
    this.queue = [];
    this.active = [];
    this.receipts = [];
    this.exitReceipts = [];
    this.awayLatest = null;
    this.awayCount = 0;
    this.time = 0;
    this.nextLaunchAt = 0;
    this.motionQuery = matchMedia('(prefers-reduced-motion: reduce)');
    this.reduced = this.motionQuery.matches;
    this.hidden = document.hidden;
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    document.addEventListener('visibilitychange', () => {
      this.hidden = document.hidden;
      this.time = 0;
      if (!this.hidden && this.awayLatest) {
        this.addReceipt({ ...this.awayLatest, reduced: true, awayCount: this.awayCount });
        this.awayLatest = null;
        this.awayCount = 0;
      }
    });
    this.motionQuery.addEventListener('change', ({ matches }) => {
      this.reduced = matches;
      if (!matches) return;
      const latestPending = this.active.at(-1) || this.queue.at(-1);
      if (latestPending) this.addReceipt({ ...latestPending, reduced: true });
      this.active = [];
      this.queue = [];
    });
    this.resize();
    this.frame = this.frame.bind(this);
    requestAnimationFrame(this.frame);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.mobile = this.width < 520;
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setMetrics(metrics) {
    this.metrics = metrics;
  }

  setLatest(event) {
    this.latest = event ? normalizeCapitalEvent(event) : null;
  }

  addReceipt(event) {
    if (event.presentation === 'receipt') {
      this.addExitReceipt(event);
      return;
    }
    this.receipts.push({ ...event, completedAt: performance.now() });
    if (this.receipts.length > 6) this.receipts.shift();
  }

  addExitReceipt(event) {
    this.exitReceipts.push({ ...event, completedAt: performance.now() });
    if (this.exitReceipts.length > (this.mobile ? 1 : 2)) this.exitReceipts.shift();
  }

  enqueue(event) {
    const capitalEvent = normalizeCapitalEvent(event);
    if (!capitalEvent) return;
    this.latest = capitalEvent;
    if (this.hidden) {
      this.awayLatest = capitalEvent;
      this.awayCount += 1;
      return;
    }
    if (capitalEvent.presentation === 'receipt') {
      this.addExitReceipt(capitalEvent);
      return;
    }
    if (this.reduced) {
      this.addReceipt({ ...capitalEvent, reduced: true });
      return;
    }
    if (this.queue.some((item) => item.id === capitalEvent.id) || this.active.some((item) => item.id === capitalEvent.id)) return;
    this.queue.push(capitalEvent);
    if (this.queue.length > 50) this.queue.shift();
  }

  pulse(event) {
    this.enqueue(event);
  }

  lanePoint(lane, progress, offset = 0) {
    const t = clamp(progress, 0, 1);
    const inverse = 1 - t;
    const startX = this.width * .09;
    const endX = this.width * .84;
    const controlX = this.width * .48;
    const startY = this.height * (lane === 0 ? .43 : .74);
    const endY = this.height * .585;
    const controlY = this.height * (lane === 0 ? .27 : .84);
    return {
      x: inverse * inverse * startX + 2 * inverse * t * controlX + t * t * endX,
      y: inverse * inverse * startY + 2 * inverse * t * controlY + t * t * endY + offset,
    };
  }

  drawGrid(ctx) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.032)';
    ctx.lineWidth = 1;
    const horizon = this.height * .28;
    for (let index = 0; index < 8; index += 1) {
      const y = horizon + ((index / 7) ** 1.65) * this.height * .68;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(this.width, y); ctx.stroke();
    }
    for (let index = -7; index <= 7; index += 1) {
      ctx.beginPath();
      ctx.moveTo(this.width * .5 + index * 12, horizon);
      ctx.lineTo(this.width * .5 + index * this.width * .11, this.height);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawRoutes(ctx) {
    const colors = ['#5ce9b5', COLORS.amber];
    for (let lane = 0; lane < 2; lane += 1) {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = colors[lane];
      ctx.lineWidth = 6;
      ctx.globalAlpha = .065;
      ctx.shadowColor = colors[lane];
      ctx.shadowBlur = 18;
      ctx.beginPath();
      for (let index = 0; index <= 90; index += 1) {
        const point = this.lanePoint(lane, index / 90);
        if (index === 0) ctx.moveTo(point.x, point.y); else ctx.lineTo(point.x, point.y);
      }
      ctx.stroke();
      ctx.lineWidth = 1.2;
      ctx.globalAlpha = .28;
      ctx.shadowBlur = 0;
      ctx.stroke();

      ctx.fillStyle = colors[lane];
      ctx.globalAlpha = .72;
      ctx.font = `${this.mobile ? 10 : 11}px "Fragment Mono", monospace`;
      ctx.textAlign = lane === 0 ? 'left' : 'center';
      const key = lane === 0 ? 'STAKE  →  STAKING VAULT' : '←  UNSTAKE  ·  HELD IN VAULT';
      const keyPoint = this.lanePoint(lane, lane === 0 ? .08 : .34);
      ctx.fillText(key, keyPoint.x, keyPoint.y - (lane === 0 ? 14 : 18));
      ctx.restore();
    }
  }

  drawVaultAndCooldown(ctx) {
    const vault = this.lanePoint(0, 1);
    const cooldown = this.lanePoint(1, 0);
    const active = this.metrics?.activeStaked || 0;
    const pending = this.metrics?.pendingUnstake || 0;

    ctx.save();
    const vaultGlow = ctx.createRadialGradient(vault.x, vault.y, 0, vault.x, vault.y, this.mobile ? 47 : 62);
    vaultGlow.addColorStop(0, 'rgba(92,233,181,.28)');
    vaultGlow.addColorStop(.45, 'rgba(40,169,255,.12)');
    vaultGlow.addColorStop(1, 'rgba(40,169,255,0)');
    ctx.fillStyle = vaultGlow;
    ctx.beginPath(); ctx.arc(vault.x, vault.y, this.mobile ? 47 : 62, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(145,210,255,.72)';
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(vault.x, vault.y, this.mobile ? 25 : 31, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = 'rgba(92,233,181,.34)';
    ctx.beginPath(); ctx.arc(vault.x, vault.y, this.mobile ? 33 : 41, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#f4f7f8';
    ctx.textAlign = 'center';
    ctx.font = `600 ${this.mobile ? 10 : 12}px "Instrument Sans", sans-serif`;
    ctx.fillText('STAKING VAULT', vault.x, vault.y - 5);
    ctx.font = `400 ${this.mobile ? 11 : 14}px "Fragment Mono", monospace`;
    ctx.fillText(this.compactMetric(active), vault.x, vault.y + 13);
    ctx.fillStyle = 'rgba(255,255,255,.46)';
    ctx.font = `10px "Fragment Mono", monospace`;
    ctx.fillText('ACTIVE SKR', vault.x, vault.y + (this.mobile ? 51 : 61));

    ctx.fillStyle = 'rgba(255,180,93,.12)';
    ctx.strokeStyle = 'rgba(255,180,93,.7)';
    ctx.shadowColor = COLORS.amber;
    ctx.shadowBlur = 18;
    ctx.beginPath(); ctx.arc(cooldown.x, cooldown.y, this.mobile ? 15 : 18, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.textAlign = 'left';
    ctx.fillStyle = COLORS.amber;
    ctx.font = `10px "Fragment Mono", monospace`;
    ctx.fillText('48H QUEUE TOTAL', cooldown.x + 25, cooldown.y + 1);
    ctx.fillStyle = 'rgba(255,255,255,.52)';
    ctx.font = `${this.mobile ? 9 : 10}px "Fragment Mono", monospace`;
    ctx.fillText(this.compactMetric(pending), cooldown.x + 25, cooldown.y + 17);
    ctx.fillStyle = 'rgba(255,255,255,.56)';
    ctx.font = `9px "Fragment Mono", monospace`;
    ctx.fillText('HELD IN VAULT · INCL. READY', cooldown.x + 25, cooldown.y + 33);
    ctx.restore();
  }

  compactMetric(value) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(Number(value || 0));
  }

  promoteEvents(now) {
    const limit = capitalConcurrency(this.width);
    while (this.queue.length && !shouldAnimateCapitalEvent(this.queue[0])) this.queue.shift();
    if (this.active.length >= limit || !this.queue.length || now < this.nextLaunchAt) return;
    const event = this.queue.shift();
    this.active.push({ ...event, startedAt: now });
    this.nextLaunchAt = now + (this.mobile ? 900 : 650);
  }

  drawTrail(ctx, event, progress) {
    const samples = 16;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = event.color;
    ctx.lineWidth = 3 + event.magnitude * 4;
    ctx.shadowColor = event.color;
    ctx.shadowBlur = 12;
    for (let index = 1; index < samples; index += 1) {
      const age = index / samples * .12;
      const current = progressForDirection(clamp(progress - age, 0, 1), event.direction);
      const previous = progressForDirection(clamp(progress - age - .012, 0, 1), event.direction);
      const a = this.lanePoint(event.lane, previous);
      const b = this.lanePoint(event.lane, current);
      ctx.globalAlpha = (1 - index / samples) * .58;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }
    ctx.restore();
  }

  labelRect(point, event, occupied) {
    const width = this.mobile ? 190 : 230;
    const height = this.mobile ? 59 : 66;
    let x = event.direction > 0 ? point.x + 15 : point.x - width - 15;
    if (x + width > this.width - 8) x = point.x - width - 15;
    if (x < 8) x = point.x + 15;
    x = clamp(x, 8, this.width - width - 8);
    const preferredY = event.lane === 1 ? point.y + 18 : point.y - height - 18;
    let y = clamp(preferredY, 88, this.height - height - 24);
    for (const rect of occupied) {
      const overlaps = x < rect.x + rect.width + 5 && x + width + 5 > rect.x && y < rect.y + rect.height + 5 && y + height + 5 > rect.y;
      if (overlaps) y = clamp(rect.y + rect.height + 8, 88, this.height - height - 24);
    }
    const rect = { x, y, width, height };
    occupied.push(rect);
    return rect;
  }

  drawEventLabel(ctx, point, event, occupied) {
    const rect = this.labelRect(point, event, occupied);
    ctx.save();
    const anchorX = clamp(point.x, rect.x, rect.x + rect.width);
    const anchorY = point.y < rect.y ? rect.y : point.y > rect.y + rect.height ? rect.y + rect.height : point.y;
    ctx.strokeStyle = `${event.color}99`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(point.x, point.y); ctx.lineTo(anchorX, anchorY); ctx.stroke();
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 4);
    ctx.fillStyle = 'rgba(4,6,8,.985)';
    ctx.shadowColor = 'rgba(0,0,0,.8)';
    ctx.shadowBlur = 14;
    ctx.fill();
    ctx.strokeStyle = `${event.color}88`;
    ctx.shadowBlur = 0;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.fillStyle = event.color;
    ctx.font = `${this.mobile ? 10 : 11}px "Fragment Mono", monospace`;
    ctx.textAlign = 'left';
    ctx.fillText(`${event.action}  ·  ${event.destination}`, rect.x + 11, rect.y + 15);
    ctx.fillStyle = '#f4f7f8';
    ctx.font = `600 ${this.mobile ? 14 : 16}px "Fragment Mono", monospace`;
    ctx.fillText(event.amountLabel, rect.x + 11, rect.y + (this.mobile ? 35 : 40));
    ctx.fillStyle = 'rgba(255,255,255,.58)';
    ctx.font = `9px "Fragment Mono", monospace`;
    ctx.fillText(`${event.walletLabel} · ${relativeAge(event.blockTime)}`, rect.x + 11, rect.y + rect.height - 9);
    ctx.restore();
  }

  drawArrowhead(ctx, point, event, routeProgress) {
    const aheadProgress = clamp(routeProgress + event.direction * .018, 0, 1);
    const ahead = this.lanePoint(event.lane, aheadProgress);
    const angle = Math.atan2(ahead.y - point.y, ahead.x - point.x);
    const size = 7 + event.magnitude * 4;
    ctx.save();
    ctx.translate(point.x, point.y);
    ctx.rotate(angle);
    ctx.fillStyle = '#f7fbfd';
    ctx.shadowColor = event.color;
    ctx.shadowBlur = 15;
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * .65, -size * .58);
    ctx.lineTo(-size * .34, 0);
    ctx.lineTo(-size * .65, size * .58);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawEvent(ctx, event, now, occupied) {
    const elapsed = Math.max(0, (now - event.startedAt) / 1000);
    const raw = clamp(elapsed / event.duration, 0, 1);
    const travel = smooth(raw);
    const routeProgress = progressForDirection(travel, event.direction);
    const point = this.lanePoint(event.lane, routeProgress);
    this.drawTrail(ctx, event, travel);

    ctx.save();
    ctx.fillStyle = event.color;
    ctx.shadowColor = event.color;
    ctx.shadowBlur = 18 + event.magnitude * 16;
    ctx.globalAlpha = clamp(raw * 7, 0, 1) * clamp((1 - raw) * 8, 0, 1);
    ctx.beginPath(); ctx.arc(point.x, point.y, 3.2 + event.magnitude * 4.5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha *= .24;
    ctx.lineWidth = 1;
    ctx.strokeStyle = event.color;
    ctx.beginPath(); ctx.arc(point.x, point.y, 10 + event.magnitude * 7, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    this.drawArrowhead(ctx, point, event, routeProgress);
    this.drawEventLabel(ctx, point, event, occupied);
    return raw >= 1;
  }

  drawReceipts(ctx, now) {
    this.receipts = this.receipts.filter((receipt) => now - receipt.completedAt < (receipt.reduced ? 5000 : 2600));
    for (const receipt of this.receipts) {
      const age = (now - receipt.completedAt) / (receipt.reduced ? 5000 : 2600);
      const endpoint = this.lanePoint(receipt.lane, receipt.direction < 0 ? 0 : 1);
      ctx.save();
      ctx.strokeStyle = receipt.color;
      ctx.globalAlpha = (1 - age) * .65;
      ctx.lineWidth = 1.2;
      ctx.shadowColor = receipt.color;
      ctx.shadowBlur = 15;
      ctx.beginPath(); ctx.arc(endpoint.x, endpoint.y, 12 + age * 31, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = receipt.color;
      ctx.font = `10px "Fragment Mono", monospace`;
      ctx.textAlign = receipt.direction < 0 ? 'left' : 'right';
      const textX = receipt.direction < 0 ? endpoint.x + 12 : endpoint.x - 12;
      const confirmation = receipt.awayCount > 1 ? `${receipt.action} · +${receipt.awayCount - 1} WHILE AWAY` : receipt.awayCount ? `${receipt.action} · WHILE AWAY` : `${receipt.action} · CONFIRMED`;
      ctx.fillText(`${receipt.amountLabel} · ${confirmation}`, textX, endpoint.y + 28);
      ctx.restore();
    }
  }

  drawExitReceipts(ctx, now) {
    this.exitReceipts = this.exitReceipts.filter((receipt) => now - receipt.completedAt < 6_500);
    this.exitReceipts.forEach((receipt, index) => {
      const age = clamp((now - receipt.completedAt) / 6_500, 0, 1);
      const width = this.mobile ? 212 : 250;
      const height = this.mobile ? 64 : 72;
      const x = this.mobile ? (this.width - width) / 2 : this.width - width - 18;
      const y = this.mobile ? this.height - height - 70 : this.height - 122 - index * 78;
      ctx.save();
      ctx.globalAlpha = clamp((1 - age) * 1.5, 0, 1);
      roundedRect(ctx, x, y, width, height, 5);
      ctx.fillStyle = 'rgba(15,6,9,.97)';
      ctx.shadowColor = 'rgba(255,101,119,.28)';
      ctx.shadowBlur = 22;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(255,101,119,.68)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.fillStyle = COLORS.red;
      ctx.font = `10px "Fragment Mono", monospace`;
      ctx.textAlign = 'left';
      ctx.fillText('WITHDRAW  ·  EXIT CONFIRMED  →', x + 12, y + 17);
      ctx.fillStyle = '#f4f7f8';
      ctx.font = `600 ${this.mobile ? 14 : 16}px "Fragment Mono", monospace`;
      ctx.fillText(receipt.amountLabel, x + 12, y + 41);
      ctx.fillStyle = 'rgba(255,255,255,.56)';
      ctx.font = `9px "Fragment Mono", monospace`;
      ctx.fillText(`${receipt.walletLabel} · ${relativeAge(receipt.blockTime)}`, x + 12, y + height - 9);
      ctx.restore();
    });
  }

  drawIdle(ctx) {
    if (this.active.length || this.queue.length) return;
    const centerY = this.height * .255;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(244,247,248,.62)';
    ctx.font = `${this.mobile ? 10 : 11}px "Fragment Mono", monospace`;
    ctx.fillText('WAITING FOR NEXT FINALIZED EVENT', this.width / 2, centerY);
    if (this.latest) {
      ctx.fillStyle = 'rgba(255,255,255,.42)';
      ctx.font = `9px "Fragment Mono", monospace`;
      ctx.fillText(`LAST · ${this.latest.action} · ${this.latest.amountLabel} · ${relativeAge(this.latest.blockTime)}`, this.width / 2, centerY + 20);
    }
    ctx.restore();
  }

  drawQueueStatus(ctx) {
    if (!this.queue.length) return;
    ctx.save();
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(244,247,248,.52)';
    ctx.font = `${this.mobile ? 9 : 10}px "Fragment Mono", monospace`;
    ctx.fillText(`+${this.queue.length} FINALIZED EVENT${this.queue.length === 1 ? '' : 'S'} QUEUED`, this.width - 15, this.height - 41);
    ctx.restore();
  }

  frame(now) {
    requestAnimationFrame(this.frame);
    if (this.hidden) return;
    this.time = now;
    this.promoteEvents(now);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawGrid(ctx);
    this.drawRoutes(ctx);
    this.drawVaultAndCooldown(ctx);
    const occupied = [];
    const completed = [];
    for (const event of this.active) {
      if (this.drawEvent(ctx, event, now, occupied)) completed.push(event);
    }
    if (completed.length) {
      this.active = this.active.filter((event) => !completed.includes(event));
      completed.forEach((event) => this.addReceipt(event));
    }
    this.drawReceipts(ctx, now);
    this.drawExitReceipts(ctx, now);
    this.drawQueueStatus(ctx);
    this.drawIdle(ctx);
  }
}
