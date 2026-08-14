"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Location = {
  id: string;
  name: string;
  region: string;
  x: number;
  y: number;
  kind: "haven" | "realm" | "wild" | "shadow";
  era: string;
  summary: string;
  detail: string;
};

type Journey = {
  id: string;
  name: string;
  subtitle: string;
  color: string;
  path: string[];
};

const locations: Location[] = [
  {
    id: "shire",
    name: "The Shire",
    region: "Eriador",
    x: 18,
    y: 38,
    kind: "haven",
    era: "Home of the Hobbits",
    summary: "Green hills, round doors, and the quiet beginning of an impossible journey.",
    detail: "Far from the designs of kings and wizards, the Shire endures through good earth, full pantries, and a stubborn love of home.",
  },
  {
    id: "rivendell",
    name: "Rivendell",
    region: "Valley of Imladris",
    x: 38,
    y: 31,
    kind: "realm",
    era: "The Last Homely House",
    summary: "A hidden refuge where songs, memory, and counsel shape the fate of the Ring.",
    detail: "Sheltered beneath the Misty Mountains, Rivendell holds the wisdom of many ages—and the courage to send nine walkers east.",
  },
  {
    id: "moria",
    name: "Moria",
    region: "Khazad-dûm",
    x: 43,
    y: 47,
    kind: "wild",
    era: "Kingdom under the Mountain",
    summary: "Vast halls beneath the mountains, abandoned to darkness and older fire.",
    detail: "The road below the mountains is a test of fellowship: silent chambers, deep drums, and a bridge too narrow for fear.",
  },
  {
    id: "lothlorien",
    name: "Lothlórien",
    region: "The Golden Wood",
    x: 50,
    y: 43,
    kind: "realm",
    era: "Realm of the Galadhrim",
    summary: "A timeless forest beneath golden leaves, guarded by an ancient power.",
    detail: "Here the Company rests, grieves, and receives gifts whose true worth will be revealed only on the road ahead.",
  },
  {
    id: "fangorn",
    name: "Fangorn",
    region: "The Entwood",
    x: 52,
    y: 54,
    kind: "wild",
    era: "Oldest of forests",
    summary: "A watchful forest where the trees remember injuries the world has forgotten.",
    detail: "Beneath its dark boughs, small voices awaken an ancient anger—and Isengard learns that forests can march.",
  },
  {
    id: "rohan",
    name: "Edoras",
    region: "Rohan",
    x: 58,
    y: 61,
    kind: "realm",
    era: "The Golden Hall",
    summary: "The wind-scoured seat of the horse-lords, bright beneath a wide and restless sky.",
    detail: "From the hill of Meduseld, Théoden rises from shadow and summons every rider who can still answer the horn.",
  },
  {
    id: "isengard",
    name: "Isengard",
    region: "Nan Curunír",
    x: 48,
    y: 61,
    kind: "shadow",
    era: "The Ring of Iron",
    summary: "Once a green circle, remade into a forge of engines and ambition.",
    detail: "At its center stands Orthanc: a black tower, a captured wizard, and the ruinous certainty that power can master all things.",
  },
  {
    id: "gondor",
    name: "Minas Tirith",
    region: "Gondor",
    x: 68,
    y: 70,
    kind: "realm",
    era: "The White City",
    summary: "Seven circles of stone standing between the free peoples and the gathering Shadow.",
    detail: "The city waits beneath Mount Mindolluin, its empty throne and White Tree bearing witness to a kingdom not yet without hope.",
  },
  {
    id: "dead-marshes",
    name: "Dead Marshes",
    region: "Dagorlad",
    x: 70,
    y: 45,
    kind: "wild",
    era: "Echoes of old war",
    summary: "A drowned battlefield where cold lights shimmer beneath black water.",
    detail: "The secret path east winds through fog and memory. The wise traveler follows the guide—and never follows the lights.",
  },
  {
    id: "mordor",
    name: "Mount Doom",
    region: "Mordor",
    x: 87,
    y: 34,
    kind: "shadow",
    era: "Orodruin",
    summary: "The mountain of fire where the Ring was forged—and where it alone can be unmade.",
    detail: "Beyond the ash plain, the road narrows to one final choice. No army can finish this task; only two small figures remain.",
  },
];

const journeys: Journey[] = [
  {
    id: "fellowship",
    name: "The Fellowship",
    subtitle: "From quiet hills to a broken company",
    color: "#e1b862",
    path: ["shire", "rivendell", "moria", "lothlorien"],
  },
  {
    id: "king",
    name: "The Return of the King",
    subtitle: "Through shadow to the White City",
    color: "#b9d3c4",
    path: ["lothlorien", "fangorn", "rohan", "gondor"],
  },
  {
    id: "ringbearer",
    name: "The Ring-bearers",
    subtitle: "The secret road into Mordor",
    color: "#dc7651",
    path: ["lothlorien", "dead-marshes", "mordor"],
  },
];

