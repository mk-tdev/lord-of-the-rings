"use client";

import { useEffect, useRef, useState } from "react";
import {
  AbstractEngine,
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DirectionalLight,
  DynamicTexture,
  Engine,
  FreeCamera,
  HemisphericLight,
  Mesh,
  MeshBuilder,
  PBRMaterial,
  PointerEventTypes,
  RawTexture,
  Scene,
  ShadowGenerator,
  StandardMaterial,
  Texture,
  TransformNode,
  Vector3,
  VertexData,
  WebGPUEngine,
} from "@babylonjs/core";
import type { QualityMode, TerrainLocation, TerrainSceneProps, WorldMode } from "./terrain-types";

export type { QualityMode, TerrainLocation, WeatherMode, WorldMode } from "./terrain-types";

const WORLD_WIDTH = 14;
const WORLD_DEPTH = 7.88;
const DISPLACEMENT = 1.12;
const DISPLACEMENT_BIAS = -0.2;
const MAP_PIXEL_WIDTH = 1672;
const MAP_PIXEL_HEIGHT = 941;

type RegionDefinition = {
  id: "westlands" | "mountains" | "south" | "mordor";
  path: string;
  locationIds: string[];
  crop: { x: number; y: number; width: number; height: number };
};

const REGIONS: RegionDefinition[] = [
  { id: "westlands", path: "/regions/westlands-detail.png", locationIds: ["shire", "rivendell"], crop: { x: 0, y: 80, width: 1000, height: 562 } },
  { id: "mountains", path: "/regions/mountains-detail.png", locationIds: ["moria", "lothlorien", "fangorn"], crop: { x: 400, y: 120, width: 1000, height: 562 } },
  { id: "south", path: "/regions/south-detail.png", locationIds: ["isengard", "rohan", "gondor"], crop: { x: 500, y: 360, width: 1000, height: 562 } },
  { id: "mordor", path: "/regions/mordor-detail.png", locationIds: ["dead-marshes", "mordor"], crop: { x: 672, y: 0, width: 1000, height: 562 } },
];

type HeightSampler = (x: number, y: number) => number;

function worldPosition(x: number, y: number, height = 0) {
  return new Vector3((x / 100 - 0.5) * WORLD_WIDTH, height, (y / 100 - 0.5) * WORLD_DEPTH);
}

function loadHeightSampler(path: string): Promise<HeightSampler> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = 640;
      const height = Math.round(width * (image.height / image.width));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return reject(new Error("Unable to sample terrain heightmap"));
      context.filter = "blur(3px)";
      context.drawImage(image, -5, -5, width + 10, height + 10);
      const pixels = context.getImageData(0, 0, width, height).data;
      resolve((x, y) => {
        const px = Math.min(width - 1, Math.max(0, Math.round((x / 100) * (width - 1))));
        const py = Math.min(height - 1, Math.max(0, Math.round((y / 100) * (height - 1))));
        return (pixels[(py * width + px) * 4] / 255) * DISPLACEMENT + DISPLACEMENT_BIAS;
      });
    };
    image.onerror = () => reject(new Error(`Unable to load ${path}`));
    image.src = path;
  });
}

