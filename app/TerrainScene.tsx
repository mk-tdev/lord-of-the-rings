"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

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

type TerrainSceneProps = {
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

const WORLD_WIDTH = 14;
const WORLD_HEIGHT = 7.88;
const DISPLACEMENT = 1.12;
const DISPLACEMENT_BIAS = -0.2;

type RegionDefinition = {
  id: "westlands" | "mountains" | "south" | "mordor";
  path: string;
  locationIds: string[];
  crop: { x: number; y: number; width: number; height: number };
};

const MAP_PIXEL_WIDTH = 1672;
const MAP_PIXEL_HEIGHT = 941;
const REGIONS: RegionDefinition[] = [
  { id: "westlands", path: "/regions/westlands-detail.png", locationIds: ["shire", "rivendell"], crop: { x: 0, y: 80, width: 1000, height: 562 } },
  { id: "mountains", path: "/regions/mountains-detail.png", locationIds: ["moria", "lothlorien", "fangorn"], crop: { x: 400, y: 120, width: 1000, height: 562 } },
  { id: "south", path: "/regions/south-detail.png", locationIds: ["isengard", "rohan", "gondor"], crop: { x: 500, y: 360, width: 1000, height: 562 } },
  { id: "mordor", path: "/regions/mordor-detail.png", locationIds: ["dead-marshes", "mordor"], crop: { x: 672, y: 0, width: 1000, height: 562 } },
];

function worldPosition(x: number, y: number) {
  return new THREE.Vector3((x / 100 - 0.5) * WORLD_WIDTH, (0.5 - y / 100) * WORLD_HEIGHT, 0);
}

function makeLabelTexture(text: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = "500 27px Georgia";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.shadowColor = "rgba(0,0,0,.95)";
  context.shadowBlur = 12;
  context.lineWidth = 7;
  context.strokeStyle = "rgba(9,11,8,.88)";
  context.strokeText(text.toUpperCase(), 256, 44);
  context.fillStyle = "#f0e4c8";
  context.fillText(text.toUpperCase(), 256, 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function makeMistTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(128, 64, 4, 128, 64, 118);
  gradient.addColorStop(0, "rgba(228,226,211,.5)");
  gradient.addColorStop(0.45, "rgba(205,207,194,.18)");
  gradient.addColorStop(1, "rgba(205,207,194,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 256, 128);
  return new THREE.CanvasTexture(canvas);
}

function makeDetailNormalTexture() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(size, size);
  const heightAt = (x: number, y: number) => {
    const coarse = Math.sin(x * 0.17) * Math.cos(y * 0.13);
    const medium = Math.sin((x + y) * 0.41) * 0.48 + Math.cos((x - y) * 0.29) * 0.36;
    const fine = Math.sin(x * 1.71 + y * 1.23) * 0.12 + Math.cos(x * 2.31 - y * 1.61) * 0.08;
    return coarse * 0.42 + medium + fine;
  };
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const left = heightAt((x - 1 + size) % size, y);
      const right = heightAt((x + 1) % size, y);
      const down = heightAt(x, (y - 1 + size) % size);
      const up = heightAt(x, (y + 1) % size);
      const normal = new THREE.Vector3((left - right) * 0.72, (down - up) * 0.72, 1).normalize();
      const offset = (y * size + x) * 4;
      image.data[offset] = (normal.x * 0.5 + 0.5) * 255;
      image.data[offset + 1] = (normal.y * 0.5 + 0.5) * 255;
      image.data[offset + 2] = normal.z * 255;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(30, 17);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return texture;
}

type TravelerRole = "ranger" | "wizard" | "hobbit" | "scout";

function makeLimb(material: THREE.Material, length: number, radius: number) {
  const pivot = new THREE.Group();
  const limb = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.82, radius, length, 8), material);
  limb.rotation.x = Math.PI / 2;
  limb.position.z = -length / 2;
  limb.castShadow = true;
  pivot.add(limb);
  return pivot;
}

