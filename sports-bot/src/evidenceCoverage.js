import { normalizeEntityName } from './intelligenceStore.js';
import { sportProfile } from './sportProfiles.js';
import { ADVANCED_PROVENANCE_METADATA_FIELDS } from './advancedProvenance.js';
import { finiteNumber,hasAvailabilityObservation } from './dataValidation.js';
import { quoteTimeEpoch } from './oddsPricing.js';
import { observedInputState } from './inputChronology.js';
import {retainedGoalieContextState} from './nhlGoalieFreshness.js';
import { isConfirmedStarter, reconcilePlayerEvidence } from './playerEvidence.js';
export { isConfirmedStarter } from './playerEvidence.js';

const timestamp = value => { const at=quoteTimeEpoch(value); return Number.isFinite(at) ? new Date(at).toISOString() : null; };
const observationClocks = (meta, now) => ({
  observationState: observedInputState(meta,now),
  nativeObservationState: observedInputState({sourceObservationAt:meta?.sourceObservationAt},now)
});
const matches = (team, name) => [team?.name, team?.abbr, ...(team?.aliases || [])]
  .filter(Boolean).some(value => normalizeEntityName(value) === normalizeEntityName(name));

export function summaryEvidence(game = {}, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error('Summary evidence needs a valid information cutoff');
  const meta = game.autoEnrichment || {}, fetchedAt = timestamp(meta.fetchedAt), clocks = observationClocks(meta,now);
  const ageMinutes = fetchedAt ? (now - Date.parse(fetchedAt)) / 60000 : null;
  const receiptFresh = ageMinutes !== null && ageMinutes >= 0 && ageMinutes <= 15
    && ['network', 'revalidated', 'fresh'].includes(meta.cacheState);
  const usable = !['invalid_observation_time','after_information_cutoff'].includes(clocks.observationState);
  const reportedInjurySides=['away','home'].filter(side=>(meta.injuryTeams||[]).some(team=>matches(game[side],team)));
  const coveredSides = usable&&receiptFresh?reportedInjurySides:[];
  return { fetchedAt, ageMinutes, receiptFresh, ...clocks, cacheState: meta.cacheState || 'unknown',
    injuryCoveredSides: coveredSides,
    reportedInjurySides,
    injuryReceiptStatus:usable&&receiptFresh?'current_receipt_not_publication_verification':'unusable_or_stale_receipt',
    providerMapping: {provider: game.summaryIdentity?.provider || 'unknown', status: game.summaryIdentity?.status || 'unknown',
      reason: game.summaryIdentity?.reason || null, verification: 'provided_mapping_assertion_not_independently_timestamped'},
    injuryCoverage: coveredSides.length === 2 ? 'reported_both_sides' : coveredSides.length ? 'reported_one_side' : 'unknown',
    sourceObservationAt: timestamp(meta.sourceObservationAt),
    underlyingFreshnessVerified: false };
}

