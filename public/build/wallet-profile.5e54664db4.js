const $ = (id) => document.getElementById(id);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const walletFromPath = (pathname) => {
  const match = String(pathname).match(/^\/w(?:\/([^/]+))?\/?$/);
  return match?.[1] ? decodeURIComponent(match[1]).trim() : '';
};
export const walletPath = (wallet) => `/w/${encodeURIComponent(String(wallet).trim())}`;
export const formatAmount = (value) => Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 3 });
const agoOrDate = (timestamp) => timestamp ? new Date(timestamp * 1_000).toLocaleString() : 'NOT SCHEDULED';
const short = (value) => value ? `${value.slice(0, 5)}…${value.slice(-5)}` : 'UNAVAILABLE';

function positionRow(item) {
  const status = item.status === 'withdrawable' ? 'WITHDRAWABLE' : item.status === 'cooldown' ? `UNLOCKS ${agoOrDate(item.unlockAt)}` : 'ACTIVE';
  return `<article class="row"><div><strong>${esc(short(item.stakeAccount))}</strong><small>${esc(status)}<br>GUARDIAN ${esc(short(item.guardianPool))}</small></div><aside><b>${formatAmount(item.activeStaked || item.pendingUnstake)} SKR</b><br><a href="https://solscan.io/account/${esc(item.stakeAccount)}" target="_blank" rel="noopener">ACCOUNT PROOF ↗</a></aside></article>`;
}

function historyRow(item) {
  const evidence = item.evidence || {};
  return `<article class="row"><div><strong>${esc(String(item.type || '').replaceAll('_', ' ').toUpperCase())}</strong><small>${esc(agoOrDate(item.blockTime))}<br>${esc(evidence.amountMethod || 'AMOUNT METHOD UNAVAILABLE')}</small></div><aside><b>${formatAmount(item.amount)} SKR</b><br><a href="https://solscan.io/tx/${esc(item.signature)}" target="_blank" rel="noopener">TRANSACTION ↗</a></aside></article>`;
}

function showMessage(message) {
  $('profile').hidden = true;
  $('message').hidden = false;
  $('message').textContent = message;
}

async function loadProfile(wallet) {
  $('message').hidden = true;
  $('profile').hidden = false;
  $('profileStatus').textContent = 'LOADING';
  const response = await fetch(`/api/wallet/${encodeURIComponent(wallet)}`, { headers: { accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok) return showMessage(response.status === 400 ? 'That is not a valid Solana public key.' : 'The finalized wallet index is temporarily unavailable. Please try again shortly.');
  if (!payload.found) return showMessage('No SKR staking position was found for this address in the current finalized scan.');
  $('walletLabel').textContent = wallet;
  $('profileStatus').textContent = 'FINALIZED';
  $('activeStaked').textContent = formatAmount(payload.totals.activeStaked);
  $('pendingUnstake').textContent = formatAmount(payload.totals.pendingUnstake);
  $('withdrawable').textContent = formatAmount(payload.totals.withdrawable);
  $('nextUnlock').textContent = payload.nextUnlockAt ? agoOrDate(payload.nextUnlockAt) : 'NONE';
  $('positionCount').textContent = `${payload.totals.positions} POSITION${payload.totals.positions === 1 ? '' : 'S'}`;
  $('scanMode').textContent = String(payload.provenance?.scanMode || 'FINALIZED').replaceAll('-', ' ').toUpperCase();
  $('positions').innerHTML = payload.positions?.length ? payload.positions.map(positionRow).join('') : '<p class="empty">NO POSITION ROWS</p>';
  $('history').innerHTML = payload.history?.items?.length ? payload.history.items.slice(0, 12).map(historyRow).join('') : '<p class="empty">NO INDEXED EVENTS FOR THIS WALLET</p>';
  $('caveat').textContent = [payload.provenance?.accuracy, payload.provenance?.caveat].filter(Boolean).join(' ');
}

if (typeof document !== 'undefined') {
  const form = $('walletForm');
  const input = $('walletInput');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const wallet = input.value.trim();
    if (!wallet) return;
    history.pushState(null, '', walletPath(wallet));
    loadProfile(wallet).catch(() => showMessage('The profile request failed. Please try again.'));
  });

  const initialWallet = walletFromPath(location.pathname);
  if (initialWallet) {
    input.value = initialWallet;
    loadProfile(initialWallet).catch(() => showMessage('The profile request failed. Please try again.'));
  }
}