function makeTraveler(role: TravelerRole, scale: number) {
  const group = new THREE.Group();
  group.scale.setScalar(scale);
  const palettes = {
    ranger: { cloth: 0x263b2e, cloak: 0x18271f, leather: 0x4b3524, hair: 0x271d16, skin: 0x9a7455 },
    wizard: { cloth: 0x73766d, cloak: 0x555b55, leather: 0x574631, hair: 0xb8b3a5, skin: 0xa98566 },
    hobbit: { cloth: 0x69432a, cloak: 0x31513b, leather: 0x5b3821, hair: 0x4b2b18, skin: 0xa87d59 },
    scout: { cloth: 0x4b5c35, cloak: 0x35452e, leather: 0x6a4328, hair: 0x382416, skin: 0xa77b58 },
  }[role];
  const cloth = new THREE.MeshStandardMaterial({ color: palettes.cloth, roughness: 0.98 });
  const cloakMaterial = new THREE.MeshStandardMaterial({ color: palettes.cloak, roughness: 1, side: THREE.DoubleSide });
  const leather = new THREE.MeshStandardMaterial({ color: palettes.leather, roughness: 0.88 });
  const skin = new THREE.MeshStandardMaterial({ color: palettes.skin, roughness: 0.94 });
  const hair = new THREE.MeshStandardMaterial({ color: palettes.hair, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x171712, roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xb7b3a1, roughness: 0.34, metalness: 0.76 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.15, 0.43, 10), cloth);
  body.position.z = 0.5;
  body.rotation.x = Math.PI / 2;
  body.castShadow = true;
  group.add(body);

  const shoulders = new THREE.Mesh(new THREE.SphereGeometry(0.15, 10, 7), cloth);
  shoulders.scale.set(1.15, 0.72, 0.66);
  shoulders.position.z = 0.7;
  shoulders.castShadow = true;
  group.add(shoulders);

  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.122, 0.018, 6, 16), leather);
  belt.position.z = 0.38;
  group.add(belt);

  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.58, 9, 1, true), cloakMaterial);
  cloak.rotation.x = Math.PI / 2;
  cloak.position.set(0, 0.055, 0.49);
  cloak.castShadow = true;
  group.add(cloak);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 12, 9), skin);
  head.scale.set(0.92, 0.88, 1.08);
  head.position.z = 0.87;
  head.castShadow = true;
  group.add(head);

  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.026, 7, 5), skin);
  nose.scale.set(0.75, 1.2, 0.8);
  nose.position.set(0, -0.1, 0.865);
  group.add(nose);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.011, 6, 4), dark);
    eye.position.set(side * 0.039, -0.09, 0.9);
    group.add(eye);
  }

  const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.112, 10, 7, 0, Math.PI * 2, 0, Math.PI * 0.58), hair);
  hairCap.rotation.x = Math.PI;
  hairCap.position.z = 0.955;
  group.add(hairCap);

  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = makeLimb(role === "wizard" ? cloth : leather, 0.34, 0.036);
    arm.position.set(side * 0.145, -0.005, 0.69);
    arms.push(arm);
    group.add(arm);
  }

  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = makeLimb(dark, role === "hobbit" || role === "scout" ? 0.27 : 0.34, 0.043);
    leg.position.set(side * 0.065, 0, 0.35);
    legs.push(leg);
    group.add(leg);
    const boot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 5), role === "hobbit" || role === "scout" ? skin : leather);
    boot.scale.set(0.9, 1.45, 0.62);
    boot.position.set(side * 0.065, -0.038, role === "hobbit" || role === "scout" ? 0.07 : 0.015);
    group.add(boot);
  }

  if (role === "ranger") {
    const sword = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.66, 7), metal);
    sword.rotation.set(Math.PI / 2, 0, -0.38);
    sword.position.set(0.14, 0.09, 0.57);
    group.add(sword);
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.04, 0.46, 8), leather);
    quiver.rotation.x = Math.PI / 2;
    quiver.position.set(-0.12, 0.12, 0.61);
    group.add(quiver);
  }

  if (role === "wizard") {
    const hat = new THREE.Mesh(new THREE.ConeGeometry(0.145, 0.38, 12), cloakMaterial);
    hat.rotation.x = Math.PI / 2;
    hat.position.z = 1.12;
    group.add(hat);
    const beard = new THREE.Mesh(new THREE.ConeGeometry(0.075, 0.31, 10), hair);
    beard.rotation.x = Math.PI / 2;
    beard.position.set(0, -0.08, 0.75);
    group.add(beard);
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 1.2, 8), leather);
    staff.rotation.x = Math.PI / 2;
    staff.position.set(-0.25, -0.03, 0.56);
    group.add(staff);
    const staffLight = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05, 1), new THREE.MeshBasicMaterial({ color: 0xe9d79c, toneMapped: false }));
    staffLight.position.set(-0.25, -0.03, 1.17);
    group.add(staffLight);
  }

  if (role === "hobbit" || role === "scout") {
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.11, 0.27), leather);
    pack.position.set(0, 0.13, 0.52);
    pack.castShadow = true;
    group.add(pack);
    for (let index = 0; index < 7; index += 1) {
      const curl = new THREE.Mesh(new THREE.SphereGeometry(0.039, 6, 5), hair);
      const angle = (index / 7) * Math.PI * 2;
      curl.position.set(Math.cos(angle) * 0.085, Math.sin(angle) * 0.07, 0.96 + (index % 2) * 0.025);
      group.add(curl);
    }
  }

  group.userData.limbs = { legs, arms };
  return group;
}

