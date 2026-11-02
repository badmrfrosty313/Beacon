import { ModulePlaceholder } from '../components/ModulePlaceholder';

export function WatchtowerView() {
  return (
    <ModulePlaceholder
      title="Watchtower"
      plannedFor="Planned for v0.1, Sprint 004 (tasks B-011 to B-013)."
      intro="Events, sources, hypotheses and evidence links, with provenance."
      items={[
        'Record events, sources and hypotheses with explicit provenance fields.',
        'Link evidence as supports, contradicts or context, and view a simple timeline.',
        'Label observations, attributed claims, interpretations and forecasts separately.',
      ]}
      note="Watchtower is a research workspace. It is not an emergency alert system and will not present speculative claims as verified events."
    />
  );
}
