import { MODULES, type ModuleId } from '../modules/registry';
import { BrandMark } from './BrandMark';

interface SidebarProps {
  active: ModuleId;
  onSelect: (id: ModuleId) => void;
}

export function Sidebar({ active, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark className="brand-mark" />
        <div className="brand-text">
          <span className="brand-project">PROJECT</span>
          <span className="brand-name">BEACON</span>
        </div>
      </div>

      <nav aria-label="Modules" className="nav">
        <ul className="nav-list">
          {MODULES.map((module) => {
            const isActive = module.id === active;
            return (
              <li key={module.id}>
                <button
                  type="button"
                  className={isActive ? 'nav-item nav-item-active' : 'nav-item'}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => onSelect(module.id)}
                >
                  <span className="nav-label">{module.label}</span>
                  {module.status === 'planned' ? (
                    <span className="pill pill-planned">Not implemented</span>
                  ) : (
                    <span className="nav-tagline">{module.tagline}</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <p className="sidebar-footer">
        <span className="status-dot" aria-hidden="true" />
        Local-only. No account, no cloud, no telemetry.
      </p>
    </aside>
  );
}