export function buildEvidenceCoverage(game = {}, { now = Date.now(), players: selectedPlayers = null, teams: selectedTeams = null } = {}) {
  if (!Number.isFinite(now)) throw new Error('Evidence coverage needs a valid information cutoff');
  const summary = summaryEvidence(game, now), profile = sportProfile(game).key;
  const goalieState=game.goalieResearch?retainedGoalieContextState(game.goalieResearch,game,now):null;
  const criticalRole = { football: /quarterback|\bqb\b/i, baseball: /starting pitcher|\bsp\b/i,
    hockey: /goalie|goaltender|\bg\b/i }[profile];
  const missing = [], sources = {};
  for (const [key, meta] of Object.entries({ schedule: game.sourceMeta, summary: game.autoEnrichment, history: game.autoHistory })) {
    const fetchedAt = timestamp(meta?.fetchedAt), at = fetchedAt ? Date.parse(fetchedAt) : null;
    const state = !meta ? 'missing' : at === null ? 'timestamp_unknown' : at > now ? 'future_receipt'
      : meta.cacheState === 'stale' ? 'stale_cache' : 'receipt_available';
    const clocks = observationClocks(meta,now);
    sources[key] = { fetchedAt, state, ...clocks, cacheState: meta?.cacheState || 'unknown',
      sourceObservationAt: timestamp(meta?.sourceObservationAt), underlyingFreshnessVerified: false };
    if (state !== 'receipt_available') missing.push(`${key}:${state}`);
    if (clocks.observationState !== 'observed_by_cutoff') missing.push(`${key}:observation_${clocks.observationState}`);
    if (clocks.nativeObservationState !== 'observed_by_cutoff') missing.push(`${key}:native_observation_${clocks.nativeObservationState}`);
  }
  if (!summary.receiptFresh) missing.push('summary:fresh_receipt_not_verified');
  if (!game.autoEnrichment && summary.providerMapping.status === 'unavailable') missing.push(summary.providerMapping.reason === 'provider_event_mapping_not_verified'
    ? 'summary:provider_event_mapping_not_verified' : 'summary:provider_mapping_unavailable');
  const advancedObservationState = observedInputState(game.advancedDataset,now);
  if (game.advancedDataset && advancedObservationState !== 'observed_by_cutoff') missing.push(`advanced_dataset:observation_${advancedObservationState}`);
  const advancedReceipts = Array.isArray(game.advancedDataset?.sourceReceiptTimes) ? game.advancedDataset.sourceReceiptTimes.map(timestamp) : [];
  if (game.advancedDataset && (!advancedReceipts.length || advancedReceipts.some(value => value === null))) missing.push('advanced_dataset:receipt_times_unknown');
  const advancedRefreshes = (game.advancedDataset?.sourceRefreshStatuses || []).map(row => {
    const checkedAt = timestamp(row.checkedAt), available = checkedAt && Date.parse(checkedAt) <= now;
    const lastSuccessAt = timestamp(row.lastSuccessAt);
    return { sourceId: row.sourceId, state: available ? row.state : 'unknown_at_cutoff', checkedAt,
      requestKey: available ? row.requestKey || null : null,
      lastSuccessRequestKey: available ? row.lastSuccessRequestKey || null : null,
      lastSuccessAt: available && lastSuccessAt && Date.parse(lastSuccessAt) <= now ? lastSuccessAt : null,
      retryAfter: available ? timestamp(row.retryAfter) : null, providerRetryAfter: available ? timestamp(row.providerRetryAfter) : null };
  });
  if (advancedRefreshes.some(row => row.state === 'failed')) missing.push('advanced_dataset:refresh_failed');
  const sourcePeriodEvidence = game.advancedDataset?.sourcePeriodEvidence || null;
  if (sourcePeriodEvidence && sourcePeriodEvidence.state !== 'matched') missing.push(`advanced_dataset:${sourcePeriodEvidence.state}`);
  const measurementMetadata = new Set([...ADVANCED_PROVENANCE_METADATA_FIELDS,'provider','provenancePolicy','sourceReceiptTimes','sourceRefreshStatuses','publicationTimeVerified','sourceRequestKeys','requestedSourceKey','sourcePeriodEvidence',
    'updatedAt','fetchedAt','sourceFetchedAt','observedAt','sourceObservationAt']);
  const missingMeasurements = Object.entries(game.advancedDataset || {}).filter(([key, value]) => !measurementMetadata.has(key)
    && (value === null || value === undefined || (typeof value === 'number' && !Number.isFinite(value)))).map(([key]) => key);
  if (missingMeasurements.length) missing.push('advanced_dataset:measurements_incomplete');
  const batting=game.advancedDataset?.lineupXwobaEvidence;
  for(const side of ['away','home'])if(batting?.[side]?.sampleMeasurements?.some(row=>!row.positiveSample))missing.push(`${side}:advanced_batting_sample_unknown_or_invalid`);
  const teamSamples=game.advancedDataset?.teamSampleEvidence;
  for(const side of ['away','home'])if(teamSamples?.[side]&&!teamSamples[side].positiveSample)missing.push(`${side}:advanced_team_sample_unknown_or_invalid`);
  for(const side of ['away','home'])if(teamSamples?.[side]?.invalidMeasurements?.length)missing.push(`${side}:advanced_team_measurement_invalid`);
  if(teamSamples?.sharedTeamIdentity)missing.push('advanced_dataset:shared_team_identity');
  const sides = {};
  for (const side of ['away', 'home']) {
    const players = selectedPlayers?.[side] || (game.autoPlayers || []).filter(row => matches(game[side], row.team));
    const lineup = reconcilePlayerEvidence((game.autoLineups || []).filter(row => matches(game[side], row.team)), players);
    const injuries = players.filter(row => /injury/i.test(row.source || ''));
    const critical = criticalRole ? reconcilePlayerEvidence([...players, ...lineup]).filter(row => criticalRole.test(row.role || '')) : [];
    const confirmedCritical=critical.filter(isConfirmedStarter);
    const metrics = players.flatMap(row => Object.values(row.stats || {})).map(value => finiteNumber(value));
    const historyGames = finiteNumber(game.autoHistory?.[`${side}Games`]);
    sides[side] = {
      historyGames, playerRecords: players.length, injuryRecords: injuries.length,
      modelInputs: { manualPlayers: players.filter(row => !row.autoGenerated).length,
        teamSource: selectedTeams?.[side]?.source || (selectedTeams?.[side] ? 'manual_or_legacy_profile' : 'no_selected_profile'),
        teamHistorySamples: finiteNumber(selectedTeams?.[side]?.sampleSize),
        nativeRecordEvidence:game[side]?.recordEvidence||null,
        advancedTeamFeatureEvidence: { offenseSamples: finiteNumber(selectedTeams?.[side]?.stats?.advancedOffenseSamples),
          defenseSamples: finiteNumber(selectedTeams?.[side]?.stats?.advancedDefenseSamples), metricSamples: selectedTeams?.[side]?.stats?.advancedMetricSamples || null },
        players: players.map(row => ({ playerId: String(row.sourceAthleteId || row.id || ''), source: row.source || 'manual_or_unknown',
          updatedAt: timestamp(row.updatedAt), historicalParticipationSamples: finiteNumber(row.stats?.historicalParticipationSamples),
          historicalPerformanceSamples: finiteNumber(row.stats?.historicalPerformanceSamples),
          historicalStarterSamples: finiteNumber(row.stats?.historicalStarterSamples), historicalStarterConflicts: finiteNumber(row.stats?.historicalStarterConflicts),
          historicalStarterEvidence: row.participationProjection?.historicalStarterEvidence || 'unknown',
          historicalStatConflicts: row.historicalStatConflicts || [], historicalFormEvidence: row.historicalFormEvidence || 'unknown',
          historicalParticipationEvidence: row.participationProjection?.historicalParticipationEvidence || 'unknown',
          workloadBasis: row.participationProjection?.workloadBasis || null, workloadUnitMismatch: row.participationProjection?.workloadUnitMismatch || false, availabilityObserved: hasAvailabilityObservation(row),
          availabilityEvidence: row.availabilityEvidence || 'manual_or_legacy_assertion',
          status: row.status || 'unknown', confirmedStarter: isConfirmedStarter(row) })) },
      injuryCoverage: summary.injuryCoveredSides.includes(side) ? 'team_report_received_not_a_clean_bill_of_health' : 'unknown',
      confirmedStarters: lineup.filter(isConfirmedStarter).length,
      lineupEvidenceConflicts: lineup.filter(row => row.availabilityConflict || row.starterEvidenceConflict).length,
      projectedStarters: players.filter(row => row.starter && !isConfirmedStarter(row)).length,
      criticalRole: criticalRole ? criticalRole.source : 'not_a_single_position',
      criticalConfirmedAssertions:confirmedCritical.length,
      criticalStarterStatus: !criticalRole ? 'not_applicable' : confirmedCritical.length>1?'conflicting_confirmed_records':confirmedCritical.length===1
        ? 'confirmed_record_present' : critical.length ? 'projected_or_unavailable' : 'missing',
      playerHistorySampleSizes: players.map(row => ({ playerId: String(row.sourceAthleteId || row.id || ''),
        games: finiteNumber(row.stats?.historicalBoxscoreGames) })),
      numericStats: { observed: metrics.filter(value => value !== null).length, zero: metrics.filter(value => value === 0).length,
        missing: metrics.filter(value => value === null).length },
      lateScratchCoverage: 'not_independently_verified', bullpenAvailability: profile === 'baseball' ? 'not_independently_verified' : 'not_applicable'
    };
    if (!summary.injuryCoveredSides.includes(side)) missing.push(`${side}:injury_coverage_unknown`);
    if (sides[side].lineupEvidenceConflicts) missing.push(`${side}:lineup_evidence_conflict`);
    if (historyGames === null || historyGames < 8) missing.push(`${side}:thin_or_unknown_team_history`);
    if (criticalRole && sides[side].criticalStarterStatus !== 'confirmed_record_present') missing.push(`${side}:critical_starter_unconfirmed`);
    if(confirmedCritical.length>1)missing.push(`${side}:critical_starter_identity_conflict`);
  }
  return { schema: 'sports-evidence-coverage-v2', gameId: String(game.id || ''), league: game.leagueKey || '',
    cutoffAt: new Date(now).toISOString(), summary, sources, sides,
    availabilityProviderEvidence: game.availabilityProviderEvidence || null,
    nhlTeamIdentity:game.nhlTeamIdentity?{status:game.nhlTeamIdentity.status,reason:game.nhlTeamIdentity.reason||null,fetchedAt:timestamp(game.nhlTeamIdentity.fetchedAt),provider:game.nhlTeamIdentity.provider||null,policy:'Scoped naming evidence only; no injury/starter coverage or confidence bonus.'}:null,
    goalieResearch: game.goalieResearch ? {status:goalieState?'unavailable':game.goalieResearch.status,reason:goalieState||game.goalieResearch.reason||null,provider:game.goalieResearch.provider||null,
      fetchedAt:timestamp(game.goalieResearch.fetchedAt),confirmedStarters:0,injuryCoverage:'unknown',
      candidatesBySide:Object.fromEntries(['away','home'].map(side=>[side,goalieState?0:game.goalieResearch.sides?.[side]?.candidates?.length||0])),
      policy:'Season context only; not a starter or health confirmation.'} : null,
    sourceConflicts: (game.sourceCorroboration?.conflicts || []).length,
    sourceProviders: game.sourceCorroboration?.providers || [],
    venue: { neutral: typeof game.neutralSite === 'boolean' ? game.neutralSite : null,
      verification: 'provider_or_manual_assertion_not_independently_attested' },
    rosterTransitionRisk: finiteNumber(game.autoLineup?.rosterTransitionRisk),
    advancedDatasetProvenance: { observationState: advancedObservationState, provider: game.advancedDataset?.provider || null,
      receiptPolicy: game.advancedDataset?.provenancePolicy || 'unknown_legacy', sourceReceiptTimes: advancedReceipts,
      sourceRequestKeys: game.advancedDataset?.sourceRequestKeys || [], requestedSourceKey: game.advancedDataset?.requestedSourceKey || null,
      sourceRefreshStatuses: advancedRefreshes, sourcePeriodEvidence,
      lineupXwobaEvidence: game.advancedDataset?.lineupXwobaEvidence || null, teamSampleEvidence:game.advancedDataset?.teamSampleEvidence||null,
      sourceContributions: Array.isArray(game.advancedDataset?.sourceContributions) ? game.advancedDataset.sourceContributions.map(entry => ({
        sourceId: entry?.sourceId || 'unknown', fields: Array.isArray(entry?.fields) ? entry.fields.filter(key=>typeof key==='string') : [],
        sourceReceiptTimes: Array.isArray(entry?.sourceReceiptTimes) ? entry.sourceReceiptTimes.map(timestamp) : [null],
        sourceRequestKeys: Array.isArray(entry?.sourceRequestKeys) ? [...entry.sourceRequestKeys] : [null]
      })) : null,
      missingMeasurements, measurementCoverageScope: 'Enumerated missing fields only; not a league completeness attestation.',
      missingOrInvalidReceipts: advancedReceipts.filter(value => value === null).length,
      nativePublicationVerified: false },
    advancedStatsAvailability: 'enumerated_player_stats_only_not_a_league_completeness_attestation',
    missing, completenessVerified: false };
}

