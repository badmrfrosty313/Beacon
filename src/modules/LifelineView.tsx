import { ModulePlaceholder } from '../components/ModulePlaceholder';

export function LifelineView() {
  return (
    <ModulePlaceholder
      title="Lifeline"
      plannedFor="Planned for v0.2 (exploration target: January to February 2027)."
      intro="Curated, reviewed preparedness references and checklists."
      items={[
        'Emergency references and checklists with provenance and review dates.',
        'Printable communication plans.',
        'Accessible offline viewing.',
      ]}
      note="BEACON is not an emergency service and does not replace professional medical or emergency guidance."
    />
  );
}
