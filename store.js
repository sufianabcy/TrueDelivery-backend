import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ADMIN_STATS,
  DISRUPTIONS,
  LIVE_CONDITIONS,
  MOCK_CLAIMS,
  ZONES,
  calculatePremium,
  getRiskScore,
} from './data/mockData.js';
import { DEFAULT_WORKER } from './lib/appConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'runtime.json');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortClaimsNewestFirst(claims) {
  return [...claims].sort((left, right) => new Date(right.date) - new Date(left.date));
}

function createAlert({
  severity = 'info',
  title,
  message,
  disruptionId = null,
  source = 'system',
  createdAt = new Date().toISOString(),
}) {
  return {
    id: `ALT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    severity,
    title,
    message,
    disruptionId,
    source,
    createdAt,
  };
}

function getZoneName(zoneId) {
  return ZONES.find(zone => zone.id === zoneId)?.name || ZONES[0].name;
}

function getClaimDayKey(value) {
  const claimDate = new Date(value);
  if (Number.isNaN(claimDate.getTime())) {
    return '';
  }

  return [
    claimDate.getFullYear(),
    String(claimDate.getMonth() + 1).padStart(2, '0'),
    String(claimDate.getDate()).padStart(2, '0'),
  ].join('-');
}

function hasDuplicateClaim(claims, disruptionId, now) {
  const dayKey = getClaimDayKey(now);
  return claims.some(
    claim => claim.disruptionId === disruptionId && getClaimDayKey(claim.date) === dayKey,
  );
}

function getNextClaimId(existingClaims, now) {
  const currentYear = now.getFullYear();
  const latestSequence = existingClaims.reduce((maxSequence, claim) => {
    const match = /^CLM-(\d{4})-(\d+)$/.exec(claim.id || '');
    if (!match || Number(match[1]) !== currentYear) {
      return maxSequence;
    }

    return Math.max(maxSequence, Number(match[2]));
  }, 0);

  return `CLM-${currentYear}-${String(latestSequence + 1).padStart(3, '0')}`;
}

function enrichWorker(worker) {
  if (!worker) {
    return null;
  }

  const premiumQuote = calculatePremium(worker);
  const riskScore = getRiskScore(worker);
  const zoneId = typeof worker.zone === 'object'
    ? worker.zone?.id || DEFAULT_WORKER.zone
    : worker.zone || DEFAULT_WORKER.zone;

  return {
    ...DEFAULT_WORKER,
    ...worker,
    ...premiumQuote,
    zone: zoneId,
    zoneDetails: premiumQuote.zone,
    riskScore,
  };
}

function createClaimFromDisruption({ disruption, worker, claims, now }) {
  return {
    id: getNextClaimId(claims, now),
    type: disruption.name,
    disruptionId: disruption.id,
    icon: disruption.icon,
    date: now.toISOString(),
    status: 'paid',
    amount: disruption.payout,
    daysAffected: 1,
    autoTriggered: true,
    payoutChannel: 'UPI',
    zone: getZoneName(worker.zone),
    payoutEta: '2.3 min',
    recipientUpi: worker.upi,
  };
}

function getSeverity(disruptionId, conditions) {
  if (disruptionId === 'heavy-rain') {
    if (conditions.weather.rainfall >= 20) return 'triggered';
    if (conditions.weather.rainfall >= 10) return 'warning';
    return 'clear';
  }

  if (disruptionId === 'extreme-heat') {
    if (conditions.weather.temp >= 42) return 'triggered';
    if (conditions.weather.temp >= 38) return 'warning';
    return 'clear';
  }

  if (disruptionId === 'severe-aqi') {
    if (conditions.aqi.value >= 300) return 'triggered';
    if (conditions.aqi.value >= 200) return 'warning';
    return 'clear';
  }

  if (disruptionId === 'platform-outage') {
    if (conditions.platform.downtimeMinutes >= 120) return 'triggered';
    if (
      conditions.platform.swiggy !== 'operational'
      || conditions.platform.zomato !== 'operational'
    ) {
      return 'warning';
    }

    return 'clear';
  }

  if (disruptionId === 'curfew-strike') {
    if (conditions.alerts.includes('curfew') || conditions.alerts.includes('strike')) {
      return 'triggered';
    }

    return 'clear';
  }

  return 'clear';
}

function getSimulatedConditions(disruptionId, currentConditions) {
  const conditions = clone(currentConditions);

  if (disruptionId === 'heavy-rain') {
    conditions.weather.rainfall = 28;
    conditions.weather.condition = 'Heavy Rain';
    return conditions;
  }

  if (disruptionId === 'extreme-heat') {
    conditions.weather.temp = 44.5;
    conditions.weather.condition = 'Heatwave';
    return conditions;
  }

  if (disruptionId === 'severe-aqi') {
    conditions.aqi.value = 340;
    conditions.aqi.category = 'Hazardous';
    conditions.aqi.pm25 = 298;
    return conditions;
  }

  if (disruptionId === 'platform-outage') {
    conditions.platform.swiggy = 'down';
    conditions.platform.zomato = 'operational';
    conditions.platform.downtimeMinutes = 145;
    return conditions;
  }

  if (disruptionId === 'curfew-strike') {
    conditions.alerts = ['curfew'];
    return conditions;
  }

  return conditions;
}

function buildDisruptionStatuses(conditions) {
  return DISRUPTIONS.map(disruption => ({
    ...disruption,
    status: getSeverity(disruption.id, conditions),
  }));
}

function buildClaimsByType(claims) {
  if (claims.length === 0) {
    return ADMIN_STATS.claimsByType;
  }

  const totalsByName = claims.reduce((accumulator, claim) => {
    accumulator[claim.type] = (accumulator[claim.type] || 0) + 1;
    return accumulator;
  }, {});

  return Object.entries(totalsByName).map(([name, value]) => ({
    name,
    value: Math.round((value / claims.length) * 100),
  }));
}

function buildWorkerInsights(state) {
  if (!state.worker) {
    return [];
  }

  const insights = [];
  const primaryAlert = state.alerts[0];

  if (primaryAlert) {
    insights.push({
      id: 'latest-alert',
      tone: primaryAlert.severity,
      title: primaryAlert.title,
      detail: primaryAlert.message,
    });
  }

  if (state.liveConditions.weather.temp >= 38) {
    insights.push({
      id: 'heat-alert',
      tone: 'warning',
      title: 'High-heat watch',
      detail: `Temperature in ${getZoneName(state.worker.zone)} is ${state.liveConditions.weather.temp.toFixed(1)} C. Consider lighter slots until conditions cool down.`,
    });
  }

  if (state.claims.length === 0) {
    insights.push({
      id: 'first-claim',
      tone: 'info',
      title: 'First auto-claim ready',
      detail: 'Simulate a disruption in Live Monitor to see the zero-touch payout flow.',
    });
  } else {
    const lastClaim = state.claims[0];
    insights.push({
      id: 'latest-payout',
      tone: 'good',
      title: `Latest payout: Rs.${lastClaim.amount}`,
      detail: `${lastClaim.type} was paid to ${lastClaim.recipientUpi} on ${new Date(lastClaim.date).toLocaleDateString('en-IN')}.`,
    });
  }

  return insights.slice(0, 3);
}

function buildAdminSummary(state) {
  const workerClaimTotal = state.claims.reduce((sum, claim) => sum + claim.amount, 0);
  const totalPremiumCollected = ADMIN_STATS.totalPremiumCollected + (state.worker ? state.worker.premium * 6 : 0);
  const totalPayouts = ADMIN_STATS.totalPayouts + workerClaimTotal;
  const lossRatio = totalPremiumCollected > 0
    ? Number(((totalPayouts / totalPremiumCollected) * 100).toFixed(1))
    : ADMIN_STATS.lossRatio;

  return {
    ...ADMIN_STATS,
    activePolicies: ADMIN_STATS.activePolicies + (state.worker ? 1 : 0),
    totalPremiumCollected,
    totalPayouts,
    lossRatio,
    claimsByType: buildClaimsByType(state.claims),
    recentAlerts: state.alerts.slice(0, 4),
    systemHealth: [
      { id: 'api', label: 'API status', value: 'Online', tone: 'good' },
      { id: 'engine', label: 'Disruption engine', value: 'Ready', tone: 'good' },
      { id: 'guard', label: 'Duplicate guard', value: state.monitorEvents.some(event => event.status === 'blocked') ? 'Triggered recently' : 'Clean', tone: state.monitorEvents.some(event => event.status === 'blocked') ? 'warning' : 'good' },
      { id: 'sync', label: 'Last backend update', value: new Date(state.updatedAt).toLocaleTimeString('en-IN'), tone: 'neutral' },
    ],
  };
}

function createSeedState() {
  const worker = enrichWorker(DEFAULT_WORKER);
  return {
    worker,
    claims: sortClaimsNewestFirst(clone(MOCK_CLAIMS)),
    liveConditions: clone(LIVE_CONDITIONS),
    alerts: [
      createAlert({
        severity: 'good',
        title: 'Coverage active',
        message: `${worker.name} is protected in ${getZoneName(worker.zone)} for this week.`,
        source: 'policy',
      }),
    ],
    monitorEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

function createClearedState() {
  return {
    worker: null,
    claims: [],
    liveConditions: clone(LIVE_CONDITIONS),
    alerts: [
      createAlert({
        severity: 'info',
        title: 'Demo reset complete',
        message: 'Backend state was reset. You can onboard a new worker now.',
        source: 'system',
      }),
    ],
    monitorEvents: [],
    updatedAt: new Date().toISOString(),
  };
}

async function writeState(state) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const nextState = {
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await fs.writeFile(STATE_FILE, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
  return nextState;
}

async function readState() {
  try {
    const raw = await fs.readFile(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      ...parsed,
      claims: sortClaimsNewestFirst(parsed.claims || []),
      alerts: parsed.alerts || [],
      monitorEvents: parsed.monitorEvents || [],
      liveConditions: parsed.liveConditions || clone(LIVE_CONDITIONS),
      worker: enrichWorker(parsed.worker),
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
  } catch {
    return writeState(createSeedState());
  }
}

function buildSnapshot(state) {
  return {
    worker: state.worker,
    claims: state.claims,
    alerts: state.alerts,
    monitorEvents: state.monitorEvents,
    liveConditions: state.liveConditions,
    disruptionStatuses: buildDisruptionStatuses(state.liveConditions),
    workerInsights: buildWorkerInsights(state),
    adminSummary: buildAdminSummary(state),
    updatedAt: state.updatedAt,
  };
}

export async function getSnapshot() {
  const state = await readState();
  return buildSnapshot(state);
}

export async function saveWorker(nextWorker) {
  const currentState = await readState();
  const worker = enrichWorker(nextWorker);
  const nextState = await writeState({
    ...currentState,
    worker,
    claims: [],
    monitorEvents: [],
    alerts: [
      createAlert({
        severity: 'good',
        title: 'Policy activated',
        message: `${worker.name} is now covered in ${getZoneName(worker.zone)} with ${worker.coverage} coverage.`,
        source: 'policy',
      }),
      ...currentState.alerts.slice(0, 2),
    ],
  });

  return buildSnapshot(nextState);
}

export async function resetDemoState() {
  const nextState = await writeState(createClearedState());
  return buildSnapshot(nextState);
}

export async function simulateDisruption(disruptionId) {
  const currentState = await readState();
  const disruption = DISRUPTIONS.find(item => item.id === disruptionId);

  if (!disruption) {
    const error = new Error('Unknown disruption.');
    error.statusCode = 404;
    throw error;
  }

  if (!currentState.worker) {
    const error = new Error('Onboard a worker before simulating disruptions.');
    error.statusCode = 400;
    throw error;
  }

  const now = new Date();
  const duplicateClaim = hasDuplicateClaim(currentState.claims, disruptionId, now);
  const liveConditions = getSimulatedConditions(disruptionId, currentState.liveConditions);

  const nextEvent = {
    id: `EVT-${Date.now()}`,
    disruptionId,
    name: disruption.name,
    icon: disruption.icon,
    payout: disruption.payout,
    status: duplicateClaim ? 'blocked' : 'approved',
    fraudCheck: duplicateClaim ? 'blocked' : 'passed',
    time: now.toISOString(),
    paidAt: duplicateClaim ? null : now.toISOString(),
  };

  const alerts = [
    createAlert({
      severity: duplicateClaim ? 'warning' : 'critical',
      title: duplicateClaim ? 'Duplicate claim blocked' : `${disruption.name} triggered`,
      message: duplicateClaim
        ? `${disruption.name} was already claimed today, so the duplicate was blocked.`
        : `${disruption.name} breached its threshold in ${getZoneName(currentState.worker.zone)} and a payout was sent automatically.`,
      disruptionId,
      source: 'monitor',
      createdAt: now.toISOString(),
    }),
    ...currentState.alerts,
  ].slice(0, 12);

  const claims = duplicateClaim
    ? currentState.claims
    : sortClaimsNewestFirst([
      createClaimFromDisruption({
        disruption,
        worker: currentState.worker,
        claims: currentState.claims,
        now,
      }),
      ...currentState.claims,
    ]);

  const nextState = await writeState({
    ...currentState,
    liveConditions,
    alerts,
    claims,
    monitorEvents: [nextEvent, ...currentState.monitorEvents].slice(0, 10),
  });

  return buildSnapshot(nextState);
}
