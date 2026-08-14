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
  onSelect: (id: string) => void;
};

const WORLD_WIDTH = 14;
const WORLD_HEIGHT = 7.88;
const DISPLACEMENT = 1.65;
const DISPLACEMENT_BIAS = -0.22;

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

function makeTraveler(color: number, scale: number, hooded = false) {
  const group = new THREE.Group();
  group.scale.setScalar(scale);
  const cloth = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const skin = new THREE.MeshStandardMaterial({ color: 0x8b6849, roughness: 1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x151712, roughness: 1 });

  const body = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.48, 7), cloth);
  body.position.z = 0.45;
  body.rotation.x = Math.PI / 2;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), hooded ? cloth : skin);
  head.position.z = 0.79;
  group.add(head);

  if (hooded) {
    const hood = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.25, 8), cloth);
    hood.position.z = 0.79;
    hood.rotation.x = Math.PI / 2;
    group.add(hood);
  }

  const legs: THREE.Mesh[] = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.035, 0.32, 6), dark);
    leg.position.set(side * 0.055, 0, 0.15);
    leg.rotation.x = Math.PI / 2;
    leg.userData.phase = side;
    legs.push(leg);
    group.add(leg);
  }
  group.userData.legs = legs;
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
    scene.fog = new THREE.FogExp2(0x11130f, 0.055);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 80);
    camera.position.set(0, -5, 10);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
    sun.shadow.mapSize.set(2048, 2048);
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
    const mapTexture = loader.load("/middle-earth-map.png");
    mapTexture.colorSpace = THREE.SRGBColorSpace;
    mapTexture.anisotropy = maxAnisotropy;
    const heightTexture = loader.load("/middle-earth-heightmap.png", (texture) => {
      const image = texture.image as HTMLImageElement;
      const canvas = document.createElement("canvas");
      const sampleWidth = 512;
      const sampleHeight = Math.round(sampleWidth * (image.height / image.width));
      canvas.width = sampleWidth;
      canvas.height = sampleHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context?.drawImage(image, 0, 0, sampleWidth, sampleHeight);
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

    const terrainGeometry = new THREE.PlaneGeometry(WORLD_WIDTH, WORLD_HEIGHT, 256, 144);
    const terrainMaterial = new THREE.MeshStandardMaterial({
      map: mapTexture,
      displacementMap: heightTexture,
      displacementScale: DISPLACEMENT,
      displacementBias: DISPLACEMENT_BIAS,
      roughness: 0.88,
      metalness: 0.02,
    });
    const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
    terrain.receiveShadow = true;
    scene.add(terrain);

    const underlay = new THREE.Mesh(
      new THREE.PlaneGeometry(WORLD_WIDTH + 0.3, WORLD_HEIGHT + 0.3),
      new THREE.MeshStandardMaterial({ color: 0x231e14, roughness: 1 }),
    );
    underlay.position.z = -0.27;
    scene.add(underlay);

    const sampleHeightRef: { current: (x: number, y: number) => number } = { current: () => 0.15 };
    const markerGroups: THREE.Group[] = [];
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
    }

    const party = new THREE.Group();
    const travelerSpecs: Array<[number, number, boolean, number, number]> = [
      [0x2f4935, 1.05, true, -0.22, 0.02],
      [0x777768, 1.18, false, 0.02, 0.05],
      [0x6b4529, 0.72, true, 0.22, -0.04],
      [0x475935, 0.72, true, 0.38, 0.06],
    ];
    const travelers: THREE.Group[] = [];
    for (const [color, scale, hooded, x, y] of travelerSpecs) {
      const traveler = makeTraveler(color, scale, hooded);
      traveler.position.set(x, y, 0);
      travelers.push(traveler);
      party.add(traveler);
    }
    const torch = new THREE.PointLight(0xff9b3d, 6, 1.8, 2);
    torch.position.set(0.48, 0.05, 0.75);
    party.add(torch);
    const partyStart = worldPosition(props.partyLocation.x, props.partyLocation.y);
    party.position.set(partyStart.x, partyStart.y, 0.2);
    party.scale.setScalar(0.48);
    party.rotation.x = 0;
    scene.add(party);

    const mistTexture = makeMistTexture();
    const mistSprites: THREE.Sprite[] = [];
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
    let animationFrame = 0;
    const target = new THREE.Vector3();
    const desiredCamera = new THREE.Vector3();
    const animate = () => {
      const now = performance.now();
      const delta = Math.min((now - previousTime) / 1000, 0.05);
      previousTime = now;
      elapsed += delta;
      const current = propsRef.current;
      const focusPoint = worldPosition(current.focus.x, current.focus.y);
      focusPoint.x -= current.pan.x / 115;
      focusPoint.y += current.pan.y / 115;
      const distance = 1 / current.zoom;
      target.lerp(new THREE.Vector3(focusPoint.x, focusPoint.y, 0.18), 1 - Math.exp(-delta * 2.6));
      desiredCamera.set(
        target.x + current.tilt.y * 0.055,
        target.y - 4.5 * distance + current.tilt.x * 0.06,
        8.8 * distance + 1.2,
      );
      camera.position.lerp(desiredCamera, 1 - Math.exp(-delta * 2.8));
      camera.lookAt(target.x, target.y + 0.45 * distance, 0.05);

      const partyTarget = worldPosition(current.partyLocation.x, current.partyLocation.y);
      const travelSpeed = current.playing ? 1.7 : 7;
      party.position.x = THREE.MathUtils.damp(party.position.x, partyTarget.x, travelSpeed, delta);
      party.position.y = THREE.MathUtils.damp(party.position.y, partyTarget.y, travelSpeed, delta);
      const partyX = ((party.position.x / WORLD_WIDTH) + 0.5) * 100;
      const partyY = (0.5 - party.position.y / WORLD_HEIGHT) * 100;
      party.position.z = THREE.MathUtils.damp(party.position.z, sampleHeightRef.current(partyX, partyY) + 0.18, 5, delta);
      party.rotation.z = Math.sin(elapsed * 1.7) * 0.025;
      travelers.forEach((traveler, travelerIndex) => {
        const stride = current.playing ? Math.sin(elapsed * 10 + travelerIndex * 1.8) : 0;
        const legs = traveler.userData.legs as THREE.Mesh[];
        legs.forEach((leg, legIndex) => { leg.rotation.y = stride * (legIndex === 0 ? 0.75 : -0.75); });
        traveler.position.z = Math.abs(stride) * 0.035;
      });

      mistSprites.forEach((sprite, index) => {
        sprite.position.x += sprite.userData.speed * delta;
        sprite.position.y += Math.sin(elapsed * 0.18 + index) * 0.001;
        if (sprite.position.x > 7.7) sprite.position.x = -7.7;
      });
      const emberAttribute = emberGeometry.getAttribute("position") as THREE.BufferAttribute;
      for (let index = 0; index < emberCount; index += 1) {
        let z = emberAttribute.getZ(index) + delta * (0.35 + (index % 7) * 0.045);
        if (z > 3.7) z = 0.45;
        emberAttribute.setZ(index, z);
      }
      emberAttribute.needsUpdate = true;
      mordorGlow.intensity = 6.2 + Math.sin(elapsed * 2.4) * 1.1;
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
      });
      mapTexture.dispose();
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