function makeLandmark(location: TerrainLocation) {
  const group = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xc8c0aa, roughness: 0.82 });
  const whiteStone = new THREE.MeshStandardMaterial({ color: 0xe0ded0, roughness: 0.68 });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x20231f, roughness: 0.86 });
  const timber = new THREE.MeshStandardMaterial({ color: 0x5a3e26, roughness: 1 });
  const green = new THREE.MeshStandardMaterial({ color: 0x31583a, roughness: 1 });
  const gold = new THREE.MeshStandardMaterial({ color: 0xb28a3d, roughness: 0.76 });
  const lava = new THREE.MeshBasicMaterial({ color: 0xff5a20, toneMapped: false });

  const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    return mesh;
  };
  const tower = (x: number, y: number, height: number, radius: number, material = stone) => {
    const mesh = add(new THREE.CylinderGeometry(radius * 0.86, radius, height, 10), material, x, y, height / 2);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };
  const spire = (x: number, y: number, z: number, radius: number, height: number, material = stone) => {
    const mesh = add(new THREE.ConeGeometry(radius, height, 10), material, x, y, z + height / 2);
    mesh.rotation.x = Math.PI / 2;
    return mesh;
  };

  switch (location.id) {
    case "shire": {
      for (const [x, y, size] of [[-0.16, 0, 0.11], [0.02, 0.08, 0.13], [0.18, -0.04, 0.09]] as number[][]) {
        const hill = add(new THREE.SphereGeometry(size, 12, 7), green, x, y, size * 0.55);
        hill.scale.z = 0.55;
        add(new THREE.CircleGeometry(size * 0.38, 12), timber, x, y - size * 0.84, size * 0.45).rotation.x = Math.PI / 2;
      }
      tower(-0.02, 0.16, 0.28, 0.025, timber);
      const crown = add(new THREE.SphereGeometry(0.14, 10, 7), green, -0.02, 0.16, 0.32);
      crown.scale.set(1, 0.78, 0.9);
      break;
    }
    case "rivendell":
      tower(-0.12, 0.02, 0.38, 0.065, whiteStone);
      tower(0.04, 0.04, 0.56, 0.07, whiteStone);
      tower(0.18, 0, 0.31, 0.055, whiteStone);
      spire(-0.12, 0.02, 0.38, 0.085, 0.16, gold);
      spire(0.04, 0.04, 0.56, 0.09, 0.19, gold);
      spire(0.18, 0, 0.31, 0.075, 0.14, gold);
      break;
    case "moria": {
      const gate = add(new THREE.TorusGeometry(0.19, 0.035, 8, 24, Math.PI), stone, 0, 0, 0.16);
      gate.rotation.x = Math.PI / 2;
      add(new THREE.BoxGeometry(0.08, 0.08, 0.24), darkStone, -0.19, 0, 0.12);
      add(new THREE.BoxGeometry(0.08, 0.08, 0.24), darkStone, 0.19, 0, 0.12);
      break;
    }
    case "lothlorien":
    case "fangorn":
      for (let index = 0; index < 7; index += 1) {
        const angle = (index / 7) * Math.PI * 2;
        const radius = index === 0 ? 0 : 0.15;
        tower(Math.cos(angle) * radius, Math.sin(angle) * radius, 0.3 + (index % 3) * 0.08, 0.025, timber);
        const crown = add(new THREE.SphereGeometry(0.09 + (index % 2) * 0.025, 8, 6), location.id === "lothlorien" ? gold : green, Math.cos(angle) * radius, Math.sin(angle) * radius, 0.35 + (index % 3) * 0.08);
        crown.scale.z = 1.35;
      }
      break;
    case "rohan":
      add(new THREE.BoxGeometry(0.38, 0.2, 0.18), timber, 0, 0, 0.09);
      add(new THREE.ConeGeometry(0.25, 0.22, 4), gold, 0, 0, 0.27).rotation.set(Math.PI / 2, 0, Math.PI / 4);
      tower(0, -0.12, 0.22, 0.018, gold);
      break;
    case "isengard":
      tower(0, 0, 0.68, 0.09, darkStone);
      for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
        spire(Math.cos(angle) * 0.08, Math.sin(angle) * 0.08, 0.58, 0.065, 0.28, darkStone);
      }
      break;
    case "gondor":
      for (let level = 0; level < 4; level += 1) {
        add(new THREE.CylinderGeometry(0.26 - level * 0.045, 0.29 - level * 0.045, 0.09, 14), whiteStone, 0, 0, 0.045 + level * 0.085).rotation.x = Math.PI / 2;
      }
      tower(0.03, 0, 0.62, 0.047, whiteStone);
      spire(0.03, 0, 0.62, 0.065, 0.16, gold);
      break;
    case "dead-marshes":
      for (let index = 0; index < 5; index += 1) {
        const pool = add(new THREE.CircleGeometry(0.08 + index * 0.012, 14), new THREE.MeshBasicMaterial({ color: 0x769b89, transparent: true, opacity: 0.46 }), (index - 2) * 0.1, (index % 2) * 0.11, 0.012);
        pool.rotation.x = 0;
        const light = add(new THREE.SphereGeometry(0.016, 7, 5), new THREE.MeshBasicMaterial({ color: 0xb4e2bd, toneMapped: false }), (index - 2) * 0.1, (index % 2) * 0.11, 0.08 + index * 0.015);
        light.userData.ghostLight = true;
      }
      break;
    case "mordor": {
      const volcano = add(new THREE.ConeGeometry(0.28, 0.72, 18), darkStone, 0, 0, 0.36);
      volcano.rotation.x = Math.PI / 2;
      const crater = add(new THREE.TorusGeometry(0.105, 0.026, 8, 18), lava, 0, 0, 0.73);
      crater.scale.y = 0.68;
      add(new THREE.SphereGeometry(0.055, 10, 7), lava, 0, 0, 0.72);
      break;
    }
  }

  group.scale.setScalar(0.82);
  group.userData.location = location;
  return group;
}

