import { CapitalField } from './capital-field.13b44e7a11.js';
import { collectUnseenEvents, normalizeCapitalEvent, shouldAnimateCapitalEvent } from './capital-events.61cda934a5.js';
import { buildRangeView } from './range-view.a8e192ad84.js';

const $ = (id) => document.getElementById(id);
let currentState = null;
let selectedRange = '24h';
let filter = { type: '', min: 0 };
let includeDust = false;
let signalEvents = [];
let signalEventTotal = 0;
const SIGNAL_MIN_SKR = 10;
let seenEvents = new Set();
let eventsInitialized = false;
let fieldAnnouncement = 0;
let drawerTrigger = null;
const capitalField = new CapitalField($('capitalCanvas'));
['activeStaked','pendingUnstake','withdrawable','vaultBalance','sharePrice','activePositions','staked24','unstaked24','netFlow24','withdrawn24','pressureRatio']
  .forEach((id) => $(id)?.classList.add('is-loading'));

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character]));
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
const precise = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const evidencePrecision = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const fmt = (value) => Number.isFinite(Number(value)) ? compact.format(Number(value)) : '—';
const full = (value) => Number.isFinite(Number(value)) ? precise.format(Number(value)) : '—';
const short = (value) => value ? `${value.slice(0, 4)}…${value.slice(-4)}` : '—';
const ago = (timestamp) => {
  if (!timestamp) return '—';
  const seconds = Math.max(0, Math.floor(Date.now() / 1000) - timestamp);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
};
const until = (timestamp) => {
  const seconds = Math.max(0, timestamp - Math.floor(Date.now() / 1000));
  if (seconds < 60) return '<1m';
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.ceil((seconds % 86400) / 3600)}h`;
};

function setText(id, value) { const element = $(id); if (element) { element.textContent = value; element.classList.remove('is-loading'); } }

const eventLabel = (type) => ({ stake: 'STAKE', unstake: 'UNSTAKE', withdraw: 'EXIT CONFIRMED', cancel_unstake: 'CANCEL UNSTAKE' }[type] || String(type || 'EVENT').toUpperCase());
const timestampLabel = (timestamp) => timestamp ? new Date(timestamp * 1000).toISOString().replace('.000Z', 'Z') : 'Not reported';
const chip = (label, className = '') => `<span class="evidence-chip ${esc(className)}">${esc(label)}</span>`;
const fact = (label, value) => `<div class="evidence-fact"><span>${esc(label)}</span><b>${esc(value ?? 'Not reported')}</b></div>`;
const sourceRow = ({ label, account, slot }) => `<div class="evidence-source"><div><strong>${esc(label)}</strong><small>${esc(account || 'No account identifier')} · SLOT ${esc(slot ?? 'NOT REPORTED')}</small></div>${account ? `<a href="https://solscan.io/account/${esc(account)}" target="_blank" rel="noopener">SOLSCAN ↗</a>` : ''}</div>`;

function metricDisplay(key) {
  const metrics = currentState?.metrics || {};
  const day = currentState?.analytics?.windows?.[selectedRange] || {};
  return {
    activeStaked: `${full(metrics.activeStaked)} SKR`,
    sharePrice: full(metrics.sharePrice),
    stakedPercent: `${full(metrics.stakedPercent)}%`,
    pendingUnstake: `${full(metrics.pendingUnstake)} SKR`,
    withdrawable: `${full(metrics.withdrawable)} SKR`,
    vaultBalance: `${full(metrics.vaultBalance)} SKR`,
    unlockHorizon: `${full(metrics.pendingUnstake)} SKR PARTITIONED`,
    guardianPools: `${full(metrics.guardians?.count)} POOLS`,
    flow24h: `${Number(day.netFlow || 0) >= 0 ? '+' : '−'}${full(Math.abs(Number(day.netFlow || 0)))} SKR NET`,
  }[key] || 'ON-CHAIN METRIC';
}

function showDrawer({ eyebrow, title, status, body }, trigger) {
  drawerTrigger = trigger || document.activeElement;
  setText('drawerEyebrow', eyebrow);
  setText('drawerTitle', title);
  $('drawerStatus').innerHTML = status;
  $('drawerBody').innerHTML = body;
  $('evidenceDrawer').classList.add('open');
  $('drawerScrim').classList.add('open');
  $('evidenceDrawer').setAttribute('aria-hidden', 'false');
  document.querySelector('.app-frame').inert = true;
  document.body.classList.add('drawer-open');
  $('drawerClose').focus();
}

function closeDrawer() {
  if (!$('evidenceDrawer').classList.contains('open')) return;
  $('evidenceDrawer').classList.remove('open');
  $('drawerScrim').classList.remove('open');
  $('evidenceDrawer').setAttribute('aria-hidden', 'true');
  document.querySelector('.app-frame').inert = false;
  document.body.classList.remove('drawer-open');
  drawerTrigger?.focus?.();
  drawerTrigger = null;
}

function openMetricEvidence(key, trigger) {
  const provenance = currentState?.provenance?.[key];
  if (!provenance) return;
  const coverage = provenance.coverageFrom ? fact('LOCAL COVERAGE FROM', timestampLabel(provenance.coverageFrom)) : '';
  const scanMode = provenance.scanMode ? fact('SCAN MODE', String(provenance.scanMode).toUpperCase()) : '';
  const scanLabel = provenance.scanMode === 'paginated-filtered'
    ? 'PAGINATED SCAN'
    : provenance.scanMode
      ? 'BEST-EFFORT SCAN'
      : null;
  const caveat = provenance.caveat ? `<div class="evidence-section"><span>KNOWN CAVEAT</span><div class="evidence-caveat">${esc(provenance.caveat)}</div></div>` : '';
  showDrawer({
    eyebrow: 'METRIC PROVENANCE',
    title: provenance.title,
    status: `${chip('FINALIZED', 'finalized')}${chip(provenance.coverageFrom ? 'LOCAL INDEX' : 'CHAIN SNAPSHOT')}${scanLabel ? chip(scanLabel) : ''}${chip('READ ONLY')}`,
    body: `<div class="evidence-summary"><span>REPORTED VALUE</span><strong>${esc(metricDisplay(key))}</strong><small>${esc(provenance.accuracy)}</small></div>
      <div class="evidence-section"><span>OBSERVATION</span><div class="evidence-facts">${fact('COMMITMENT', provenance.commitment?.toUpperCase())}${fact('OBSERVED AT', timestampLabel(provenance.observedAt))}${coverage}${scanMode}</div></div>
      <div class="evidence-section"><span>SOURCE ACCOUNTS</span>${(provenance.sources || []).map(sourceRow).join('')}</div>
      <div class="evidence-section"><span>DERIVATION</span><p>${esc(provenance.derivation)}</p></div>${caveat}`,
  }, trigger);
}

function openEventEvidence(event, trigger) {
  const evidence = event?.evidence;
  if (!evidence) return;
  const transaction = evidence.transaction || {};
  const amount = evidence.amount || {};
  const accounts = evidence.accounts || {};
  const sources = [
    { label: 'Finalized transaction', account: transaction.signature, href: transaction.signature ? `https://solscan.io/tx/${transaction.signature}` : null },
    { label: 'Initiating wallet', account: accounts.wallet, href: accounts.wallet ? `https://solscan.io/account/${accounts.wallet}` : null },
    { label: 'Guardian pool', account: accounts.guardianPool, href: accounts.guardianPool ? `https://solscan.io/account/${accounts.guardianPool}` : null },
  ].filter((item) => item.account);
  const sourceRows = sources.map((item) => `<div class="evidence-source"><div><strong>${esc(item.label)}</strong><small>${esc(item.account)}</small></div><a href="${esc(item.href)}" target="_blank" rel="noopener">SOLSCAN ↗</a></div>`).join('');
  const caveat = amount.caveat ? `<div class="evidence-section"><span>KNOWN CAVEAT</span><div class="evidence-caveat">${esc(amount.caveat)}</div></div>` : '';
  showDrawer({
    eyebrow: 'EVENT EVIDENCE',
    title: eventLabel(event.type),
    status: `${chip('FINALIZED', 'finalized')}${chip(String(amount.status || 'unavailable').toUpperCase(), amount.status)}${chip(`SLOT ${transaction.slot ?? 'N/A'}`)}`,
    body: `<div class="evidence-summary"><span>EVENT AMOUNT</span><strong>${amount.value == null ? 'NOT AVAILABLE' : `${esc(evidencePrecision.format(amount.value))} SKR`}</strong><small>${esc(amount.method)}</small></div>
      <div class="evidence-section"><span>TRANSACTION PROOF</span><div class="evidence-facts">${fact('BLOCK TIME', timestampLabel(transaction.blockTime))}${fact('SLOT', transaction.slot)}${fact('INSTRUCTION', transaction.instructionIndex)}${fact('AGGREGATION', amount.aggregation?.toUpperCase() || 'PER INSTRUCTION')}${fact('RAW AMOUNT', amount.rawValue)}</div></div>
      <div class="evidence-section"><span>LINKED EVIDENCE</span>${sourceRows}</div>${caveat}`,
  }, trigger);
}