function createTerrainMesh(
  scene: Scene,
  name: string,
  sampler: HeightSampler,
  segmentsX: number,
  segmentsY: number,
  bounds = { x: 0, y: 0, width: MAP_PIXEL_WIDTH, height: MAP_PIXEL_HEIGHT },
) {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const startX = (bounds.x / MAP_PIXEL_WIDTH) * 100;
  const startY = (bounds.y / MAP_PIXEL_HEIGHT) * 100;
  const spanX = (bounds.width / MAP_PIXEL_WIDTH) * 100;
  const spanY = (bounds.height / MAP_PIXEL_HEIGHT) * 100;

  for (let row = 0; row <= segmentsY; row += 1) {
    for (let column = 0; column <= segmentsX; column += 1) {
      const u = column / segmentsX;
      const v = row / segmentsY;
      const x = startX + spanX * u;
      const y = startY + spanY * v;
      const point = worldPosition(x, y, sampler(x, y));
      positions.push(point.x, point.y, point.z);
      uvs.push(u, 1 - v);
    }
  }
  for (let row = 0; row < segmentsY; row += 1) {
    for (let column = 0; column < segmentsX; column += 1) {
      const current = row * (segmentsX + 1) + column;
      const next = current + segmentsX + 1;
      indices.push(current, next, current + 1, current + 1, next, next + 1);
    }
  }
  VertexData.ComputeNormals(positions, indices, normals);
  const mesh = new Mesh(name, scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.uvs = uvs;
  data.applyToMesh(mesh, true);
  mesh.receiveShadows = true;
  return mesh;
}

function createDetailNormal(scene: Scene) {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const height = (x: number, y: number) =>
    Math.sin(x * 0.17) * Math.cos(y * 0.13) * 0.42 +
    Math.sin((x + y) * 0.41) * 0.48 +
    Math.cos((x - y) * 0.29) * 0.36 +
    Math.sin(x * 1.71 + y * 1.23) * 0.12;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (height(x - 1, y) - height(x + 1, y)) * 0.72;
      const dz = (height(x, y - 1) - height(x, y + 1)) * 0.72;
      const normal = new Vector3(dx, 1, dz).normalize();
      const offset = (y * size + x) * 4;
      data[offset] = (normal.x * 0.5 + 0.5) * 255;
      data[offset + 1] = (normal.z * 0.5 + 0.5) * 255;
      data[offset + 2] = normal.y * 255;
      data[offset + 3] = 255;
    }
  }
  const texture = RawTexture.CreateRGBATexture(data, size, size, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  texture.wrapU = Texture.WRAP_ADDRESSMODE;
  texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.uScale = 30;
  texture.vScale = 17;
  return texture;
}

function makePbr(scene: Scene, name: string, color: string, metallic = 0, roughness = 0.9) {
  const material = new PBRMaterial(name, scene);
  material.albedoColor = Color3.FromHexString(color);
  material.metallic = metallic;
  material.roughness = roughness;
  return material;
}

function makeLabel(scene: Scene, location: TerrainLocation) {
  const texture = new DynamicTexture(`label-${location.id}`, { width: 512, height: 96 }, scene, true);
  const context = texture.getContext();
  context.clearRect(0, 0, 512, 96);
  context.font = "500 27px Georgia";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,.95)";
  context.shadowBlur = 12;
  context.lineWidth = 7;
  context.strokeStyle = "rgba(9,11,8,.9)";
  context.strokeText(location.name.toUpperCase(), 256, 44);
  context.fillStyle = "#f0e4c8";
  context.fillText(location.name.toUpperCase(), 256, 44);
  texture.hasAlpha = true;
  texture.update();
  const plane = MeshBuilder.CreatePlane(`label-${location.id}`, { width: 1.35, height: 0.25 }, scene);
  const material = new StandardMaterial(`label-mat-${location.id}`, scene);
  material.diffuseTexture = texture;
  material.opacityTexture = texture;
  material.emissiveColor = new Color3(0.78, 0.72, 0.6);
  material.disableLighting = true;
  plane.material = material;
  plane.billboardMode = Mesh.BILLBOARDMODE_ALL;
  plane.isPickable = false;
  return plane;
}

