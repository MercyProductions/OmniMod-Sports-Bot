import { buildDailySlate } from './sportsData.js';

const includeOdds = process.argv.includes('--with-odds');
const slate = await buildDailySlate(new Date(), { includeOdds });
console.log(`OmniMod Sports preview for ${slate.dateKey}`);
console.log(`Odds provider: ${includeOdds ? 'explicitly enabled' : 'disabled (use --with-odds to opt in)'}`);
console.log(`Games: ${slate.games.length}`);
for (const prediction of slate.predictions.slice(0, 12)) {
  if (['retrospective_ungraded', 'late_pregame', 'in_play'].includes(prediction.predictionMode)) {
    console.log(`#${prediction.index} ${prediction.startTimeLocal} ${prediction.league} ${prediction.matchup} -> no pregame pick recorded`);
    continue;
  }
  console.log(
    `#${prediction.index} ${prediction.startTimeLocal} ${prediction.league} ${prediction.matchup} -> ${prediction.predictedWinner} (win estimate ${prediction.predictionConfidence || prediction.confidence}, ${prediction.predictionUncertainty || 'uncertainty n/a'}, API data ${prediction.apiConfidence || 'n/a'}, ${prediction.edge ?? 'no edge'}, ${prediction.riskTier ?? 'unknown risk'}${prediction.recommendationStatus === 'withheld' ? ', HIGH UNCERTAINTY' : ''})`
  );
}
if (slate.predictions.length > 12) {
  console.log(`...and ${slate.predictions.length - 12} more`);
}
console.log('Diagnostics:');
for (const line of slate.diagnostics.slice(0, 8)) {
  console.log(`- ${line}`);
}