function JourneyCanvas({ journey, progress }: { journey: Journey; progress: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const rect = parent.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.scale(ratio, ratio);
      ctx.clearRect(0, 0, rect.width, rect.height);
      const points = journey.path
        .map((id) => locations.find((location) => location.id === id))
        .filter(Boolean) as Location[];
      if (points.length < 2) return;

      ctx.beginPath();
      points.forEach((point, index) => {
        const x = (point.x / 100) * rect.width;
        const y = (point.y / 100) * rect.height;
        if (index === 0) ctx.moveTo(x, y);
        else {
          const previous = points[index - 1];
          const px = (previous.x / 100) * rect.width;
          const py = (previous.y / 100) * rect.height;
          const bend = index % 2 === 0 ? 22 : -22;
          ctx.quadraticCurveTo((px + x) / 2, (py + y) / 2 + bend, x, y);
        }
      });
      ctx.setLineDash([7, 8]);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = journey.color;
      ctx.shadowColor = journey.color;
      ctx.shadowBlur = 7;
      const totalLength = Math.max(rect.width, rect.height) * 2.8;
      ctx.lineDashOffset = totalLength * (1 - progress);
      ctx.stroke();
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [journey, progress]);

  return <canvas ref={ref} className="journey-canvas" aria-hidden="true" />;
}