function createMarker(scene: Scene, location: TerrainLocation, sampler: HeightSampler) {
  const root = new TransformNode(`marker-${location.id}`, scene);
  root.position.copyFrom(worldPosition(location.x, location.y, sampler(location.x, location.y) + 0.06));
  const colors = { haven: "#d9bd72", realm: "#9dc7aa", wild: "#b2a781", shadow: "#e45c36" };
  const material = makePbr(scene, `marker-mat-${location.id}`, colors[location.kind], 0.42, 0.36);
  material.emissiveColor = Color3.FromHexString(colors[location.kind]).scale(0.45);
  const ring = MeshBuilder.CreateTorus(`pick-${location.id}`, { diameter: 0.24, thickness: 0.025, tessellation: 28 }, scene);
  ring.material = material;
  ring.parent = root;
  ring.rotation.x = Math.PI / 2;
  ring.metadata = { locationId: location.id };
  const beacon = MeshBuilder.CreateSphere(`beacon-${location.id}`, { diameter: 0.065, segments: 12 }, scene);
  beacon.material = material;
  beacon.parent = root;
  beacon.position.y = 0.06;
  beacon.metadata = { locationId: location.id };
  const label = makeLabel(scene, location);
  label.parent = root;
  label.position.y = 0.31;
  return { root, ring, beacon };
}

function createRoute(scene: Scene, locations: TerrainLocation[], path: string[], color: string, sampler: HeightSampler) {
  const points = path.flatMap((id) => {
    const location = locations.find((item) => item.id === id);
    return location ? [worldPosition(location.x, location.y, sampler(location.x, location.y) + 0.045)] : [];
  });
  if (points.length < 2) return null;
  const route = MeshBuilder.CreateDashedLines("journey-route", { points, dashSize: 0.16, gapSize: 0.09, dashNb: Math.max(24, points.length * 18), updatable: false }, scene);
  route.color = Color3.FromHexString(color);
  route.isPickable = false;
  return route;
}

async function createEngine(canvas: HTMLCanvasElement): Promise<AbstractEngine> {
  if (await WebGPUEngine.IsSupportedAsync) {
    const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await engine.initAsync();
    return engine;
  }
  return new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, powerPreference: "high-performance" }, true);
}

function qualityScale(quality: QualityMode) {
  const ratio = Math.min(window.devicePixelRatio, quality === "performance" ? 1 : quality === "cinematic" ? 2.5 : 1.8);
  return 1 / ratio;
}

function modeColors(mode: WorldMode) {
  if (mode === "moonlit") return { clear: "#07111b", fog: "#101a24", sun: "#9ebcdf", sky: "#819ab8", ground: "#080b10", exposure: 0.78 };
  if (mode === "shadow") return { clear: "#120806", fog: "#1c0b08", sun: "#ff7a45", sky: "#9b4d35", ground: "#100806", exposure: 0.82 };
  if (mode === "parchment") return { clear: "#21180d", fog: "#2a2013", sun: "#e7c68e", sky: "#bd9a68", ground: "#261b10", exposure: 0.96 };
  return { clear: "#080b09", fog: "#11130f", sun: "#ffe5b2", sky: "#ded4b8", ground: "#161a14", exposure: 1.04 };
}

