"use client";

import { useEffect, useRef, useState } from "react";
import { FreeCamera } from "@babylonjs/core/Cameras/freeCamera";
import { AbstractEngine } from "@babylonjs/core/Engines/abstractEngine";
import { Engine } from "@babylonjs/core/Engines/engine";
import { WebGPUEngine } from "@babylonjs/core/Engines/webgpuEngine";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { DirectionalLight } from "@babylonjs/core/Lights/directionalLight";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { PointLight } from "@babylonjs/core/Lights/pointLight";
import { ShadowGenerator } from "@babylonjs/core/Lights/Shadows/shadowGenerator";
import { PBRMaterial } from "@babylonjs/core/Materials/PBR/pbrMaterial";
import { DynamicTexture } from "@babylonjs/core/Materials/Textures/dynamicTexture";
import { RawTexture } from "@babylonjs/core/Materials/Textures/rawTexture";
import { Texture } from "@babylonjs/core/Materials/Textures/texture";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { VertexData } from "@babylonjs/core/Meshes/mesh.vertexData";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { ParticleSystem } from "@babylonjs/core/Particles/particleSystem";
import { DefaultRenderingPipeline } from "@babylonjs/core/PostProcesses/RenderPipeline/Pipelines/defaultRenderingPipeline";
import { Scene } from "@babylonjs/core/scene";
import type { QualityMode, TerrainLocation, TerrainSceneProps, WeatherMode, WorldMode } from "./terrain-types";

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

function proceduralHeight(x: number, y: number) {
  const mountains = Math.sin(x * 0.12) * Math.cos(y * 0.09) * 0.18;
  const ridges = Math.max(0, Math.sin((x + y) * 0.19)) * 0.16;
  return Math.max(DISPLACEMENT_BIAS, mountains + ridges + 0.08);
}

function loadHeightSampler(path: string, timeoutMs = 4500): Promise<HeightSampler> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (sampler: HeightSampler) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      resolve(sampler);
    };
    const timeout = window.setTimeout(() => finish(proceduralHeight), timeoutMs);
    const image = new Image();
    image.onload = () => {
      const width = 640;
      const height = Math.round(width * (image.height / image.width));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) return finish(proceduralHeight);
      context.filter = "blur(3px)";
      context.drawImage(image, -5, -5, width + 10, height + 10);
      const pixels = context.getImageData(0, 0, width, height).data;
      finish((x, y) => {
        const px = Math.min(width - 1, Math.max(0, Math.round((x / 100) * (width - 1))));
        const py = Math.min(height - 1, Math.max(0, Math.round((y / 100) * (height - 1))));
        return (pixels[(py * width + px) * 4] / 255) * DISPLACEMENT + DISPLACEMENT_BIAS;
      });
    };
    image.onerror = () => finish(proceduralHeight);
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

type TravelerRole = "ranger" | "wizard" | "hobbit" | "scout";
type TravelerRig = { root: TransformNode; arms: TransformNode[]; legs: TransformNode[] };

function makeLimb(scene: Scene, name: string, material: PBRMaterial, length: number, radius: number) {
  const pivot = new TransformNode(`${name}-pivot`, scene);
  const limb = MeshBuilder.CreateCylinder(name, { height: length, diameterTop: radius * 1.65, diameterBottom: radius * 2, tessellation: 8 }, scene);
  limb.material = material;
  limb.position.y = -length / 2;
  limb.parent = pivot;
  return pivot;
}