function openQueueEvidence(item, trigger) {
  const provenance = currentState?.provenance?.pendingUnstake;
  if (!item || !provenance) return;
  const ready = item.status === 'withdrawable';
  const linked = [
    { label: 'Wallet', account: item.wallet },
    { label: 'UserStake account', account: item.stakeAccount },
  ].filter((entry) => entry.account).map((entry) => `<div class="evidence-source"><div><strong>${esc(entry.label)}</strong><small>${esc(entry.account)}</small></div><a href="https://solscan.io/account/${esc(entry.account)}" target="_blank" rel="noopener">SOLSCAN ↗</a></div>`).join('');
  showDrawer({
    eyebrow: 'QUEUE POSITION EVIDENCE',
    title: ready ? 'Unlock ready' : '48-hour cooldown',
    status: `${chip('FINALIZED', 'finalized')}${chip(ready ? 'WITHDRAWABLE' : 'COOLING', ready ? 'ready' : 'cooling')}${chip(`SLOT ${provenance.sources?.[0]?.slot ?? 'N/A'}`)}`,
    body: `<div class="evidence-summary"><span>PENDING AMOUNT</span><strong>${esc(full(item.amount))} SKR</strong><small>Decoded from the finalized UserStake account state.</small></div>
      <div class="evidence-section"><span>POSITION STATE</span><div class="evidence-facts">${fact('STATUS', ready ? 'READY TO WITHDRAW' : 'COOLING')}${fact('UNLOCK AT', timestampLabel(item.unlockAt))}${fact('OBSERVED AT', timestampLabel(provenance.observedAt))}</div></div>
      <div class="evidence-section"><span>LINKED ACCOUNTS</span>${linked}</div>
      <div class="evidence-section"><span>DERIVATION</span><p>${esc(provenance.derivation)}</p></div>
      <div class="evidence-section"><span>DISPLAY SCOPE</span><div class="evidence-caveat">This position is selected from the Top queue display. Aggregate queue totals and unlock bands use the complete filtered UserStake scan of the accounts returned by one finalized getProgramAccounts call. ${esc(provenance.caveat || '')}</div></div>`,
  }, trigger);
}