export function BabylonTerrainScene(props: TerrainSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  const [ready, setReady] = useState(false);
  propsRef.current = props;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    let engine: AbstractEngine | null = null;
    const canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.tabIndex = -1;
    host.appendChild(canvas);

    void (async () => {
      const sampler = await loadHeightSampler("/middle-earth-heightmap.png");
      if (cancelled) return;
      engine = await createEngine(canvas);
      if (cancelled) return engine.dispose();
      engine.setHardwareScalingLevel(qualityScale(propsRef.current.quality));

      const scene = new Scene(engine);
      scene.clearColor = Color4.FromHexString("#080b09ff");
      scene.fogMode = Scene.FOGMODE_EXP2;
      scene.fogDensity = 0.034;
      scene.fogColor = Color3.FromHexString("#11130f");
      scene.imageProcessingConfiguration.toneMappingEnabled = true;
      scene.imageProcessingConfiguration.contrast = 1.12;

      const camera = new FreeCamera("atlas-camera", new Vector3(0, 6.8, -8.2), scene);
      camera.fov = 0.68;
      camera.minZ = 0.05;
      camera.maxZ = 80;
      camera.inputs.clear();
      camera.setTarget(Vector3.Zero());
      scene.activeCamera = camera;

      const hemisphere = new HemisphericLight("sky-light", new Vector3(0, 1, 0), scene);
      hemisphere.intensity = 1.45;
      const sun = new DirectionalLight("sun", new Vector3(0.35, -0.8, 0.42), scene);
      sun.position = new Vector3(-5, 9, -6);
      sun.intensity = 3.2;
      const shadowSize = propsRef.current.quality === "performance" ? 1024 : propsRef.current.quality === "cinematic" ? 4096 : 2048;
      const shadows = new ShadowGenerator(shadowSize, sun);
      shadows.usePercentageCloserFiltering = true;
      shadows.bias = 0.0008;

      const segments = propsRef.current.quality === "performance" ? [160, 90] : propsRef.current.quality === "cinematic" ? [420, 236] : [300, 169];
      const terrain = createTerrainMesh(scene, "middle-earth-terrain", sampler, segments[0], segments[1]);
      const terrainMaterial = new PBRMaterial("terrain-material", scene);
      const realisticTexture = new Texture("/middle-earth-map-realistic.png", scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      const parchmentTexture = new Texture("/middle-earth-map.png", scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
      realisticTexture.anisotropicFilteringLevel = 16;
      parchmentTexture.anisotropicFilteringLevel = 16;
      terrainMaterial.albedoTexture = realisticTexture;
      terrainMaterial.bumpTexture = createDetailNormal(scene);
      terrainMaterial.roughness = 0.88;
      terrainMaterial.metallic = 0.02;
      terrain.material = terrainMaterial;

      const markers = new Map<string, ReturnType<typeof createMarker>>();
      for (const location of propsRef.current.locations) markers.set(location.id, createMarker(scene, location, sampler));
      let route = createRoute(scene, propsRef.current.locations, propsRef.current.journeyPath, propsRef.current.journeyColor, sampler);
      let routeKey = `${propsRef.current.journeyPath.join("-")}-${propsRef.current.journeyColor}`;

      const regionalMeshes = new Map<string, Mesh>();
      const ensureRegion = (definition: RegionDefinition) => {
        if (regionalMeshes.has(definition.id)) return regionalMeshes.get(definition.id)!;
        const region = createTerrainMesh(scene, `region-${definition.id}`, sampler, 220, 124, definition.crop);
        region.position.y = 0.008;
        const material = new PBRMaterial(`region-mat-${definition.id}`, scene);
        material.albedoTexture = new Texture(definition.path, scene, false, true, Texture.TRILINEAR_SAMPLINGMODE);
        material.bumpTexture = terrainMaterial.bumpTexture;
        material.roughness = 0.86;
        material.metallic = 0.01;
        material.alpha = 0;
        region.material = material;
        region.isVisible = false;
        region.receiveShadows = true;
        regionalMeshes.set(definition.id, region);
        return region;
      };

      const pipeline = new DefaultRenderingPipeline("cinematic-pipeline", true, scene, [camera]);
      pipeline.fxaaEnabled = true;
      pipeline.samples = propsRef.current.quality === "cinematic" ? 4 : propsRef.current.quality === "high" ? 2 : 1;
      pipeline.bloomEnabled = propsRef.current.quality !== "performance";
      pipeline.bloomThreshold = 0.88;
      pipeline.bloomWeight = 0.18;
      pipeline.bloomKernel = 48;

      scene.onPointerObservable.add((pointerInfo) => {
        if (pointerInfo.type !== PointerEventTypes.POINTERPICK) return;
        const id = pointerInfo.pickInfo?.pickedMesh?.metadata?.locationId;
        if (id) propsRef.current.onSelect(id);
      });

      const resize = () => engine?.resize();
      const observer = new ResizeObserver(resize);
      observer.observe(host);
      resize();
      let lastMode: WorldMode | null = null;
      let lastQuality: QualityMode | null = null;
      let lastTime = performance.now();

      engine.runRenderLoop(() => {
        const current = propsRef.current;
        const now = performance.now();
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;
        const focus = worldPosition(current.focus.x, current.focus.y, sampler(current.focus.x, current.focus.y));
        focus.x -= current.pan.x * 0.008 / current.zoom;
        focus.z -= current.pan.y * 0.006 / current.zoom;
        const distance = 9.7 / Math.pow(current.zoom, 0.84);
        const targetPosition = new Vector3(
          focus.x + current.tilt.y * 0.018,
          1.8 + distance * 0.61 - current.tilt.x * 0.018,
          focus.z - distance,
        );
        camera.position = Vector3.Lerp(camera.position, targetPosition, 1 - Math.exp(-delta * (current.playing ? 2.2 : 6)));
        const target = new Vector3(focus.x, focus.y - 0.06, focus.z + distance * 0.18);
        camera.setTarget(Vector3.Lerp(camera.getTarget(), target, 1 - Math.exp(-delta * 5.5)));

        for (const [id, marker] of markers) {
          const selected = id === current.focusLocationId;
          const pulse = 1 + Math.sin(now * 0.004) * 0.1;
          marker.ring.scaling.setAll(selected ? 1.35 * pulse : 1);
          marker.beacon.position.y = 0.06 + (selected ? Math.sin(now * 0.003) * 0.045 : 0);
        }

        const nextRouteKey = `${current.journeyPath.join("-")}-${current.journeyColor}`;
        if (routeKey !== nextRouteKey) {
          route?.dispose();
          route = createRoute(scene, current.locations, current.journeyPath, current.journeyColor, sampler);
          routeKey = nextRouteKey;
        }

        const activeRegion = REGIONS.find((definition) => definition.locationIds.includes(current.focusLocationId));
        if (current.zoom >= 1.72 && activeRegion) ensureRegion(activeRegion);
        for (const [id, mesh] of regionalMeshes) {
          const material = mesh.material as PBRMaterial;
          const visible = current.zoom >= 1.72 && id === activeRegion?.id;
          mesh.isVisible = visible || material.alpha > 0.01;
          material.alpha += ((visible ? Math.min(1, (current.zoom - 1.65) * 1.35) : 0) - material.alpha) * Math.min(1, delta * 5);
        }

        if (lastQuality !== current.quality) {
          engine?.setHardwareScalingLevel(qualityScale(current.quality));
          pipeline.samples = current.quality === "cinematic" ? 4 : current.quality === "high" ? 2 : 1;
          pipeline.bloomEnabled = current.quality !== "performance";
          lastQuality = current.quality;
        }
        if (lastMode !== current.mode) {
          const colors = modeColors(current.mode);
          scene.clearColor = Color4.FromHexString(`${colors.clear}ff`);
          scene.fogColor = Color3.FromHexString(colors.fog);
          sun.diffuse = Color3.FromHexString(colors.sun);
          hemisphere.diffuse = Color3.FromHexString(colors.sky);
          hemisphere.groundColor = Color3.FromHexString(colors.ground);
          scene.imageProcessingConfiguration.exposure = colors.exposure;
          terrainMaterial.albedoTexture = current.mode === "parchment" ? parchmentTexture : realisticTexture;
          lastMode = current.mode;
        }
        scene.render();
      });
      setReady(true);

      scene.onDisposeObservable.add(() => observer.disconnect());
    })().catch((error) => {
      console.error("Babylon terrain initialization failed", error);
    });

    return () => {
      cancelled = true;
      engine?.stopRenderLoop();
      engine?.dispose();
      if (canvas.parentNode === host) host.removeChild(canvas);
    };
  }, []);

  return (
    <div ref={hostRef} className={`terrain-scene ${ready ? "ready" : "loading"}`} aria-label="Three-dimensional terrain of Middle-earth">
      {!ready && <div className="terrain-loading"><span /><small>Raising the mountains…</small></div>}
    </div>
  );
}