function makeTraveler(scene: Scene, role: TravelerRole, scale: number): TravelerRig {
  const root = new TransformNode(`traveler-${role}`, scene);
  root.scaling.setAll(scale);
  const palettes = {
    ranger: { cloth: "#263b2e", cloak: "#18271f", leather: "#4b3524", hair: "#271d16", skin: "#9a7455" },
    wizard: { cloth: "#73766d", cloak: "#555b55", leather: "#574631", hair: "#b8b3a5", skin: "#a98566" },
    hobbit: { cloth: "#69432a", cloak: "#31513b", leather: "#5b3821", hair: "#4b2b18", skin: "#a87d59" },
    scout: { cloth: "#4b5c35", cloak: "#35452e", leather: "#6a4328", hair: "#382416", skin: "#a77b58" },
  }[role];
  const cloth = makePbr(scene, `${role}-cloth`, palettes.cloth);
  const cloak = makePbr(scene, `${role}-cloak`, palettes.cloak);
  const leather = makePbr(scene, `${role}-leather`, palettes.leather, 0, 0.84);
  const hair = makePbr(scene, `${role}-hair`, palettes.hair);
  const skin = makePbr(scene, `${role}-skin`, palettes.skin, 0, 0.88);
  const dark = makePbr(scene, `${role}-dark`, "#171712");
  const metal = makePbr(scene, `${role}-metal`, "#b7b3a1", 0.78, 0.3);

  const body = MeshBuilder.CreateCylinder(`${role}-body`, { height: 0.43, diameterTop: 0.21, diameterBottom: 0.3, tessellation: 10 }, scene);
  body.position.y = 0.5;
  body.material = cloth;
  body.parent = root;
  const shoulders = MeshBuilder.CreateSphere(`${role}-shoulders`, { diameter: 0.3, segments: 10 }, scene);
  shoulders.scaling.set(1.15, 0.66, 0.72);
  shoulders.position.y = 0.7;
  shoulders.material = cloth;
  shoulders.parent = root;
  const cape = MeshBuilder.CreateCylinder(`${role}-cape`, { height: 0.56, diameterTop: 0.29, diameterBottom: 0.42, tessellation: 10 }, scene);
  cape.scaling.z = 0.34;
  cape.position.set(0, 0.48, 0.07);
  cape.material = cloak;
  cape.parent = root;
  const head = MeshBuilder.CreateSphere(`${role}-head`, { diameter: 0.205, segments: 12 }, scene);
  head.scaling.set(0.92, 1.08, 0.9);
  head.position.y = 0.87;
  head.material = skin;
  head.parent = root;
  const hairCap = MeshBuilder.CreateSphere(`${role}-hair`, { diameter: 0.222, segments: 10, slice: 0.62 }, scene);
  hairCap.position.y = 0.945;
  hairCap.material = hair;
  hairCap.parent = root;

  const arms: TransformNode[] = [];
  const legs: TransformNode[] = [];
  for (const side of [-1, 1]) {
    const arm = makeLimb(scene, `${role}-arm-${side}`, role === "wizard" ? cloth : leather, 0.34, 0.036);
    arm.position.set(side * 0.145, 0.69, 0);
    arm.parent = root;
    arms.push(arm);
    const short = role === "hobbit" || role === "scout";
    const leg = makeLimb(scene, `${role}-leg-${side}`, dark, short ? 0.27 : 0.34, 0.043);
    leg.position.set(side * 0.065, 0.35, 0);
    leg.parent = root;
    legs.push(leg);
    const foot = MeshBuilder.CreateSphere(`${role}-foot-${side}`, { diameter: 0.11, segments: 8 }, scene);
    foot.scaling.set(0.9, 0.62, 1.45);
    foot.position.set(side * 0.065, short ? 0.07 : 0.015, -0.035);
    foot.material = short ? skin : leather;
    foot.parent = root;
  }
  if (role === "wizard") {
    const hat = MeshBuilder.CreateCylinder("wizard-hat", { height: 0.38, diameterTop: 0, diameterBottom: 0.29, tessellation: 12 }, scene);
    hat.position.y = 1.12;
    hat.material = cloak;
    hat.parent = root;
    const staff = MeshBuilder.CreateCylinder("wizard-staff", { height: 1.2, diameter: 0.035, tessellation: 8 }, scene);
    staff.position.set(-0.25, 0.56, 0);
    staff.material = leather;
    staff.parent = root;
    const crystal = MeshBuilder.CreatePolyhedron("wizard-crystal", { type: 1, size: 0.07 }, scene);
    const glow = makePbr(scene, "wizard-crystal-glow", "#ead89c", 0.1, 0.2);
    glow.emissiveColor = Color3.FromHexString("#ead89c");
    crystal.position.set(-0.25, 1.18, 0);
    crystal.material = glow;
    crystal.parent = root;
  } else if (role === "ranger") {
    const sword = MeshBuilder.CreateCylinder("ranger-sword", { height: 0.68, diameter: 0.025, tessellation: 7 }, scene);
    sword.rotation.z = -0.38;
    sword.position.set(0.15, 0.58, 0.08);
    sword.material = metal;
    sword.parent = root;
  } else {
    const pack = MeshBuilder.CreateBox(`${role}-pack`, { width: 0.18, height: 0.27, depth: 0.11 }, scene);
    pack.position.set(0, 0.52, 0.14);
    pack.material = leather;
    pack.parent = root;
  }
  return { root, arms, legs };
}