function renderUnlockHorizon(horizon, pendingTotal) {
  const bands = [
    ['Ready', 'ready'],
    ['6', 'next6h'],
    ['12', 'next12h'],
    ['24', 'next24h'],
    ['48', 'next48h'],
  ];
  for (const [id, key] of bands) {
    const amount = Number(horizon?.[key] || 0);
    const share = pendingTotal > 0 ? amount / pendingTotal * 100 : 0;
    setText(`unlock${id}`, `${fmt(amount)} SKR`);
    const bar = $(`unlock${id}Bar`);
    if (bar) bar.style.width = `${Math.min(100, share)}%`;
  }
}

function renderMetrics(metrics) {
  if (!metrics) return;
  const pressure = metrics.activeStaked ? metrics.pendingUnstake / metrics.activeStaked * 100 : 0;
  setText('activeStaked', fmt(metrics.activeStaked));
  setText('stakedPercent', `${metrics.stakedPercent.toFixed(2)}% OF SUPPLY`);
  setText('supplyCapture', `${metrics.stakedPercent.toFixed(2)}%`);
  $('stakedPercentBar').style.width = `${Math.min(100, metrics.stakedPercent)}%`;
  setText('pendingUnstake', `${fmt(metrics.pendingUnstake)} SKR`);
  setText('pendingPositions', `${full(metrics.pendingPositions)} POSITIONS COOLING`);
  setText('withdrawable', `${fmt(metrics.withdrawable)} SKR`);
  setText('vaultBalance', `${fmt(metrics.vaultBalance)} SKR`);
  setText('vaultExcess', `${fmt(metrics.vaultExcess)} SKR`);
  setText('sharePrice', metrics.sharePrice.toFixed(6));
  setText('rewardIndex', `+${metrics.rewardIndexPercent.toFixed(2)}% REWARD INDEX`);
  setText('activePositions', full(metrics.activePositions));
  setText('totalPositions', `${full(metrics.totalPositions)} TOTAL ACCOUNTS`);
  setText('queueTag', `${full(metrics.pendingPositions)} POSITIONS`);
  setText('pressureRatio', `${pressure.toFixed(2)}%`);
  $('pressureRing').style.setProperty('--pressure', Math.min(100, pressure));
  setText('laneActive', `${fmt(metrics.activeStaked)} SKR`);
  setText('lanePending', `${fmt(metrics.pendingUnstake)} SKR`);
  setText('laneWithdrawable', `${fmt(metrics.withdrawable)} SKR`);
  if (metrics.guardians) setText('guardianPools', metrics.guardians.count <= 1
    ? 'SINGLE GUARDIAN PHASE · CONCENTRATION AT 2+ POOLS'
    : `${full(metrics.guardians.count)} POOLS · TOP ${metrics.guardians.topConcentrationPercent.toFixed(2)}%`);
  renderUnlockHorizon(metrics.unlockHorizon, metrics.pendingUnstake);
  capitalField.setMetrics(metrics);
  renderQueue(metrics.queue || []);
  renderMiniQueue(metrics.queue || []);
}

