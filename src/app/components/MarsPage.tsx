import { MarsSphere } from './MarsSphere';

function StarGraphic() {
  return (
    <svg viewBox="0 0 40 40" className="w-10 h-10 fill-[var(--ink)] stroke-[var(--ink)] stroke-0">
      <path d="M20 0 L23 17 L40 20 L23 23 L20 40 L17 23 L0 20 L17 17 Z" />
    </svg>
  );
}

export function MarsPage() {
  return (
    <div className="mars-page">
      {/* SVG noise filter */}
      <svg style={{ display: 'none' }}>
        <filter id="noise">
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves={4} stitchTiles="stitch" />
        </filter>
      </svg>

      {/* 3D Background */}
      <MarsSphere />

      {/* UI Layer */}
      <div className="mars-ui-layer">
        {/* Header */}
        <header className="mars-header">
          <div className="mars-brand-pill">
            <div className="mars-status-dot" />
            <span>UAC // ARES DIVISION</span>
          </div>
          <div className="mars-brand-pill" style={{ gap: 20 }}>
            <span className="mars-interactive">Manifest</span>
            <span className="mars-interactive">Trajectory</span>
            <span className="mars-interactive">Colonize</span>
          </div>
        </header>

        {/* Main */}
        <main className="mars-main">
          <div className="mars-data-block mars-data-tl">
            ATMOSPHERE: 95% CO2<br />
            GRAVITY: 3.721 M/S&sup2;<br />
            TEMP: -63&deg;C<br />
            <br />
            [UNINHABITABLE]
          </div>

          <div className="mars-hero-title-wrapper">
            <h1 className="mars-title">MARS</h1>
            <div className="mars-star-graphic">
              <StarGraphic />
            </div>
          </div>

          <div className="mars-subtitle-pill-cluster">
            <a href="#" className="mars-pill">Mission 2034</a>
            <a href="#" className="mars-pill mars-pill-accent">Terraform Protocol</a>
            <a href="#" className="mars-pill">Status: Active</a>
          </div>

          <div className="mars-data-block mars-data-tr">
            DISTANCE: 225M KM<br />
            TRANSIT: 7 MONTHS<br />
            CREW CAPACITY: 100<br />
            <br />
            [PRE-ORDER TICKET]
          </div>
        </main>

        {/* Footer / Map */}
        <div className="mars-grunge-map">
          <div className="mars-map-texture" />
          <div className="mars-map-texture-2" />
          <div className="mars-footer-content">
            <div>
              SECTOR 7<br />
              VALLES MARINERIS<br />
              BASE ALPHA
            </div>
            <div className="mars-coordinate-circle">
              <div className="mars-line-graphic" />
            </div>
            <div style={{ textAlign: 'right' }}>
              DO NOT PANIC<br />
              EST. ARRIVAL<br />
              T-MINUS 12Y
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