function addLandmarkPart(scene: Scene, parent: TransformNode, mesh: Mesh, material: PBRMaterial, position: Vector3) {
  mesh.material = material;
  mesh.position.copyFrom(position);
  mesh.parent = parent;
  return mesh;
}

function makeLandmark(scene: Scene, location: TerrainLocation, sampler: HeightSampler, shadows: ShadowGenerator) {
  const root = new TransformNode(`landmark-${location.id}`, scene);
  root.position.copyFrom(worldPosition(location.x, location.y, sampler(location.x, location.y) + 0.025));
  root.position.x -= 0.18;
  root.position.z += 0.12;
  root.scaling.setAll(0.82);
  const stone = makePbr(scene, `${location.id}-stone`, "#c8c0aa");
  const white = makePbr(scene, `${location.id}-white`, "#e0ded0", 0, 0.7);
  const dark = makePbr(scene, `${location.id}-darkstone`, "#20231f");
  const wood = makePbr(scene, `${location.id}-wood`, "#5a3e26");
  const green = makePbr(scene, `${location.id}-green`, "#31583a");
  const gold = makePbr(scene, `${location.id}-gold`, "#b28a3d", 0.18, 0.62);
  const lava = makePbr(scene, `${location.id}-lava`, "#ff5a20", 0, 0.2);
  lava.emissiveColor = Color3.FromHexString("#ff471c");
  const add = (mesh: Mesh, material: PBRMaterial, x: number, y: number, z: number) => {
    addLandmarkPart(scene, root, mesh, material, new Vector3(x, y, z));
    shadows.addShadowCaster(mesh);
    return mesh;
  };
  const tower = (x: number, z: number, height: number, radius: number, material = stone) =>
    add(MeshBuilder.CreateCylinder(`${location.id}-tower`, { height, diameterTop: radius * 1.72, diameterBottom: radius * 2, tessellation: 10 }, scene), material, x, height / 2, z);
  const spire = (x: number, z: number, y: number, radius: number, height: number, material = stone) =>
    add(MeshBuilder.CreateCylinder(`${location.id}-spire`, { height, diameterTop: 0, diameterBottom: radius * 2, tessellation: 10 }, scene), material, x, y + height / 2, z);

  if (location.id === "shire") {
    for (const [x, z, size] of [[-0.16, 0, 0.11], [0.02, 0.08, 0.13], [0.18, -0.04, 0.09]] as number[][]) {
      const hill = add(MeshBuilder.CreateSphere("hobbit-hill", { diameter: size * 2, segments: 12 }, scene), green, x, size * 0.55, z);
      hill.scaling.y = 0.55;
      const door = add(MeshBuilder.CreateCylinder("hobbit-door", { height: 0.012, diameter: size * 0.76, tessellation: 16 }, scene), wood, x, size * 0.44, z - size * 0.83);
      door.rotation.x = Math.PI / 2;
    }
  } else if (location.id === "rivendell") {
    [[-0.12, 0.02, 0.38, 0.065], [0.04, 0.04, 0.56, 0.07], [0.18, 0, 0.31, 0.055]].forEach(([x, z, h, r]) => {
      tower(x, z, h, r, white); spire(x, z, h, r * 1.25, 0.17, gold);
    });
  } else if (location.id === "moria") {
    const gate = add(MeshBuilder.CreateTorus("moria-gate", { diameter: 0.38, thickness: 0.065, tessellation: 24 }, scene), stone, 0, 0.18, 0);
    gate.rotation.x = Math.PI / 2;
    add(MeshBuilder.CreateBox("moria-left", { size: 0.1, height: 0.26 }, scene), dark, -0.2, 0.13, 0);
    add(MeshBuilder.CreateBox("moria-right", { size: 0.1, height: 0.26 }, scene), dark, 0.2, 0.13, 0);
  } else if (location.id === "lothlorien" || location.id === "fangorn") {
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const radius = index ? 0.16 : 0;
      const height = 0.31 + (index % 3) * 0.08;
      tower(Math.cos(angle) * radius, Math.sin(angle) * radius, height, 0.025, wood);
      const crown = add(MeshBuilder.CreateSphere("ancient-tree", { diameter: 0.19 + (index % 2) * 0.04, segments: 8 }, scene), location.id === "lothlorien" ? gold : green, Math.cos(angle) * radius, height + 0.05, Math.sin(angle) * radius);
      crown.scaling.y = 1.35;
    }
  } else if (location.id === "rohan") {
    add(MeshBuilder.CreateBox("golden-hall", { width: 0.4, height: 0.18, depth: 0.22 }, scene), wood, 0, 0.09, 0);
    const roof = add(MeshBuilder.CreateCylinder("golden-roof", { height: 0.42, diameter: 0.28, tessellation: 4 }, scene), gold, 0, 0.24, 0);
    roof.rotation.z = Math.PI / 2;
  } else if (location.id === "isengard") {
    tower(0, 0, 0.69, 0.09, dark);
    for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) spire(Math.cos(angle) * 0.08, Math.sin(angle) * 0.08, 0.56, 0.065, 0.29, dark);
  } else if (location.id === "gondor") {
    for (let level = 0; level < 4; level += 1) tower(0, 0, 0.09 + level * 0.075, 0.29 - level * 0.045, white);
    tower(0.03, 0, 0.62, 0.047, white);
    spire(0.03, 0, 0.62, 0.065, 0.16, gold);
  } else if (location.id === "dead-marshes") {
    const poolMaterial = makePbr(scene, "marsh-light", "#769b89", 0.1, 0.16);
    poolMaterial.emissiveColor = Color3.FromHexString("#5c8f76").scale(0.5);
    poolMaterial.alpha = 0.62;
    for (let index = 0; index < 5; index += 1) {
      const pool = add(MeshBuilder.CreateDisc("marsh-pool", { radius: 0.08 + index * 0.012, tessellation: 18 }, scene), poolMaterial, (index - 2) * 0.1, 0.015, (index % 2) * 0.11);
      pool.rotation.x = Math.PI / 2;
    }
  } else if (location.id === "mordor") {
    add(MeshBuilder.CreateCylinder("mount-doom", { height: 0.72, diameterTop: 0.18, diameterBottom: 0.58, tessellation: 20 }, scene), dark, 0, 0.36, 0);
    const crater = add(MeshBuilder.CreateTorus("doom-crater", { diameter: 0.21, thickness: 0.045, tessellation: 20 }, scene), lava, 0, 0.73, 0);
    crater.scaling.z = 0.7;
  }
  return root;
}

