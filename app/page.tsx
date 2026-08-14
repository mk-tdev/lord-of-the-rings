"use client";

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WeatherMode, WorldMode } from "./TerrainScene";

const TerrainScene = lazy(() => import("./TerrainScene").then((module) => ({ default: module.TerrainScene })));

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

type Soundscape = {
  context: AudioContext;
  source: AudioBufferSourceNode;
  rumble: OscillatorNode;
  tones: OscillatorNode[];
  toneGain: GainNode;
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

const chapterNarration: Record<string, string> = {
  shire: "A quiet door closes behind them. Ahead lies every road in the world.",
  rivendell: "Beneath the waterfalls, nine companions bind their fates to one impossible purpose.",
  moria: "The road descends. In the deep, drums answer footsteps that should have gone unheard.",
  lothlorien: "Golden leaves fall without wind, and grief is given a moment of grace.",
  fangorn: "The oldest forest wakes, and roots begin to remember their strength.",
  rohan: "Across the grasslands the horns call, and every rider turns toward the storm.",
  gondor: "Seven walls hold beneath a darkened sky while the White Tree waits for dawn.",
  "dead-marshes": "Cold lights drift beneath the water. The path is narrow, and memory has teeth.",
  mordor: "At the end of all roads, hope is carried by the smallest hands.",
};

const worldModes: Array<{ id: WorldMode; label: string }> = [
  { id: "realms", label: "Living realms" },
  { id: "moonlit", label: "Moonlit" },
  { id: "shadow", label: "Shadow spreading" },
  { id: "parchment", label: "Old atlas" },
];

const weatherModes: Array<{ id: WeatherMode; label: string; icon: string }> = [
  { id: "clear", label: "Clear skies", icon: "☼" },
  { id: "rain", label: "Rain", icon: "≋" },
  { id: "snow", label: "Snow", icon: "✣" },
  { id: "ash", label: "Ashfall", icon: "⁙" },
];

export default function Home() {
  const [selected, setSelected] = useState<Location>(locations[0]);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [activeJourney, setActiveJourney] = useState(journeys[0]);
  const [journeyOpen, setJourneyOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [step, setStep] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [cameraFocus, setCameraFocus] = useState({ x: 50, y: 50 });
  const [worldMode, setWorldMode] = useState<WorldMode>("realms");
  const [weather, setWeather] = useState<WeatherMode>("clear");
  const drag = useRef({ active: false, x: 0, y: 0, ox: 0, oy: 0 });
  const audioRef = useRef<Soundscape | null>(null);

  const filteredLocations = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return locations;
    return locations.filter((location) =>
      `${location.name} ${location.region} ${location.kind}`.toLowerCase().includes(needle),
    );
  }, [query]);
  const partyLocation = locations.find((location) => location.id === activeJourney.path[step]) ?? locations[0];

  const focusLocation = useCallback((location: Location, revealLore = true) => {
    setSelected(location);
    setPanelOpen(revealLore);
    setSearchOpen(false);
    setZoom((current) => Math.max(current, revealLore ? 1.35 : 1.52));
    setCameraFocus({ x: location.x, y: location.y });
    setOffset({ x: 0, y: 0 });
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
        if (location) focusLocation(location, false);
        return next;
      });
    }, 2300);
    return () => window.clearInterval(timer);
  }, [activeJourney, focusLocation, playing]);

  useEffect(() => {
    return () => {
      audioRef.current?.source.stop();
      audioRef.current?.rumble.stop();
      audioRef.current?.tones.forEach((tone) => tone.stop());
      audioRef.current?.context.close();
      window.speechSynthesis?.cancel();
    };
  }, []);

  useEffect(() => {
    const soundscape = audioRef.current;
    if (!soundscape || !soundOn) return;
    const baseFrequency = selected.kind === "shadow" ? 73.42 : selected.kind === "realm" ? 110 : selected.kind === "haven" ? 98 : 82.41;
    const now = soundscape.context.currentTime;
    soundscape.tones.forEach((tone, index) => tone.frequency.linearRampToValueAtTime(baseFrequency * [1, 1.5, 2][index], now + 1.8));
    soundscape.toneGain.gain.linearRampToValueAtTime(worldMode === "shadow" ? 0.018 : worldMode === "moonlit" ? 0.012 : 0.009, now + 1.2);
  }, [selected, soundOn, worldMode]);

  useEffect(() => {
    if (!playing || !soundOn || !("speechSynthesis" in window)) return;
    const line = chapterNarration[partyLocation.id];
    if (!line) return;
    window.speechSynthesis.cancel();
    const narration = new SpeechSynthesisUtterance(line);
    narration.rate = 0.82;
    narration.pitch = 0.76;
    narration.volume = 0.5;
    window.speechSynthesis.speak(narration);
    return () => window.speechSynthesis.cancel();
  }, [partyLocation.id, playing, soundOn]);

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
      audioRef.current?.rumble.stop();
      audioRef.current?.tones.forEach((tone) => tone.stop());
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
    const rumble = context.createOscillator();
    const rumbleGain = context.createGain();
    rumble.type = "sine";
    rumble.frequency.value = 42;
    rumbleGain.gain.value = 0.018;
    rumble.connect(rumbleGain).connect(context.destination);
    const toneGain = context.createGain();
    toneGain.gain.value = 0.009;
    const toneFilter = context.createBiquadFilter();
    toneFilter.type = "lowpass";
    toneFilter.frequency.value = 760;
    const tones = [98, 147, 196].map((frequency, index) => {
      const tone = context.createOscillator();
      tone.type = index === 0 ? "sine" : "triangle";
      tone.frequency.value = frequency;
      tone.connect(toneFilter);
      tone.start();
      return tone;
    });
    toneFilter.connect(toneGain).connect(context.destination);
    source.start();
    rumble.start();
    audioRef.current = { context, source, rumble, tones, toneGain };
    setSoundOn(true);
  };

  const changeJourney = (journey: Journey) => {
    setActiveJourney(journey);
    setStep(0);
    setPlaying(false);
    const start = locations.find((location) => location.id === journey.path[0]);
    if (start) {
      setSelected(start);
      setCameraFocus({ x: start.x, y: start.y });
    }
    setWeather(journey.id === "ringbearer" ? "ash" : journey.id === "king" ? "rain" : "clear");
  };

  const togglePlay = () => {
    if (!playing) {
      setPanelOpen(false);
      setJourneyOpen(false);
      const current = locations.find((location) => location.id === activeJourney.path[step]);
      if (current) focusLocation(current, false);
    }
    if (!playing && step >= activeJourney.path.length - 1) {
      setStep(0);
      const start = locations.find((location) => location.id === activeJourney.path[0]);
      if (start) focusLocation(start, false);
    }
    setPlaying((current) => !current);
  };

  const resetView = () => {
    setZoom(1);
    setOffset({ x: 0, y: 0 });
    setTilt({ x: 0, y: 0 });
    setCameraFocus({ x: 50, y: 50 });
  };

  const cycleWorldMode = () => {
    const index = worldModes.findIndex((mode) => mode.id === worldMode);
    setWorldMode(worldModes[(index + 1) % worldModes.length].id);
  };

  const cycleWeather = () => {
    const index = weatherModes.findIndex((mode) => mode.id === weather);
    setWeather(weatherModes[(index + 1) % weatherModes.length].id);
  };

  const activeWorldMode = worldModes.find((mode) => mode.id === worldMode) ?? worldModes[0];
  const activeWeather = weatherModes.find((mode) => mode.id === weather) ?? weatherModes[0];

  return (
    <main className={`world-shell mode-${worldMode} weather-${weather} ${playing ? "journey-active" : ""}`}>
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
          <button className="era-pill" onClick={cycleWorldMode} aria-label={`Visual mode: ${activeWorldMode.label}. Change mode`}><span /> {activeWorldMode.label}</button>
          <button className="weather-button" onClick={cycleWeather} aria-label={`Weather: ${activeWeather.label}. Change weather`}><b>{activeWeather.icon}</b><small>{activeWeather.label}</small></button>
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
          if (drag.current.active) {
            setOffset({ x: drag.current.ox + event.clientX - drag.current.x, y: drag.current.oy + event.clientY - drag.current.y });
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setTilt({
            x: ((event.clientY - rect.top) / rect.height - 0.5) * -7,
            y: ((event.clientX - rect.left) / rect.width - 0.5) * 9,
          });
        }}
        onPointerUp={() => { drag.current.active = false; }}
        onPointerLeave={() => { drag.current.active = false; setTilt({ x: 0, y: 0 }); }}
        aria-label="Interactive map of Middle-earth"
      >
        <div className="map-glow" />
        <Suspense fallback={<div className="terrain-scene loading" aria-label="Loading three-dimensional terrain"><div className="terrain-loading"><span /><small>Summoning Middle-earth…</small></div></div>}>
          <TerrainScene
            locations={locations}
            focus={cameraFocus}
            pan={offset}
            zoom={zoom}
            tilt={tilt}
            journeyPath={activeJourney.path}
            journeyColor={activeJourney.color}
            partyLocation={partyLocation}
            playing={playing}
            mode={worldMode}
            weather={weather}
            onSelect={(id) => {
              const location = locations.find((item) => item.id === id);
              if (location) focusLocation(location);
            }}
          />
        </Suspense>

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
        <div className="elevation-readout" aria-hidden="true"><i /><span><small>Terrain depth</small><b>2.4 km</b></span></div>
        {playing && <div className="cinematic-status"><span>Chapter {step + 1}</span><b>{partyLocation.name}</b><small>{chapterNarration[partyLocation.id] ?? activeJourney.subtitle}</small></div>}
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
          <button className={`play-journey ${playing ? "playing" : ""}`} onClick={togglePlay} aria-label={playing ? "Pause journey" : "Begin journey"}>
            <span>{playing ? "Ⅱ" : "▶"}</span>
            <i>{playing ? "Pause journey" : "Begin journey"}</i>
          </button>
        </div>
      </section>
      <div className="grain" aria-hidden="true" />
    </main>
  );
}
