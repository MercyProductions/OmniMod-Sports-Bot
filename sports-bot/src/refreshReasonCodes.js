/** Fixed codes only. Provider/error text must never enter the permanent journal. */
export const REFRESH_REASON_POLICY='sports-refresh-rejection-codes-v2';
const codes=new Set(['build_failed','game_not_scheduled','start_or_completion_invalid',
 'summary_not_revalidated','summary_receipt_outside_attempt','pregame_forecast_not_verified','forecast_issuance_not_verified',
 'journal_issuance_not_verified','ambiguous_game_observations','game_identity_not_found','league_mismatch',
 'scheduled_start_mismatch','unique_event_forecast_not_verified','game_identity_not_verified',
 'cache_event_changed_during_refresh','summary_source_identity_conflict',
 'availability_refresh_horizon_unverified','availability_refresh_previous_forecast_unverified','availability_refresh_cutoff_unverified',
 'availability_refresh_input_not_new_or_current','availability_refresh_selected_input_not_verified']);
export function structuredRefreshReasons(values=[]){
 if(!Array.isArray(values))throw new Error('Invalid structured refresh rejection reasons');
 const reasons=values.filter(value=>typeof value==='string'&&codes.has(value));
 return {reasons,unrecognizedReasonCount:values.length-reasons.length};
}