function renderAnalytics(analytics) {
  const view = buildRangeView(analytics, selectedRange);
  const day = view.flow;
  if (!day) return;
  const rangeLabel = view.label;
  setText('rangeStakedLabel', `${rangeLabel} STAKED`);
  setText('rangeUnstakedLabel', `${rangeLabel} UNSTAKED`);
  setText('rangeNetLabel', `${rangeLabel} NET ACTIVE FLOW`);
  setText('rangeWithdrawnLabel', `${rangeLabel} WITHDRAWN`);
  setText('staked24', `+${fmt(day.staked)} SKR`);
  setText('unstaked24', `−${fmt(day.unstaked)} SKR`);
  const net = day.netFlow;
  setText('netFlow24', `${net >= 0 ? '+' : '−'}${fmt(Math.abs(net))} SKR`);
  $('netFlow24').style.color = net >= 0 ? 'var(--green)' : 'var(--red)';
  setText('netArrow', net >= 0 ? '↗' : '↘');
  setText('withdrawn24', `${fmt(day.withdrawn)} SKR`);
  setText('stakeEvents24', `${full(day.events)} INDEXED EVENTS`);
  setText('uniqueWallets24', `STAKE − UNSTAKE · ${full(day.wallets)} WALLETS`);
  setText('coverage', analytics.coverageFrom ? `LOCAL HISTORY FROM ${new Date(analytics.coverageFrom * 1000).toLocaleString()}` : 'HISTORY COVERAGE BEGINS WHEN THIS INDEXER STARTS.');
  const verdict = view.verdict;
  setText('systemVerdict', verdict[0]);
  setText('verdictDetail', verdict[2]);
  setText('briefCoverage', view.coverageLabel);
  document.querySelector('.brief-verdict')?.classList.remove('positive', 'negative', 'balanced');
  if (verdict[1]) document.querySelector('.brief-verdict')?.classList.add(verdict[1]);
  renderChart(analytics.hourly || []);
}

