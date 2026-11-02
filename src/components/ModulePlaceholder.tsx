interface ModulePlaceholderProps {
  title: string;
  /** Where this module sits on the roadmap, e.g. "Planned for v0.2". */
  plannedFor: string;
  intro: string;
  items: readonly string[];
  note?: string;
}

/** Honest stand-in for a module that is on the roadmap but has no working features yet. */
export function ModulePlaceholder({
  title,
  plannedFor,
  intro,
  items,
  note,
}: ModulePlaceholderProps) {
  const headingId = `${title.toLowerCase()}-title`;
  return (
    <section className="view" aria-labelledby={headingId}>
      <header className="view-header">
        <div>
          <h1 id={headingId}>{title}</h1>
          <p className="view-subtitle">{intro}</p>
        </div>
        <span className="pill pill-planned">Not implemented yet</span>
      </header>

      <div className="placeholder">
        <p className="placeholder-status">{plannedFor}</p>
        <p className="muted">
          Nothing in this section works yet. This page only describes what is planned.
        </p>
        <h2 className="placeholder-heading">Planned</h2>
        <ul className="placeholder-list">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        {note ? <p className="callout">{note}</p> : null}
      </div>
    </section>
  );
}