/** Read-only report over frozen issued inputs; no provider fetching or reconstruction. */
export function summarizeEvidenceCoverage(records = []) {
  const issued = records.filter(row => row.type === 'forecast' && row.payload.lifecycleState === 'ISSUED');
  const reasons = {}, leagues = {};
  const forecasts = issued.map(({payload: row}) => {
    const coverage = row.evidenceCoverage;
    const missing = coverage?.missing || ['frozen_evidence_coverage_unavailable'];
    for (const reason of missing) reasons[reason] = (reasons[reason] || 0) + 1;
    leagues[row.league || 'unknown'] = (leagues[row.league || 'unknown'] || 0) + 1;
    return { forecastId: row.forecastId, gameId: row.gameId, league: row.league, modelVersion: row.modelVersion,
      horizon: row.horizon, predictionGeneratedAt: row.predictionGeneratedAt,
      coverageStatus: coverage ? 'frozen_report_available' : 'unknown_legacy_input_coverage', coverage: coverage || null };
  });
  return { schema: 'sports-evidence-audit-v1', issuedForecasts: issued.length,
    withFrozenCoverage: forecasts.filter(row => row.coverage).length, byLeague: leagues,
    missingReasons: reasons, forecasts, accuracyImprovementEstablished: false,
    limitations: ['Counts are forecast records; different horizons/versions of a game are correlated.',
      'A fresh fetch receipt does not attest freshness of the underlying lineup, injury or statistic.'] };
}