function renderChart(hours) {
  const chart = $('flowChart');
  if (!hours.some((hour) => hour.staked || hour.unstaked)) return;
  const maximum = Math.max(...hours.flatMap((hour) => [hour.staked, hour.unstaked]), 1);
  const width = 1200, height = 228, mid = 108, pad = 14;
  const points = (key, direction) => hours.map((hour, index) => {
    const x = pad + index * ((width - pad * 2) / Math.max(1, hours.length - 1));
    const y = mid + direction * (Number(hour[key] || 0) / maximum * 82);
    return [x, y];
  });
  const stake = points('staked', -1);
  const unstake = points('unstaked', 1);
  const path = (values) => values.map(([x, y], index) => `${index ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = (values) => `M${values[0][0]},${mid} ${path(values)} L${values.at(-1)[0]},${mid} Z`;
  const labels = hours.map((hour, index) => index % 6 === 0 ? `<text x="${stake[index][0]}" y="220" fill="rgba(255,255,255,.46)" font-size="11" font-family="Fragment Mono">${String(index).padStart(2, '0')}H</text>` : '').join('');
  chart.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="24 hour staking flow">
    <defs><linearGradient id="stakeFill" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#5ce9b5" stop-opacity=".3"/><stop offset="1" stop-color="#5ce9b5" stop-opacity="0"/></linearGradient><linearGradient id="unstakeFill" x1="0" y1="1" x2="0" y2="0"><stop stop-color="#ffb45d" stop-opacity=".24"/><stop offset="1" stop-color="#ffb45d" stop-opacity="0"/></linearGradient></defs>
    <line x1="0" y1="${mid}" x2="${width}" y2="${mid}" stroke="rgba(255,255,255,.12)"/>
    <path d="${area(stake)}" fill="url(#stakeFill)"/><path d="${area(unstake)}" fill="url(#unstakeFill)"/>
    <path d="${path(stake)}" fill="none" stroke="#5ce9b5" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="${path(unstake)}" fill="none" stroke="#ffb45d" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <circle cx="${stake.at(-1)[0]}" cy="${stake.at(-1)[1]}" r="4" fill="#5ce9b5"/><circle cx="${unstake.at(-1)[0]}" cy="${unstake.at(-1)[1]}" r="4" fill="#ffb45d"/>
    ${labels}<text x="15" y="18" fill="#5ce9b5" font-size="11" font-family="Fragment Mono">STAKE / +</text><text x="15" y="203" fill="#ffb45d" font-size="11" font-family="Fragment Mono">UNSTAKE / −</text>
  </svg>`;
}

function renderEvents(events) {
  const source = includeDust ? events : signalEvents;
  const filtered = source.filter((event) => (!filter.type || event.type === filter.type) && (!filter.min || Number(event.amount) >= filter.min));
  const rows = $('eventRows');
  const persisted = Number(currentState?.status?.persistedEventCount || events.length);
  const hidden = Math.max(0, persisted - signalEventTotal);
  setText('eventFilterDisclosure', includeDust
    ? `SHOWING RECENT DUST · SIGNAL MODE HIDES ${hidden.toLocaleString('en-US')} EVENTS BELOW ${SIGNAL_MIN_SKR.toLocaleString('en-US')} SKR`
    : `SIGNAL MODE · HIDING ${hidden.toLocaleString('en-US')} EVENTS BELOW ${SIGNAL_MIN_SKR.toLocaleString('en-US')} SKR`);
  if (!filtered.length) { rows.innerHTML = '<tr><td colspan="5" class="empty">No matching events in local history.</td></tr>'; return; }
  const maximum = Math.max(...filtered.map((event) => Number(event.amount || 0)), 1);
  rows.innerHTML = filtered.slice(0, 100).map((event) => `<tr>
    <td class="event-age" title="${new Date(event.blockTime * 1000).toLocaleString()}">${ago(event.blockTime)} ago</td>
    <td class="event-action"><span class="action ${esc(event.type)}">${esc(eventLabel(event.type))}</span></td>
    <td class="event-wallet"><a class="tx-link" href="https://solscan.io/account/${esc(event.wallet)}" target="_blank" rel="noopener">${esc(short(event.wallet))}</a></td>
    <td class="right amount event-amount">${event.amount == null ? '—' : `<span class="event-bar"><i style="width:${Math.max(5, Math.log10(Number(event.amount) + 1) / Math.log10(maximum + 1) * 100)}%"></i></span>${full(event.amount)} SKR`}</td>
    <td class="right event-proof"><button class="evidence-button" data-event-id="${esc(event.id)}" aria-label="Inspect evidence for ${esc(eventLabel(event.type))}">PROOF</button></td>
  </tr>`).join('');
}

function renderQueue(queue) {
  const rows = $('queueRows');
  if (!queue.length) { rows.innerHTML = '<div class="empty">No pending exits found.</div>'; return; }
  const maximum = Math.max(...queue.map((item) => Number(item.amount || 0)), 1);
  rows.innerHTML = queue.slice(0, 12).map((item, index) => {
    const ready = item.status === 'withdrawable';
    const timing = ready ? 'READY TO WITHDRAW' : `UNLOCKS IN ${until(item.unlockAt)}`;
    const size = Math.max(4, Math.log10(Number(item.amount) + 1) / Math.log10(maximum + 1) * 100);
    return `<div class="queue-row" style="--size:${size}%"><div><a href="https://solscan.io/account/${esc(item.wallet)}" target="_blank" rel="noopener">${esc(short(item.wallet))}</a><small>${esc(short(item.stakeAccount))}</small></div><div class="queue-meta"><strong>${full(item.amount)} SKR</strong><small class="${ready ? 'ready' : 'cooling'}">${timing}</small></div><button class="evidence-button" data-queue-index="${index}" aria-label="Inspect queue position evidence">PROOF</button></div>`;
  }).join('');
}

function renderMiniQueue(queue) {
  const target = $('miniQueue');
  if (!queue.length) { target.innerHTML = '<div class="empty">No pending exits.</div>'; return; }
  target.innerHTML = queue.slice(0, 3).map((item, index) => `<div class="mini-queue-row"><span>${String(index + 1).padStart(2, '0')} · ${esc(short(item.wallet))}</span><strong>${fmt(item.amount)} SKR</strong></div>`).join('');
}

function routeNewEvents(events) {
  const latest = [...events].sort((a, b) => (b.blockTime || 0) - (a.blockTime || 0))[0] || null;
  capitalField.setLatest(latest);
  const result = collectUnseenEvents(events, seenEvents, !eventsInitialized);
  seenEvents = result.seen;

  if (!eventsInitialized) {
    eventsInitialized = true;
    setText('fieldStatus', 'LISTENING FOR FINALIZED EVENTS');
    if (latest) {
      const model = normalizeCapitalEvent(latest);
      if (model) setText('fieldLatest', `LAST · ${model.action} · ${model.amountLabel} · ${model.walletLabel}`);
    }
    return;
  }

  for (const event of result.events) {
    const model = normalizeCapitalEvent(event);
    if (!model) continue;
    if (!shouldAnimateCapitalEvent(event)) continue;
    capitalField.enqueue(event);
    const token = ++fieldAnnouncement;
    setText('fieldStatus', `FINALIZED ${model.action} DETECTED`);
    setText('fieldLatest', `${model.amountLabel} · ${model.walletLabel} · ${model.destination}`);
    setTimeout(() => {
      if (token !== fieldAnnouncement) return;
      setText('fieldStatus', 'LISTENING FOR FINALIZED EVENTS');
      setText('fieldLatest', `LAST · ${model.action} · ${model.amountLabel} · ${model.walletLabel}`);
    }, 6_000);
  }
}

function renderState(state) {
  currentState = state;
  renderMetrics(state.metrics);
  renderAnalytics(state.analytics);
  renderEvents(state.recentEvents || []);
  routeNewEvents(state.recentEvents || []);
  const status = state.status || {};
  const recentlySynced = status.lastSyncAt && Math.floor(Date.now() / 1000) - status.lastSyncAt < 60;
    const freshness = status.freshness || (status.lastError ? 'stale' : recentlySynced ? 'fresh' : 'aging');
    document.body.dataset.freshness = freshness;
    const live = !status.lastError && freshness !== 'stale' && freshness !== 'unknown' && (status.phase === 'live' || recentlySynced);
    $('liveDot').className = `dot ${live ? 'live' : freshness === 'stale' || status.lastError ? 'error' : ''}`;
    setText('networkStatus', freshness === 'stale' ? 'STALE' : live ? 'LIVE' : status.phase?.replaceAll('-', ' ').toUpperCase() || 'STARTING');
    const metricsAge = status.freshnessDetail?.metricsAgeSec;
    const ageLabel = status.lastMetricsAt
      ? freshness === 'stale'
        ? `STALE · UPDATED ${ago(status.lastMetricsAt).toUpperCase()} AGO`
        : freshness === 'aging'
          ? `AGING · UPDATED ${ago(status.lastMetricsAt).toUpperCase()} AGO`
          : `UPDATED ${ago(status.lastMetricsAt).toUpperCase()} AGO`
      : 'SCANNING CHAIN';
    setText('freshness', ageLabel);
    setText('briefFreshness', status.lastMetricsAt
      ? `${freshness === 'stale' ? 'STALE · ' : freshness === 'aging' ? 'AGING · ' : ''}${ago(status.lastMetricsAt).toUpperCase()} AGO`
      : 'SCANNING');
    setText('rpcLabel', status.rpc?.replace(/^https?:\/\//, '') || 'Solana RPC');
    setText('integrityRpc', status.lastError ? 'DEGRADED' : freshness === 'stale' ? 'STALE' : freshness === 'aging' ? 'AGING' : 'ONLINE');
    $('integrityRpc').className = status.lastError || freshness === 'stale' ? 'warn' : freshness === 'aging' ? 'warn' : 'ok';
    const queueCount = status.userStakeAccountCount != null ? `${status.userStakeAccountCount} USERSTAKE ACCOUNTS` : null;
    setText('footerStatus', status.lastError
      ? `RPC warning: ${status.lastError}`
      : [
        freshness === 'stale' ? 'Data window is stale' : null,
        status.lastEventAt ? `Last event ${ago(status.lastEventAt)} ago` : 'syncing events',
        queueCount,
        metricsAge != null ? `metrics ${metricsAge}s` : null,
      ].filter(Boolean).join(' · '));
}

document.querySelectorAll('#filters button').forEach((button) => button.addEventListener('click', () => {
  if (button.dataset.dust) {
    includeDust = !includeDust;
    button.classList.toggle('active', includeDust);
    button.setAttribute('aria-pressed', String(includeDust));
    if (currentState) renderEvents(currentState.recentEvents || []);
    return;
  }
  document.querySelectorAll('#filters button:not([data-dust])').forEach((item) => item.classList.remove('active'));
  button.classList.add('active');
  filter = { type: button.dataset.type || '', min: Number(button.dataset.min || 0) };
  if (currentState) renderEvents(currentState.recentEvents || []);
}));

document.querySelectorAll('[data-range]').forEach((button) => button.addEventListener('click', () => {
  selectedRange = button.dataset.range || '24h';
  document.querySelectorAll('[data-range]').forEach((item) => {
    const active = item.dataset.range === selectedRange;
    item.classList.toggle('active', active);
    item.setAttribute('aria-pressed', String(active));
  });
  if (currentState) renderAnalytics(currentState.analytics);
}));

document.querySelectorAll('[data-provenance]').forEach((element) => {
  if (!element.querySelector(':scope > .provenance-button')) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'provenance-button evidence-button';
    button.dataset.provenanceTrigger = element.dataset.provenance;
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-label', `Inspect provenance: ${element.dataset.provenance}`);
    button.textContent = 'SOURCE';
    element.appendChild(button);
  }
  element.setAttribute('data-provenance-host', element.dataset.provenance);
});

document.addEventListener('click', (event) => {
  const queueButton = event.target.closest('[data-queue-index]');
  if (queueButton) {
    const item = currentState?.metrics?.queue?.[Number(queueButton.dataset.queueIndex)];
    if (item) openQueueEvidence(item, queueButton);
    return;
  }
  const eventButton = event.target.closest('[data-event-id]');
  if (eventButton) {
    const item = [...signalEvents, ...(currentState?.recentEvents || [])].find((candidate) => candidate.id === eventButton.dataset.eventId);
    if (item) openEventEvidence(item, eventButton);
    return;
  }
  const provenanceButton = event.target.closest('[data-provenance-trigger], [data-provenance]');
  if (provenanceButton) {
    const key = provenanceButton.dataset.provenanceTrigger || provenanceButton.dataset.provenance;
    openMetricEvidence(key, provenanceButton);
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') closeDrawer();
  if (event.key === 'Tab' && $('evidenceDrawer').classList.contains('open')) {
    const focusable = [...$('evidenceDrawer').querySelectorAll('button,a[href]')].filter((element) => !element.disabled);
    if (focusable.length) {
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }
});
$('drawerClose').addEventListener('click', closeDrawer);
$('drawerScrim').addEventListener('click', closeDrawer);

fetch('/api/config').then((response) => response.json()).then((config) => {
  $('programLink').href = `https://solscan.io/account/${config.programId}`;
  $('vaultLink').href = `https://solscan.io/account/${config.stakeVault}`;
}).catch(() => {});
fetch('/api/state').then((response) => response.json()).then(renderState).catch(() => {});
fetch(`/api/events?limit=100&min=${SIGNAL_MIN_SKR}`).then((response) => response.json()).then((result) => {
  signalEvents = result.items || [];
  signalEventTotal = Number(result.total || signalEvents.length);
  if (currentState) renderEvents(currentState.recentEvents || []);
}).catch(() => {});

function renderAudience(stats) {
  if (!stats) return;
  setText('audienceLive', Number(stats.liveSessions || 0).toLocaleString('en-US'));
  setText('audienceTotal', Number(stats.visitsTotal || 0).toLocaleString('en-US'));
  const since = stats.trackingSince ? new Date(stats.trackingSince) : null;
  setText('audienceSince', since && !Number.isNaN(since.valueOf())
    ? `TRACKING SINCE ${since.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).toUpperCase()}`
    : 'TRACKING SINCE —');
}

async function registerAudienceVisit() {
  try {
    let sessionId = sessionStorage.getItem('skr-audience-session');
    if (!sessionId) {
      sessionId = crypto.randomUUID();
      sessionStorage.setItem('skr-audience-session', sessionId);
    }
    const response = await fetch('/api/audience/visit', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }), keepalive: true,
    });
    if (!response.ok) throw new Error('Audience registration failed');
    renderAudience(await response.json());
    const heartbeat = () => fetch('/api/audience/heartbeat', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }), keepalive: true,
    }).then((reply) => reply.json()).then(renderAudience).catch(() => {});
    setInterval(heartbeat, 30_000);
  } catch {
    fetch('/api/audience').then((response) => response.json()).then(renderAudience).catch(() => {});
  }
}