function makeParticleTexture(scene: Scene, name: string, center: string) {
  const texture = new DynamicTexture(name, { width: 64, height: 64 }, scene, false);
  const context = texture.getContext();
  const gradient = context.createRadialGradient(32, 32, 1, 32, 32, 31);
  gradient.addColorStop(0, center);
  gradient.addColorStop(0.35, center);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  texture.hasAlpha = true;
  texture.update();
  return texture;
}

function makeWeather(scene: Scene, texture: DynamicTexture) {
  const particles = new ParticleSystem("weather-field", 900, scene);
  particles.particleTexture = texture;
  particles.emitter = new Vector3(0, 6, 0);
  particles.minEmitBox = new Vector3(-8, -0.5, -5);
  particles.maxEmitBox = new Vector3(8, 1.5, 5);
  particles.minLifeTime = 2;
  particles.maxLifeTime = 5;
  particles.emitRate = 0;
  particles.minSize = 0.025;
  particles.maxSize = 0.055;
  particles.direction1 = new Vector3(-0.4, -5, 0.05);
  particles.direction2 = new Vector3(0.1, -6.5, 0.2);
  particles.gravity = new Vector3(0, -0.8, 0);
  particles.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  return particles;
}

function setWeather(particles: ParticleSystem, weather: WeatherMode) {
  particles.stop();
  if (weather === "clear") return;
  particles.emitRate = weather === "rain" ? 560 : weather === "snow" ? 190 : 140;
  particles.minSize = weather === "rain" ? 0.018 : weather === "snow" ? 0.06 : 0.04;
  particles.maxSize = weather === "rain" ? 0.032 : weather === "snow" ? 0.12 : 0.075;
  particles.minLifeTime = weather === "rain" ? 1.4 : 4;
  particles.maxLifeTime = weather === "rain" ? 2.2 : 7;
  particles.direction1 = weather === "rain" ? new Vector3(-0.5, -8, 0) : weather === "snow" ? new Vector3(-0.25, -0.8, -0.2) : new Vector3(0.15, 0.4, -0.1);
  particles.direction2 = weather === "rain" ? new Vector3(0.1, -10, 0.25) : weather === "snow" ? new Vector3(0.3, -1.2, 0.25) : new Vector3(0.5, 0.9, 0.25);
  particles.color1 = Color4.FromHexString(weather === "ash" ? "#8d7668aa" : weather === "snow" ? "#f1f3eadd" : "#aecbd2aa");
  particles.color2 = particles.color1.scale(0.72);
  particles.start();
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
  const wantsWebGpu = new URLSearchParams(window.location.search).get("renderer") === "webgpu";
  if (wantsWebGpu && await WebGPUEngine.IsSupportedAsync) {
    const webGpu = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
    await webGpu.initAsync();
    return webGpu;
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
  const [failure, setFailure] = useState(false);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

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
      host.dataset.renderer = engine instanceof WebGPUEngine ? "webgpu" : "webgl";
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

      const underlay = MeshBuilder.CreateBox("terrain-underlay", { width: WORLD_WIDTH + 0.34, height: 0.22, depth: WORLD_DEPTH + 0.34 }, scene);
      underlay.position.y = -0.31;
      underlay.material = makePbr(scene, "earth-underlay", "#231e14", 0, 1);
      const water = MeshBuilder.CreateGround("shimmering-water", { width: WORLD_WIDTH + 0.08, height: WORLD_DEPTH + 0.08, subdivisions: 1 }, scene);
      water.position.y = -0.175;
      const waterMaterial = makePbr(scene, "water-material", "#173b43", 0.12, 0.2);
      waterMaterial.alpha = 0.48;
      waterMaterial.indexOfRefraction = 1.33;
      water.material = waterMaterial;

      const markers = new Map<string, ReturnType<typeof createMarker>>();
      for (const location of propsRef.current.locations) markers.set(location.id, createMarker(scene, location, sampler));
      const landmarks = propsRef.current.locations.map((location) => makeLandmark(scene, location, sampler, shadows));

      let forestSeed = 7391;
      const forestRandom = () => {
        forestSeed = (forestSeed * 16807) % 2147483647;
        return (forestSeed - 1) / 2147483646;
      };
      const treeMaterial = makePbr(scene, "forest-material", "#24462e", 0, 1);
      const treeSource = MeshBuilder.CreateCylinder("tree-source", { height: 0.22, diameterTop: 0, diameterBottom: 0.075, tessellation: 7 }, scene);
      treeSource.material = treeMaterial;
      treeSource.isVisible = false;
      const forestClusters = [
        { x: 24, y: 27, rx: 11, ry: 10, count: 72 },
        { x: 27, y: 49, rx: 9, ry: 17, count: 84 },
        { x: 40, y: 18, rx: 9, ry: 9, count: 58 },
        { x: 48, y: 43, rx: 6, ry: 7, count: 54 },
        { x: 52, y: 55, rx: 7, ry: 10, count: 68 },
      ];
      for (const cluster of forestClusters) {
        for (let index = 0; index < cluster.count; index += 1) {
          const angle = forestRandom() * Math.PI * 2;
          const radius = Math.sqrt(forestRandom());
          const x = cluster.x + Math.cos(angle) * cluster.rx * radius;
          const y = cluster.y + Math.sin(angle) * cluster.ry * radius;
          const tree = treeSource.createInstance(`tree-${cluster.x}-${index}`);
          tree.position.copyFrom(worldPosition(x, y, sampler(x, y) + 0.1));
          tree.rotation.y = forestRandom() * Math.PI * 2;
          tree.scaling.setAll(0.65 + forestRandom() * 0.75);
        }
      }

      const party = new TransformNode("moving-fellowship", scene);
      const travelerSpecs: Array<[TravelerRole, number, number, number]> = [
        ["ranger", 1.04, -0.28, 0.02],
        ["wizard", 1.08, 0, 0.06],
        ["hobbit", 0.8, 0.25, -0.04],
        ["scout", 0.78, 0.45, 0.08],
      ];
      const travelers = travelerSpecs.map(([role, scale, x, z]) => {
        const traveler = makeTraveler(scene, role, scale);
        traveler.root.position.set(x, 0, z);
        traveler.root.parent = party;
        traveler.root.getChildMeshes().forEach((mesh) => shadows.addShadowCaster(mesh));
        return traveler;
      });
      const partyStart = propsRef.current.partyLocation;
      party.position.copyFrom(worldPosition(partyStart.x, partyStart.y, sampler(partyStart.x, partyStart.y) + 0.14));
      party.scaling.setAll(0.7);
      const torch = new PointLight("fellowship-torch", new Vector3(0.46, 0.72, 0.05), scene);
      torch.diffuse = Color3.FromHexString("#ff9b3d");
      torch.intensity = 4.8;
      torch.range = 2.1;
      torch.parent = party;

      const weatherTexture = makeParticleTexture(scene, "weather-particle", "rgba(235,242,238,.95)");
      const weatherField = makeWeather(scene, weatherTexture);
      let activeWeather: WeatherMode | null = null;
      const emberTexture = makeParticleTexture(scene, "ember-particle", "rgba(255,106,42,1)");
      const embers = new ParticleSystem("mordor-embers", 220, scene);
      embers.particleTexture = emberTexture;
      embers.emitter = worldPosition(87, 34, sampler(87, 34) + 0.55);
      embers.minEmitBox = new Vector3(-0.45, -0.1, -0.45);
      embers.maxEmitBox = new Vector3(0.45, 0.3, 0.45);
      embers.direction1 = new Vector3(-0.12, 0.45, -0.1);
      embers.direction2 = new Vector3(0.2, 1.1, 0.2);
      embers.minLifeTime = 1.5;
      embers.maxLifeTime = 4;
      embers.minSize = 0.025;
      embers.maxSize = 0.07;
      embers.emitRate = 48;
      embers.color1 = Color4.FromHexString("#ff7a32ee");
      embers.color2 = Color4.FromHexString("#ff3b16aa");
      embers.blendMode = ParticleSystem.BLENDMODE_ADD;
      embers.start();
      const mordorGlow = new PointLight("mordor-glow", worldPosition(87, 34, sampler(87, 34) + 0.8), scene);
      mordorGlow.diffuse = Color3.FromHexString("#ff4a1e");
      mordorGlow.intensity = 6.4;
      mordorGlow.range = 4.8;

      const mistTexture = makeParticleTexture(scene, "mist-particle", "rgba(215,220,208,.28)");
      const mist = new ParticleSystem("valley-mist", 120, scene);
      mist.particleTexture = mistTexture;
      mist.emitter = new Vector3(0, 0.45, 0);
      mist.minEmitBox = new Vector3(-7, -0.1, -3.9);
      mist.maxEmitBox = new Vector3(7, 0.6, 3.9);
      mist.direction1 = new Vector3(0.025, 0, -0.01);
      mist.direction2 = new Vector3(0.08, 0.015, 0.02);
      mist.minLifeTime = 16;
      mist.maxLifeTime = 28;
      mist.minSize = 0.8;
      mist.maxSize = 2.6;
      mist.emitRate = 4;
      mist.color1 = new Color4(0.82, 0.84, 0.79, 0.06);
      mist.color2 = new Color4(0.7, 0.74, 0.69, 0.02);
      mist.start();

      const birdMaterial = makePbr(scene, "bird-material", "#141814", 0, 0.9);
      const birds: Array<{ root: TransformNode; wings: Mesh[]; speed: number; phase: number }> = [];
      for (let index = 0; index < 11; index += 1) {
        const root = new TransformNode(`bird-${index}`, scene);
        root.position.set(-6.5 + index * 0.45, 2.7 + (index % 3) * 0.15, 2.4 + (index % 4) * 0.22);
        const wings = [-1, 1].map((side) => {
          const wing = MeshBuilder.CreatePlane(`bird-wing-${index}-${side}`, { width: 0.1, height: 0.035 }, scene);
          wing.material = birdMaterial;
          wing.position.x = side * 0.048;
          wing.rotation.z = side * 0.18;
          wing.parent = root;
          return wing;
        });
        birds.push({ root, wings, speed: 0.12 + (index % 4) * 0.018, phase: index * 0.7 });
      }
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
      let elapsed = 0;

      engine.runRenderLoop(() => {
        const current = propsRef.current;
        const now = performance.now();
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;
        elapsed += delta;
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
        landmarks.forEach((landmark) => {
          const targetScale = current.zoom > 1.8 ? 1.08 : 0.82;
          landmark.scaling = Vector3.Lerp(landmark.scaling, new Vector3(targetScale, targetScale, targetScale), Math.min(1, delta * 4));
        });

        const partyTarget = worldPosition(current.partyLocation.x, current.partyLocation.y, sampler(current.partyLocation.x, current.partyLocation.y) + 0.14);
        const previousX = party.position.x;
        const previousZ = party.position.z;
        const travelSpeed = current.playing ? 1.7 : 7;
        const travelBlend = 1 - Math.exp(-delta * travelSpeed);
        party.position.x += (partyTarget.x - party.position.x) * travelBlend;
        party.position.z += (partyTarget.z - party.position.z) * travelBlend;
        const partyX = (party.position.x / WORLD_WIDTH + 0.5) * 100;
        const partyY = (party.position.z / WORLD_DEPTH + 0.5) * 100;
        party.position.y += (sampler(partyX, partyY) + 0.14 - party.position.y) * Math.min(1, delta * 5);
        const travelX = party.position.x - previousX;
        const travelZ = party.position.z - previousZ;
        const moving = current.playing && Math.hypot(travelX, travelZ) > 0.0008;
        if (moving) {
          const heading = Math.atan2(travelX, travelZ);
          party.rotation.y += Math.atan2(Math.sin(heading - party.rotation.y), Math.cos(heading - party.rotation.y)) * Math.min(1, delta * 4.5);
        }
        travelers.forEach((traveler, travelerIndex) => {
          const stride = moving ? Math.sin(elapsed * 9.5 + travelerIndex * 1.8) : Math.sin(elapsed * 1.4 + travelerIndex) * 0.06;
          traveler.legs.forEach((leg, legIndex) => { leg.rotation.x = stride * (legIndex === 0 ? 0.72 : -0.72); });
          traveler.arms.forEach((arm, armIndex) => { arm.rotation.x = stride * (armIndex === 0 ? -0.58 : 0.58); });
          traveler.root.position.y = moving ? Math.abs(stride) * 0.034 : 0;
          traveler.root.rotation.x += ((moving ? 0.065 : 0) - traveler.root.rotation.x) * Math.min(1, delta * 6);
        });

        birds.forEach((bird) => {
          bird.root.position.x += bird.speed * delta;
          bird.root.position.z += Math.sin(elapsed * 0.22 + bird.phase) * delta * 0.025;
          if (bird.root.position.x > 7.6) bird.root.position.x = -7.6;
          const flap = Math.sin(elapsed * 8 + bird.phase) * 0.72;
          bird.wings.forEach((wing, wingIndex) => { wing.rotation.y = flap * (wingIndex === 0 ? 1 : -1); });
        });
        water.position.y = -0.175 + Math.sin(elapsed * 0.45) * 0.006;
        waterMaterial.alpha = 0.45 + Math.sin(elapsed * 0.3) * 0.025;
        mordorGlow.intensity = 6.2 + Math.sin(elapsed * 2.4) * 1.1;
        if (route) route.alpha = 0.76 + Math.sin(elapsed * 3) * 0.18;

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
        if (activeWeather !== current.weather) {
          setWeather(weatherField, current.weather);
          activeWeather = current.weather;
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
          hemisphere.intensity = current.mode === "moonlit" ? 0.72 : current.mode === "shadow" ? 0.9 : 1.45;
          sun.intensity = current.mode === "moonlit" ? 1.3 : current.mode === "shadow" ? 1.7 : 3.2;
          mist.emitRate = current.mode === "shadow" ? 7 : current.mode === "moonlit" ? 5 : 4;
          lastMode = current.mode;
        }
        scene.render();
      });
      setReady(true);

      scene.onDisposeObservable.add(() => observer.disconnect());
    })().catch((error) => {
      console.error("Babylon terrain initialization failed", error);
      if (!cancelled) setFailure(true);
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
      {!ready && !failure && <div className="terrain-loading"><span /><small>Raising the mountains…</small></div>}
      {failure && (
        <div className="terrain-loading terrain-failed" role="alert">
          <small>The terrain engine could not start.</small>
          <button type="button" onClick={() => window.location.reload()}>Try again</button>
        </div>
      )}
    </div>
  );
}
