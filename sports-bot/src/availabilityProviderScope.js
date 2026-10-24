import {quoteTimeEpoch} from './oddsPricing.js';
import {normalizeEntityName} from './intelligenceStore.js';

const MAX_AGE=30*60000;
/** Recheck the original adapter assertion, not a merged player's borrowed source label. */
export function availabilityProviderInputState(row,game,now){
 if(!Number.isFinite(now))throw Error('Valid provider availability cutoff required');
 if(!row||typeof row!=='object'||Array.isArray(row))return 'invalid_provider_assertion';
 const scope=row.availabilityEventIdentity,provider=row.availabilityProvider;
 if(typeof provider!=='string'||!provider.trim())return 'provider_identity_unknown';
 if(!scope||scope.schema!=='sports-provider-player-event-v1')return 'event_binding_unknown';
 const start=quoteTimeEpoch(game.startTime),side=scope.side;
 if(game.leagueKey!=='nhl'||game.statusKey!=='scheduled'||!Number.isFinite(start)||now>=start)return 'not_eligible_pregame';
 if(scope.eventId!==String(game.id)||scope.leagueKey!==game.leagueKey||quoteTimeEpoch(scope.startTime)!==start
  ||!['away','home'].includes(side)||scope.awayAbbr!==game.away?.abbr||scope.homeAbbr!==game.home?.abbr
  ||!game.away?.abbr||!game.home?.abbr||game.away.abbr===game.home.abbr
  ||scope.teamAbbr!==game[side]?.abbr||normalizeEntityName(row.team)!==normalizeEntityName(game[side]?.name||game[side]?.abbr))return 'event_or_team_binding_mismatch';
 if(scope.playerIdNamespace!=='nhl'||typeof scope.playerId!=='string'||!/^\d+$/.test(scope.playerId)||row.sourceAthleteId!=='nhl:'+scope.playerId)return 'native_player_binding_mismatch';
 const history=game.availabilityProviderEvidenceByProvider||{};
 const evidence=Object.hasOwn(history,provider)?history[provider]:game.availabilityProviderEvidence?.provider===provider?game.availabilityProviderEvidence:null;
 if(!evidence||evidence.provider!==provider||evidence.conflict||!(/^[a-f0-9]{64}$/).test(row.availabilitySnapshotHash||'')
  ||evidence.snapshotHash!==row.availabilitySnapshotHash||row.sourceReference!==evidence.sourceReference)return 'snapshot_binding_unverified_or_conflicting';
 const observed=quoteTimeEpoch(row.sourceObservationAt),receipt=quoteTimeEpoch(row.updatedAt),expiry=quoteTimeEpoch(row.availabilityExpiresAt);
 if(![observed,receipt,expiry].every(Number.isFinite)||observed>receipt||receipt>now||now-observed>MAX_AGE||expiry<=now||expiry<=receipt||expiry>observed+MAX_AGE
  ||observed!==quoteTimeEpoch(evidence.sourceObservationAt)||receipt!==quoteTimeEpoch(evidence.fetchedAt)||expiry!==quoteTimeEpoch(evidence.expiresAt))return 'snapshot_clock_or_expiry_mismatch';
 return null;
}
