export type TerrainLocation = {
  id: string;
  name: string;
  x: number;
  y: number;
  kind: "haven" | "realm" | "wild" | "shadow";
};

export type WorldMode = "realms" | "moonlit" | "shadow" | "parchment";
export type WeatherMode = "clear" | "rain" | "snow" | "ash";
export type QualityMode = "performance" | "high" | "cinematic";

export type TerrainSceneProps = {
  locations: TerrainLocation[];
  focus: { x: number; y: number };
  pan: { x: number; y: number };
  zoom: number;
  tilt: { x: number; y: number };
  journeyPath: string[];
  journeyColor: string;
  partyLocation: TerrainLocation;
  playing: boolean;
  mode: WorldMode;
  weather: WeatherMode;
  quality: QualityMode;
  focusLocationId: string;
  onSelect: (id: string) => void;
};