export default function Home() {
  const [selected, setSelected] = useState<Location>(locations[0]);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [activeJourney, setActiveJourney] = useState(journeys[0]);
  const [journeyOpen, setJourneyOpen] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [routeProgress, setRouteProgress] = useState(1);
  const drag = useRef({ active: false, x: 0, y: 0, ox: 0, oy: 0 });
  const audioRef = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null);

  const filteredLocations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return locations;
    return locations.filter((location) =>
      `${location.name} ${location.region} ${location.kind}`.toLowerCase().includes(needle),
    );
  }, [query]);

  const focusLocation = useCallback((location: Location) => {
    setSelected(location);
    setPanelOpen(true);
    setSearchOpen(false);
    setZoom((current) => Math.max(current, 1.35));
    setOffset({ x: (50 - location.x) * 2.2, y: (50 - location.y) * 1.4 });
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      setStep((current) => {
        const next = current + 1;
        if (next >= activeJourney.path.length) {
          setPlaying(false);
          return current;
        }
        const location = locations.find((item) => item.id === activeJourney.path[next]);
        if (location) focusLocation(location);
        setRouteProgress((next + 1) / activeJourney.path.length);
        return next;
      });
    }, 2300);
    return () => window.clearInterval(timer);
  }, [activeJourney, focusLocation, playing]);

  useEffect(() => {
    return () => {
      audioRef.current?.source.stop();
      audioRef.current?.context.close();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const toggleSound = () => {
    if (soundOn) {
      audioRef.current?.source.stop();
      audioRef.current?.context.close();
      audioRef.current = null;
      setSoundOn(false);
      return;
    }
    const context = new AudioContext();
    const buffer = context.createBuffer(1, context.sampleRate * 3, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const filter = context.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 420;
    const gain = context.createGain();
    gain.gain.value = 0.035;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start();
    audioRef.current = { context, source };
    setSoundOn(true);
  };

  const changeJourney = (journey: Journey) => {
    setActiveJourney(journey);
    setStep(0);
    setPlaying(false);
    setRouteProgress(1);
    const start = locations.find((location) => location.id === journey.path[0]);
    if (start) setSelected(start);
  };

  const togglePlay = () => {
    if (!playing && step >= activeJourney.path.length - 1) {
      setStep(0);
      setRouteProgress(1 / activeJourney.path.length);
      const start = locations.find((location) => location.id === activeJourney.path[0]);
      if (start) focusLocation(start);
    }
    setPlaying((current) => !current);
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  return (
    <main className="world-shell">
      <header className="topbar">
        <button className="brand" onClick={resetView} aria-label="Reset map view">
          <span className="brand-ring" aria-hidden="true">✦</span>
          <span><b>Middle-earth</b><small>An interactive atlas</small></span>
        </button>
        <nav className="header-actions" aria-label="Map actions">
          <button className="icon-button" onClick={() => setSearchOpen((open) => !open)} aria-label="Search places" aria-expanded={searchOpen}>⌕</button>
          <button className={`sound-button ${soundOn ? "active" : ""}`} onClick={toggleSound} aria-pressed={soundOn}>
            <span className="sound-bars" aria-hidden="true"><i /><i /><i /></span>
            <span>{soundOn ? "Sound on" : "Sound off"}</span>
          </button>
          <button className="era-pill"><span /> Third Age</button>
        </nav>
      </header>

      {searchOpen && (
        <section className="search-popover" aria-label="Search Middle-earth">
          <div className="search-input-wrap">
            <span aria-hidden="true">⌕</span>
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a realm, road, or ruin…" aria-label="Search locations" />
            <kbd>ESC</kbd>
          </div>
          <div className="search-results">
            <p>{filteredLocations.length} places discovered</p>
            {filteredLocations.map((location) => (
              <button key={location.id} onClick={() => focusLocation(location)}>
                <span className={`result-rune ${location.kind}`}>✦</span>
                <span><b>{location.name}</b><small>{location.region}</small></span>
                <i>↗</i>
              </button>
            ))}
          </div>
        </section>
      )}

      <section
        className={`map-viewport ${drag.current.active ? "dragging" : ""}`}
        onWheel={(event) => {
          event.preventDefault();
          setZoom((current) => Math.min(2.5, Math.max(0.9, current - event.deltaY * 0.001)));
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          drag.current = { active: true, x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (!drag.current.active) return;
          setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y });
        }}
        onPointerUp={() => { drag.current.active = false; }}
        aria-label="Interactive map of Middle-earth"
      >
        <div className="map-glow" />
        <div className="map-stage" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})` }}>
          <img src="/middle-earth-map.png" alt="An illustrated fantasy map of Middle-earth from green western lands to the fires of Mordor" draggable={false} />
          <div className="map-vignette" />
          <JourneyCanvas journey={activeJourney} progress={routeProgress} />
          {locations.map((location) => {
            const isSelected = selected.id === location.id;
            const isRoute = activeJourney.path.includes(location.id);
            return (
              <button
                key={location.id}
                className={`map-marker ${location.kind} ${isSelected ? "selected" : ""} ${isRoute ? "on-route" : ""}`}
                style={{ left: `${location.x}%`, top: `${location.y}%` }}
                onClick={() => focusLocation(location)}
                aria-label={`Explore ${location.name}`}
              >
                <span className="marker-pulse" />
                <span className="marker-core">✦</span>
                <span className="marker-label"><b>{location.name}</b><small>{location.region}</small></span>
              </button>
            );
          })}
        </div>

        <div className="map-title">
          <small>Explore the realms of</small>
          <h1>Middle-earth</h1>
          <p>Every path has a story. Choose where yours begins.</p>
        </div>

        <div className="zoom-controls" aria-label="Map zoom controls">
          <button onClick={() => setZoom((current) => Math.min(2.5, current + 0.2))} aria-label="Zoom in">+</button>
          <button onClick={() => setZoom((current) => Math.max(0.9, current - 0.2))} aria-label="Zoom out">−</button>
          <button onClick={resetView} aria-label="Reset map">⌾</button>
        </div>
        <div className="compass" aria-hidden="true"><b>N</b><span>✦</span><small>S</small></div>
      </section>

      <aside className={`lore-panel ${panelOpen ? "open" : ""}`} aria-live="polite">
        <button className="panel-close" onClick={() => setPanelOpen(false)} aria-label="Close location details">×</button>
        <div className={`lore-sigil ${selected.kind}`}>✦</div>
        <p className="eyebrow">{selected.region}</p>
        <h2>{selected.name}</h2>
        <p className="era">{selected.era}</p>
        <div className="lore-rule"><span>✦</span></div>
        <p className="lore-lead">{selected.summary}</p>
        <p className="lore-detail">{selected.detail}</p>
        <button className="story-button" onClick={() => setJourneyOpen(true)}>Find it on the journey <span>→</span></button>
        <div className="coordinates">{Math.round(selected.y * 0.7)}° N &nbsp; {Math.round(selected.x * 1.2)}° E</div>
      </aside>

      <section className={`journey-dock ${journeyOpen ? "open" : "closed"}`} aria-label="Choose a journey">
        <button className="dock-handle" onClick={() => setJourneyOpen((open) => !open)} aria-label={journeyOpen ? "Hide journeys" : "Show journeys"}>
          <span />
        </button>
        <div className="journey-heading">
          <div><small>Trace a path through history</small><h2>Choose a journey</h2></div>
          <div className="journey-progress"><b>{String(step + 1).padStart(2, "0")}</b><span />{String(activeJourney.path.length).padStart(2, "0")}</div>
        </div>
        <div className="journey-body">
          <div className="journey-tabs">
            {journeys.map((journey) => (
              <button key={journey.id} className={activeJourney.id === journey.id ? "active" : ""} onClick={() => changeJourney(journey)}>
                <span style={{ background: journey.color }} />
                <b>{journey.name}</b>
                <small>{journey.subtitle}</small>
              </button>
            ))}
          </div>
          <button className={`play-journey ${playing ? "playing" : ""}`} onClick={togglePlay}>
            <span>{playing ? "Ⅱ" : "▶"}</span>
            <i>{playing ? "Pause journey" : "Begin journey"}</i>
          </button>
        </div>
      </section>
      <div className="grain" aria-hidden="true" />
    </main>
  );
}