registerAudienceVisit();

let reconnectDelay = 1_500;
let offlineTimer = null;
let reconnectTimer = null;
function connect() {
  const stream = new EventSource('/api/stream');
  stream.onopen = () => {
    reconnectDelay = 1_500;
    clearTimeout(offlineTimer);
    clearTimeout(reconnectTimer);
    $('liveDot').className = 'dot live';
    setText('networkStatus', 'LIVE');
  };
  stream.addEventListener('state', (event) => renderState(JSON.parse(event.data)));
  stream.addEventListener('events', (message) => {
    try {
      const incoming = JSON.parse(message.data);
      routeNewEvents([...(incoming || []), ...(currentState?.recentEvents || [])]);
    } catch {}
  });
  stream.addEventListener('audience', (event) => {
    try { renderAudience(JSON.parse(event.data)); } catch {}
  });
  stream.onerror = () => {
    stream.close();
    clearTimeout(reconnectTimer);
    $('liveDot').className = 'dot';
    reconnectTimer = setTimeout(() => setText('networkStatus', 'RECONNECTING'), 5_000);
    offlineTimer = setTimeout(() => { $('liveDot').className = 'dot error'; setText('networkStatus', 'OFFLINE'); }, 30_000);
    const delay = reconnectDelay;
    reconnectDelay = Math.min(30_000, Math.round(reconnectDelay * 1.8));
    setTimeout(connect, delay);
  };
}
connect();
setInterval(() => { if (currentState) renderState(currentState); }, 10_000);

function renderClock() {
  setText('clock', `${new Date().toISOString().slice(11, 19)} UTC`);
}
renderClock();
setInterval(renderClock, 1000);

const sections = [...document.querySelectorAll('main section[id]')];
const railLinks = [...document.querySelectorAll('.rail-link')];
const sectionObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  railLinks.forEach((link) => link.classList.toggle('active', link.getAttribute('href') === `#${visible.target.id}`));
}, { rootMargin: '-25% 0px -60%', threshold: [0, .2, .5] });
sections.forEach((section) => sectionObserver.observe(section));