export function TerrainScene(props: TerrainSceneProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const propsRef = useRef(props);
  const rebuildRouteRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  propsRef.current = props;

  useEffect(() => {
    rebuildRouteRef.current?.();
  }, [props.journeyColor, props.journeyPath]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d0a);
    scene.fog = new THREE.FogExp2(0x11130f, 0.036);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
    camera.position.set(0, -5, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    const pixelRatioFor = (quality: QualityMode) => Math.min(window.devicePixelRatio, quality === "performance" ? 1 : quality === "cinematic" ? 2.75 : window.innerWidth < 800 ? 1.75 : 2.1);
    renderer.setPixelRatio(pixelRatioFor(props.quality));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    host.appendChild(renderer.domElement);

    const hemisphere = new THREE.HemisphereLight(0xded4b8, 0x161a14, 1.55);
    scene.add(hemisphere);
    const sun = new THREE.DirectionalLight(0xffe5b2, 3.1);
    sun.position.set(-5, -6, 11);
    sun.castShadow = true;
    const shadowResolution = props.quality === "performance" ? 1024 : props.quality === "cinematic" ? 4096 : 2048;
    sun.shadow.mapSize.set(shadowResolution, shadowResolution);
    sun.shadow.camera.left = -9;
    sun.shadow.camera.right = 9;
    sun.shadow.camera.top = 7;
    sun.shadow.camera.bottom = -7;
    scene.add(sun);
    const mordorGlow = new THREE.PointLight(0xff4a1e, 7, 6, 2);
    mordorGlow.position.set(5.1, 1.3, 2.2);
    scene.add(mordorGlow);

    const loader = new THREE.TextureLoader();
    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    const mapTexture = loader.load("/middle-earth-map-realistic.png");
    mapTexture.colorSpace = THREE.SRGBColorSpace;
    mapTexture.anisotropy = maxAnisotropy;
    const parchmentTexture = loader.load("/middle-earth-map.png");
    parchmentTexture.colorSpace = THREE.SRGBColorSpace;
    parchmentTexture.anisotropy = maxAnisotropy;
    const heightTexture = loader.load("/middle-earth-heightmap.png", (texture) => {
      const image = texture.image as HTMLImageElement;
      const canvas = document.createElement("canvas");
      const sampleWidth = 640;
      const sampleHeight = Math.round(sampleWidth * (image.height / image.width));
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.filter = "blur(4px)";
        context.drawImage(image, -6, -6, sampleWidth + 12, sampleHeight + 12);
        texture.image = canvas;
        texture.minFilter = THREE.LinearFilter;
        texture.magFilter = THREE.LinearFilter;
        texture.needsUpdate = true;
      }
      const pixels = context?.getImageData(0, 0, sampleWidth, sampleHeight).data;
      if (pixels) {
        sampleHeightRef.current = (x, y) => {
          const px = Math.min(sampleWidth - 1, Math.max(0, Math.round((x / 100) * (sampleWidth - 1))));
          const py = Math.min(sampleHeight - 1, Math.max(0, Math.round((y / 100) * (sampleHeight - 1))));
          return (pixels[(py * sampleWidth + px) * 4] / 255) * DISPLACEMENT + DISPLACEMENT_BIAS;
        };
        updateElevations();
        rebuildRoute();
      }
      setReady(true);
    });

    const detailNormalTexture = makeDetailNormalTexture();
    if (detailNormalTexture) detailNormalTexture.anisotropy = maxAnisotropy;
    const terrainGeometry = new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT, 224, 126);
    const terrainGeometryHigh = new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT, 448, 252);
    const terrainMaterial = new THREE.MeshStandardMaterial({
      map: mapTexture,
      displacementMap: heightTexture,
      displacementScale: DISPLACEMENT,
      displacementBias: DISPLACEMENT_BIAS,
      normalMap: detailNormalTexture,
      normalScale: new THREE.Vector2(0.58, 0.58),
      roughness: 0.88,
      metalness: 0.02,
    });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.receiveShadow = true;
    scene.add(terrain);
    const terrainHigh = new THREE.Mesh(terrainGeometryHigh, terrainMaterial);
    terrainHigh.receiveShadow = true;
    terrainHigh.visible = false;
    scene.add(terrainHigh);

    type RegionalMesh = {
      mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
      colorTexture: THREE.Texture;
      displacementTexture: THREE.Texture;
      normalTexture: THREE.Texture | null;
    };
    const regionalMeshes = new Map<RegionDefinition["id"], RegionalMesh>();
    const pendingRegions = new Set<RegionDefinition["id"]>();
    const ensureRegion = (region: RegionDefinition) => {
      if (regionalMeshes.has(region.id) || pendingRegions.has(region.id)) return;
      pendingRegions.add(region.id);
      loader.load(region.path, (colorTexture) => {
        colorTexture.colorSpace = THREE.SRGBColorSpace;
        colorTexture.anisotropy = maxAnisotropy;
        const x = region.crop.x / MAP_PIXEL_WIDTH;
        const y = region.crop.y / MAP_PIXEL_HEIGHT;
        const width = region.crop.width / MAP_PIXEL_WIDTH;
        const height = region.crop.height / MAP_PIXEL_HEIGHT;
        const displacementTexture = heightTexture.clone();
        displacementTexture.image = heightTexture.image;
        displacementTexture.wrapS = THREE.ClampToEdgeWrapping;
        displacementTexture.wrapT = THREE.ClampToEdgeWrapping;
        displacementTexture.repeat.set(width, height);
        displacementTexture.offset.set(x, 1 - y - height);
        displacementTexture.needsUpdate = true;
        const normalTexture = detailNormalTexture?.clone() ?? null;
        if (normalTexture) {
          normalTexture.repeat.set(18, 10);
          normalTexture.needsUpdate = true;
        }
        const geometry = new THREE.PlaneGeometry(WORLD_WIDTH * width, WORLD_HEIGHT * height, 256, 144);
        const material = new THREE.MeshStandardMaterial({
          map: colorTexture,
          displacementMap: displacementTexture,
          displacementScale: DISPLACEMENT,
          displacementBias: DISPLACEMENT_BIAS,
          normalMap: normalTexture,
          normalScale: new THREE.Vector2(1.08, 1.08),
          roughness: 0.82,
          metalness: 0.025,
          transparent: true,
          opacity: 0,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -1,
        });
        const mesh = new THREE.Mesh(geometry, material);
        const center = worldPosition((x + width / 2) * 100, (y + height / 2) * 100);
        mesh.position.set(center.x, center.y, 0.012);
        mesh.receiveShadow = true;
        mesh.visible = false;
        mesh.renderOrder = 2;
        scene.add(mesh);
        regionalMeshes.set(region.id, { mesh, colorTexture, displacementTexture, normalTexture });
        pendingRegions.delete(region.id);
      });
    };

    const waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x173b43,
      transparent: true,
      opacity: 0.44,
      roughness: 0.22,
      metalness: 0.08,
      clearcoat: 0.72,
      clearcoatRoughness: 0.2,
      depthWrite: false,
    });
    const water = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_WIDTH + 0.02, WORLD_HEIGHT + 0.02), waterMaterial);
    water.position.z = -0.185;
    scene.add(water);

    const underlay = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH + 0.3, WORLD_HEIGHT + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x231e14, roughness: 1 }),
    );
    underlay.position.z = -0.27;
    scene.add(underlay);

    const sampleHeightRef: { current: (x: number, y: number) => number } = { current: () => 0.15 };
    const markerGroups: THREE.Group[] = [];
    const landmarkGroups: THREE.Group[] = [];
    const markerHits: THREE.Object3D[] = [];
    const gold = new THREE.MeshBasicMaterial({ color: 0xe4bd67, toneMapped: false });
    const ember = new THREE.MeshBasicMaterial({ color: 0xe56a42, toneMapped: false });
    const pale = new THREE.MeshBasicMaterial({ color: 0xbdd5c6, toneMapped: false });

    for (const location of props.locations) {
      const group = new THREE.Group();
      const position = worldPosition(location.x, location.y);
      group.position.copy(position);
      group.userData.location = location;
      const material = location.kind === "shadow" ? ember : location.kind === "realm" ? pale : gold;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.018, 8, 20), material);
      ring.userData.locationId = location.id;
      ring.rotation.x = 0;
      group.add(ring);
      markerHits.push(ring);
      const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.055, 0), material);
      core.userData.locationId = location.id;
      core.position.z = 0.02;
      group.add(core);
      markerHits.push(core);
      const labelTexture = makeLabelTexture(location.name);
      if (labelTexture) {
        const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture, transparent: true, depthTest: false }));
        label.position.set(0.42, 0.08, 0.16);
        label.scale.set(1.35, 0.25, 1);
        group.add(label);
      }
      markerGroups.push(group);
      scene.add(group);

      const landmark = makeLandmark(location);
      landmark.position.copy(position);
      landmark.position.x -= 0.18;
      landmark.position.y += 0.12;
      landmarkGroups.push(landmark);
      scene.add(landmark);
    }

    let forestSeed = 7391;
    const forestRandom = () => {
      forestSeed = (forestSeed * 16807) % 2147483647;
      return (forestSeed - 1) / 2147483646;
    };
    const forestClusters = [
      { x: 24, y: 27, rx: 11, ry: 10, count: 90 },
      { x: 27, y: 49, rx: 9, ry: 17, count: 105 },
      { x: 40, y: 18, rx: 9, ry: 9, count: 72 },
      { x: 48, y: 43, rx: 6, ry: 7, count: 68 },
      { x: 52, y: 55, rx: 7, ry: 10, count: 84 },
    ];
    const forestPoints = forestClusters.flatMap((cluster) => Array.from({ length: cluster.count }, () => {
      const angle = forestRandom() * Math.PI * 2;
      const radius = Math.sqrt(forestRandom());
      return {
        x: cluster.x + Math.cos(angle) * cluster.rx * radius,
        y: cluster.y + Math.sin(angle) * cluster.ry * radius,
        scale: 0.65 + forestRandom() * 0.75,
        rotation: forestRandom() * Math.PI * 2,
      };
    }));
    const forestGeometry = new THREE.ConeGeometry(0.035, 0.2, 7);
    forestGeometry.rotateX(Math.PI / 2);
    forestGeometry.translate(0, 0, 0.1);
    const forest = new THREE.InstancedMesh(forestGeometry, new THREE.MeshStandardMaterial({ color: 0x24462e, roughness: 1 }), forestPoints.length);
    forest.castShadow = true;
    forest.receiveShadow = true;
    scene.add(forest);
    const forestMatrix = new THREE.Matrix4();
    const forestQuaternion = new THREE.Quaternion();
    const forestScale = new THREE.Vector3();
    function updateForest() {
      forestPoints.forEach((point, index) => {
        const position = worldPosition(point.x, point.y);
        position.z = sampleHeightRef.current(point.x, point.y) + 0.02;
        forestQuaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), point.rotation);
        forestScale.setScalar(point.scale);
        forestMatrix.compose(position, forestQuaternion, forestScale);
        forest.setMatrixAt(index, forestMatrix);
      });
      forest.instanceMatrix.needsUpdate = true;
    }
    updateForest();

    const party = new THREE.Group();
    const travelerSpecs: Array<[TravelerRole, number, number, number]> = [
      ["ranger", 1.04, -0.28, 0.02],
      ["wizard", 1.08, 0, 0.06],
      ["hobbit", 0.8, 0.25, -0.04],
      ["scout", 0.78, 0.45, 0.08],
    ];
    const travelers: THREE.Group[] = [];
    for (const [role, scale, x, y] of travelerSpecs) {
      const traveler = makeTraveler(role, scale);
      traveler.position.set(x, y, 0);
      travelers.push(traveler);
      party.add(traveler);
    }
    const torch = new THREE.PointLight(0xff9b3d, 6, 1.8, 2);
    torch.position.set(0.48, 0.05, 0.75);
    party.add(torch);
    const partyStart = worldPosition(props.partyLocation.x, props.partyLocation.y);
    party.position.set(partyStart.x, partyStart.y, 0.2);
    party.scale.setScalar(0.7);
    party.rotation.x = 0;
    scene.add(party);

    const mistTexture = makeMistTexture();
    const mistSprites: THREE.Sprite[] = [];
    const smokeSprites: THREE.Sprite[] = [];
    if (mistTexture) {
      for (let index = 0; index < 18; index += 1) {
        const material = new THREE.SpriteMaterial({ map: mistTexture, transparent: true, opacity: 0.11 + Math.random() * 0.12, depthWrite: false });
        const sprite = new THREE.Sprite(material);
        sprite.position.set(-6 + Math.random() * 12, -3 + Math.random() * 6, 1.3 + Math.random() * 0.9);
        sprite.scale.set(2.2 + Math.random() * 2.8, 0.55 + Math.random() * 0.8, 1);
        sprite.userData.speed = 0.025 + Math.random() * 0.04;
        mistSprites.push(sprite);
        scene.add(sprite);
      }
      const smokeSources = [
        { x: 48, y: 61, count: 5, tint: 0x6d6b61 },
        { x: 87, y: 34, count: 9, tint: 0x6a4032 },
        { x: 58, y: 61, count: 3, tint: 0x8b806c },
      ];
      smokeSources.forEach((source) => {
        const sourcePosition = worldPosition(source.x, source.y);
        for (let index = 0; index < source.count; index += 1) {
          const material = new THREE.SpriteMaterial({ map: mistTexture, color: source.tint, transparent: true, opacity: 0.13, depthWrite: false });
          const smoke = new THREE.Sprite(material);
          smoke.position.set(sourcePosition.x + (Math.random() - 0.5) * 0.18, sourcePosition.y + (Math.random() - 0.5) * 0.12, 0.8 + index * 0.12);
          smoke.scale.set(0.38 + index * 0.06, 0.22 + index * 0.035, 1);
          smoke.userData.baseZ = smoke.position.z;
          smoke.userData.speed = 0.045 + Math.random() * 0.035;
          smoke.userData.phase = Math.random() * Math.PI * 2;
          smokeSprites.push(smoke);
          scene.add(smoke);
        }
      });
    }

    const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x151914, side: THREE.DoubleSide, transparent: true, opacity: 0.78 });
    const birdFlock: THREE.Group[] = [];
    for (let index = 0; index < 11; index += 1) {
      const bird = new THREE.Group();
      const wings: THREE.Mesh[] = [];
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.035), birdMaterial);
        wing.position.x = side * 0.048;
        wing.rotation.z = side * 0.18;
        wings.push(wing);
        bird.add(wing);
      }
      bird.position.set(-6.5 + index * 0.45, 2.4 + (index % 4) * 0.22, 2.7 + (index % 3) * 0.15);
      bird.userData.wings = wings;
      bird.userData.speed = 0.12 + (index % 4) * 0.018;
      bird.userData.phase = index * 0.7;
      birdFlock.push(bird);
      scene.add(bird);
    }

    const emberCount = 90;
    const emberPositions = new Float32Array(emberCount * 3);
    for (let index = 0; index < emberCount; index += 1) {
      emberPositions[index * 3] = 4.2 + Math.random() * 2.1;
      emberPositions[index * 3 + 1] = 0.1 + Math.random() * 2.6;
      emberPositions[index * 3 + 2] = 0.5 + Math.random() * 2.8;
    }
    const emberGeometry = new THREE.BufferGeometry();
    emberGeometry.setAttribute("position", new THREE.BufferAttribute(emberPositions, 3));
    const embers = new THREE.Points(emberGeometry, new THREE.PointsMaterial({ color: 0xff6a2a, size: 0.045, transparent: true, opacity: 0.86, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(embers);

    const weatherCount = 620;
    const weatherPositions = new Float32Array(weatherCount * 3);
    for (let index = 0; index < weatherCount; index += 1) {
      weatherPositions[index * 3] = -8 + Math.random() * 16;
      weatherPositions[index * 3 + 1] = -5 + Math.random() * 10;
      weatherPositions[index * 3 + 2] = 0.5 + Math.random() * 8;
    }
    const weatherGeometry = new THREE.BufferGeometry();
    weatherGeometry.setAttribute("position", new THREE.BufferAttribute(weatherPositions, 3));
    const weatherMaterial = new THREE.PointsMaterial({ color: 0xcbd7d4, size: 0.026, transparent: true, opacity: 0.58, depthWrite: false });
    const weatherField = new THREE.Points(weatherGeometry, weatherMaterial);
    weatherField.visible = false;
    scene.add(weatherField);

    let route: THREE.Line | null = null;
    function rebuildRoute() {
      if (route) {
        scene.remove(route);
        route.geometry.dispose();
        (route.material as THREE.Material).dispose();
      }
      const current = propsRef.current;
      const points = current.journeyPath
        .map((id) => current.locations.find((location) => location.id === id))
        .filter(Boolean)
        .map((location) => {
          const item = location as TerrainLocation;
          const point = worldPosition(item.x, item.y);
          point.z = sampleHeightRef.current(item.x, item.y) + 0.16;
          return point;
        });
      if (points.length < 2) return;
      const curve = new THREE.CatmullRomCurve3(points);
      const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(180));
      const material = new THREE.LineDashedMaterial({ color: current.journeyColor, dashSize: 0.11, gapSize: 0.07, transparent: true, opacity: 0.95, toneMapped: false });
      route = new THREE.Line(geometry, material);
      route.computeLineDistances();
      scene.add(route);
    }
    rebuildRouteRef.current = rebuildRoute;

    function updateElevations() {
      markerGroups.forEach((group) => {
        const location = group.userData.location as TerrainLocation;
        group.position.z = sampleHeightRef.current(location.x, location.y) + 0.13;
      });
      landmarkGroups.forEach((group) => {
        const location = group.userData.location as TerrainLocation;
        group.position.z = sampleHeightRef.current(location.x, location.y) + 0.04;
      });
      updateForest();
    }

    rebuildRoute();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDown = { x: 0, y: 0 };
    const onPointerDown = (event: PointerEvent) => { pointerDown = { x: event.clientX, y: event.clientY }; };
    const onPointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y) > 7) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(markerHits, false)[0];
      const id = hit?.object.userData.locationId as string | undefined;
      if (id) propsRef.current.onSelect(id);
    };
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointerup", onPointerUp);

    const resize = () => {
      const { clientWidth, clientHeight } = host;
      renderer.setSize(clientWidth, clientHeight, false);
      camera.aspect = clientWidth / Math.max(1, clientHeight);
      camera.updateProjectionMatrix();
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
    resize();

    let previousTime = performance.now();
    let elapsed = 0;
    let activeVisualMode: WorldMode | null = null;
    let activeWeather: WeatherMode | null = null;
    let activeQuality: QualityMode | null = null;
    let animationFrame = 0;
    const target = new THREE.Vector3();
    const desiredCamera = new THREE.Vector3();
    const animate = () => {
      const now = performance.now();
      const delta = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      if (document.hidden) {
        animationFrame = window.requestAnimationFrame(animate);
        return;
      }
      elapsed += delta;
      const current = propsRef.current;
      if (current.quality !== activeQuality) {
        activeQuality = current.quality;
        renderer.setPixelRatio(pixelRatioFor(current.quality));
        const nextShadowResolution = current.quality === "performance" ? 1024 : current.quality === "cinematic" ? 4096 : 2048;
        if (sun.shadow.mapSize.width !== nextShadowResolution) {
          sun.shadow.mapSize.set(nextShadowResolution, nextShadowResolution);
          sun.shadow.map?.dispose();
          sun.shadow.map = null;
        }
        resize();
      }
      if (current.mode !== activeVisualMode) {
        activeVisualMode = current.mode;
        terrainMaterial.map = current.mode === "parchment" ? parchmentTexture : mapTexture;
        terrainMaterial.color.set(current.mode === "shadow" ? 0x9a8878 : current.mode === "moonlit" ? 0x8da1ae : 0xffffff);
        terrainMaterial.needsUpdate = true;
        renderer.toneMappingExposure = current.mode === "moonlit" ? 0.66 : current.mode === "shadow" ? 0.78 : 1.04;
        hemisphere.intensity = current.mode === "moonlit" ? 0.72 : current.mode === "shadow" ? 0.9 : 1.55;
        hemisphere.color.set(current.mode === "moonlit" ? 0x7b9bc1 : current.mode === "shadow" ? 0xb06c51 : 0xded4b8);
        sun.intensity = current.mode === "moonlit" ? 1.25 : current.mode === "shadow" ? 1.65 : 3.1;
        sun.color.set(current.mode === "moonlit" ? 0x8db7e8 : current.mode === "shadow" ? 0xd47754 : 0xffe5b2);
        scene.background = new THREE.Color(current.mode === "moonlit" ? 0x050b14 : current.mode === "shadow" ? 0x150806 : 0x0b0d0a);
        scene.fog = new THREE.FogExp2(current.mode === "moonlit" ? 0x07111c : current.mode === "shadow" ? 0x24100b : 0x11130f, current.mode === "shadow" ? 0.052 : 0.036);
      }
      if (current.weather !== activeWeather) {
        activeWeather = current.weather;
        weatherField.visible = current.weather !== "clear";
        weatherMaterial.color.set(current.weather === "ash" ? 0x8d7668 : current.weather === "snow" ? 0xf1f3ea : 0xaecbd2);
        weatherMaterial.size = current.weather === "rain" ? 0.018 : current.weather === "snow" ? 0.054 : 0.038;
        weatherMaterial.opacity = current.weather === "rain" ? 0.48 : 0.66;
      }
      const focusPoint = worldPosition(current.focus.x, current.focus.y);
      focusPoint.x -= current.pan.x / 115;
      focusPoint.y += current.pan.y / 115;
      const distance = 1 / current.zoom;
      const diveStrength = THREE.MathUtils.smoothstep(current.zoom, 1.72, 3.2);
      const useHighTerrain = current.quality !== "performance" && current.zoom >= 1.42;
      terrain.visible = !useHighTerrain;
      terrainHigh.visible = useHighTerrain;
      const regionalDetailActive = current.quality !== "performance" && current.mode !== "parchment" && current.zoom >= 1.72;
      const desiredRegion = regionalDetailActive ? REGIONS.find((region) => region.locationIds.includes(current.focusLocationId)) ?? null : null;
      if (desiredRegion) ensureRegion(desiredRegion);
      regionalMeshes.forEach((entry, id) => {
        const targetOpacity = desiredRegion?.id === id ? 1 : 0;
        entry.mesh.material.opacity = THREE.MathUtils.damp(entry.mesh.material.opacity, targetOpacity, 4.5, delta);
        entry.mesh.visible = targetOpacity > 0 || entry.mesh.material.opacity > 0.015;
      });
      terrainMaterial.normalScale.setScalar(current.quality === "cinematic" && current.zoom > 1.8 ? 1.28 : useHighTerrain ? 0.92 : 0.58);
      markerGroups.forEach((group) => {
        const location = group.userData.location as TerrainLocation;
        const label = group.children.find((child) => child instanceof THREE.Sprite);
        if (label) label.visible = current.zoom < 2.05 || location.id === current.partyLocation.id;
      });
      landmarkGroups.forEach((group) => {
        const scale = current.zoom > 1.8 ? 1.08 : 0.82;
        group.scale.setScalar(THREE.MathUtils.damp(group.scale.x, scale, 4, delta));
      });
      const frameDistance = 11.5 / Math.min(camera.aspect, 1.15);
      const focusElevation = sampleHeightRef.current(current.focus.x, current.focus.y);
      target.lerp(new THREE.Vector3(focusPoint.x, focusPoint.y, 0.18 + focusElevation * diveStrength * 0.72), 1 - Math.exp(-delta * 2.6));
      desiredCamera.set(
        target.x + current.tilt.y * 0.055,
        target.y - frameDistance * (0.42 + diveStrength * 0.2) * distance + current.tilt.x * 0.06,
        frameDistance * distance * (1 - diveStrength * 0.18) + 1.1 + focusElevation * diveStrength * 0.28,
      );
      camera.position.lerp(desiredCamera, 1 - Math.exp(-delta * 2.8));
      camera.lookAt(target.x, target.y + 0.45 * distance * (1 - diveStrength), target.z - diveStrength * 0.05);

      const partyTarget = worldPosition(current.partyLocation.x, current.partyLocation.y);
      const travelSpeed = current.playing ? 1.7 : 7;
      const previousPartyX = party.position.x;
      const previousPartyY = party.position.y;
      party.position.x = THREE.MathUtils.damp(party.position.x, partyTarget.x, travelSpeed, delta);
      party.position.y = THREE.MathUtils.damp(party.position.y, partyTarget.y, travelSpeed, delta);
      const travelX = party.position.x - previousPartyX;
      const travelY = party.position.y - previousPartyY;
      const isMoving = current.playing && Math.hypot(travelX, travelY) > 0.0008;
      if (isMoving) {
        const heading = Math.atan2(travelX, -travelY);
        party.rotation.z = THREE.MathUtils.damp(party.rotation.z, heading, 4.5, delta);
      }
      const partyX = ((party.position.x / WORLD_WIDTH) + 0.5) * 100;
      const partyY = (0.5 - party.position.y / WORLD_HEIGHT) * 100;
      party.position.z = THREE.MathUtils.damp(party.position.z, sampleHeightRef.current(partyX, partyY) + 0.18, 5, delta);
      travelers.forEach((traveler, travelerIndex) => {
        const stride = isMoving ? Math.sin(elapsed * 9.5 + travelerIndex * 1.8) : Math.sin(elapsed * 1.4 + travelerIndex) * 0.06;
        const limbs = traveler.userData.limbs as { legs: THREE.Group[]; arms: THREE.Group[] };
        limbs.legs.forEach((leg, legIndex) => { leg.rotation.x = stride * (legIndex === 0 ? 0.72 : -0.72); });
        limbs.arms.forEach((arm, armIndex) => { arm.rotation.x = stride * (armIndex === 0 ? -0.58 : 0.58); });
        traveler.position.z = isMoving ? Math.abs(stride) * 0.034 : 0;
        traveler.rotation.x = THREE.MathUtils.damp(traveler.rotation.x, isMoving ? 0.065 : 0, 6, delta);
      });

      mistSprites.forEach((sprite, index) => {
        sprite.position.x += sprite.userData.speed * delta;
        sprite.position.y += Math.sin(elapsed * 0.18 + index) * 0.001;
        if (sprite.position.x > 7.7) sprite.position.x = -7.7;
      });
      smokeSprites.forEach((sprite) => {
        const rise = (elapsed * sprite.userData.speed + sprite.userData.phase) % 1.5;
        sprite.position.z = sprite.userData.baseZ + rise;
        sprite.position.x += Math.sin(elapsed * 0.45 + sprite.userData.phase) * delta * 0.014;
        (sprite.material as THREE.SpriteMaterial).opacity = 0.16 * (1 - rise / 1.5);
      });
      birdFlock.forEach((bird) => {
        bird.position.x += bird.userData.speed * delta;
        bird.position.y += Math.sin(elapsed * 0.22 + bird.userData.phase) * delta * 0.025;
        if (bird.position.x > 7.6) bird.position.x = -7.6;
        const flap = Math.sin(elapsed * 8 + bird.userData.phase) * 0.72;
        (bird.userData.wings as THREE.Mesh[]).forEach((wing, wingIndex) => { wing.rotation.y = flap * (wingIndex === 0 ? 1 : -1); });
      });
      const emberAttribute = emberGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < emberCount; index += 1) {
        let z = emberAttribute.getZ(index) + delta * (0.35 + (index % 7) * 0.045);
        if (z > 3.7) z = 0.45;
        emberAttribute.setZ(index, z);
      }
      emberAttribute.needsUpdate = true;
      if (weatherField.visible) {
        const weatherAttribute = weatherGeometry.getAttribute("position") as THREE.BufferAttribute;
        const fallSpeed = current.weather === "rain" ? 6.4 : current.weather === "snow" ? 0.72 : -0.36;
        for (let index = 0; index < weatherCount; index += 1) {
          let x = weatherAttribute.getX(index);
          let z = weatherAttribute.getZ(index) - delta * fallSpeed;
          x += delta * (current.weather === "snow" ? Math.sin(elapsed + index) * 0.09 : current.weather === "ash" ? 0.22 : -0.42);
          if (z < 0.25) z = 7.8;
          if (z > 8.2) z = 0.5;
          if (x > 8) x = -8;
          if (x < -8) x = 8;
          weatherAttribute.setX(index, x);
          weatherAttribute.setZ(index, z);
        }
        weatherAttribute.needsUpdate = true;
      }
      mordorGlow.intensity = 6.2 + Math.sin(elapsed * 2.4) * 1.1;
      water.position.z = -0.185 + Math.sin(elapsed * 0.45) * 0.006;
      waterMaterial.opacity = 0.41 + Math.sin(elapsed * 0.3) * 0.025;
      if (route) (route.material as THREE.LineDashedMaterial).opacity = 0.74 + Math.sin(elapsed * 3) * 0.2;

      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
    };
    animate();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      rebuildRouteRef.current = null;
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.Points) {
          object.geometry?.dispose();
          const material = object.material as THREE.Material | THREE.Material[];
          if (Array.isArray(material)) material.forEach((item) => item.dispose());
          else material?.dispose();
        }
        if (object instanceof THREE.Sprite) {
          object.material.map?.dispose();
          object.material.dispose();
        }
      });
      mapTexture.dispose();
      parchmentTexture.dispose();
      detailNormalTexture?.dispose();
      regionalMeshes.forEach((entry) => {
        entry.colorTexture.dispose();
        entry.displacementTexture.dispose();
        entry.normalTexture?.dispose();
      });
      heightTexture.dispose();
      renderer.dispose();
      host.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div ref={hostRef} className={`terrain-scene ${ready ? "ready" : "loading"}`} aria-label="Three-dimensional terrain of Middle-earth">
      {!ready && <div className="terrain-loading"><span /><small>Raising the mountains…</small></div>}
    </div>
  );
}
