// Live 3D background for every page — wireframe shapes + drifting particles.
// Uses Three.js via CDN importmap; pauses when tab is hidden or reduced motion preferred.
import * as THREE from 'three';

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('bg-canvas');
if (!canvas || REDUCED_MOTION) {
  if (canvas) canvas.remove();
} else {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
  camera.position.z = 14;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.setClearColor(0x000000, 0);

  const group = new THREE.Group();
  scene.add(group);

  const palette = [0xe8592e, 0x2f7fdb, 0x171b26, 0x2f9e6b];

  function wireShape(geometry, color, x, y, z, scale) {
    const edges = new THREE.EdgesGeometry(geometry);
    const line = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.38 })
    );
    line.position.set(x, y, z);
    line.scale.setScalar(scale);
    line.userData.homeY = y;
    line.userData.spin = {
      x: 0.0025 + Math.random() * 0.004,
      y: 0.0035 + Math.random() * 0.005,
      z: 0.0015 + Math.random() * 0.003,
    };
    line.userData.float = {
      amp: 0.35 + Math.random() * 0.45,
      speed: 0.45 + Math.random() * 0.55,
      phase: Math.random() * Math.PI * 2,
    };
    group.add(line);
    return line;
  }

  const shapes = [
    wireShape(new THREE.IcosahedronGeometry(1, 0), palette[0], -5, 2, -2, 1.45),
    wireShape(new THREE.TorusGeometry(0.9, 0.28, 8, 24), palette[1], 5.5, -1.5, -3, 1.25),
    wireShape(new THREE.OctahedronGeometry(1, 0), palette[2], 2, 3.5, -4, 1.05),
    wireShape(new THREE.TorusKnotGeometry(0.6, 0.18, 64, 8), palette[3], -3.5, -3, -5, 0.95),
    wireShape(new THREE.BoxGeometry(1.2, 1.2, 1.2), palette[0], 4, 2.5, -6, 0.85),
    wireShape(new THREE.DodecahedronGeometry(0.8, 0), palette[1], -6, -2, -4, 1.15),
    wireShape(new THREE.TetrahedronGeometry(1, 0), palette[3], 0.5, -3.8, -3.5, 0.9),
  ];

  const particleCount = 160;
  const positions = new Float32Array(particleCount * 3);
  const velocities = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * 28;
    positions[i * 3 + 1] = (Math.random() - 0.5) * 18;
    positions[i * 3 + 2] = (Math.random() - 0.5) * 12 - 4;
    velocities[i] = 0.004 + Math.random() * 0.01;
  }
  const particleGeo = new THREE.BufferGeometry();
  particleGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const particles = new THREE.Points(
    particleGeo,
    new THREE.PointsMaterial({ color: 0xe8592e, size: 0.055, transparent: true, opacity: 0.5 })
  );
  scene.add(particles);

  const clock = new THREE.Clock();
  let running = !document.hidden;
  let rafId = null;

  function animate() {
    rafId = requestAnimationFrame(animate);
    if (!running) return;

    const t = clock.getElapsedTime();
    group.rotation.y = t * 0.05;
    group.rotation.x = Math.sin(t * 0.09) * 0.08;

    shapes.forEach((shape) => {
      const { spin, float, homeY } = shape.userData;
      shape.rotation.x += spin.x;
      shape.rotation.y += spin.y;
      shape.rotation.z += spin.z;
      shape.position.y = homeY + Math.sin(t * float.speed + float.phase) * float.amp;
    });

    const pos = particleGeo.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      pos[i * 3 + 1] += velocities[i];
      if (pos[i * 3 + 1] > 9) pos[i * 3 + 1] = -9;
    }
    particleGeo.attributes.position.needsUpdate = true;
    particles.rotation.y = t * 0.02;

    camera.position.x = Math.sin(t * 0.07) * 0.35;
    camera.position.y = Math.cos(t * 0.05) * 0.2;
    camera.lookAt(0, 0, 0);

    renderer.render(scene, camera);
  }

  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  function setRunning(active) {
    running = active;
    if (active) clock.getDelta();
  }

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', () => setRunning(!document.hidden));
  animate();

  window.addEventListener('pagehide', () => {
    cancelAnimationFrame(rafId);
    renderer.dispose();
    shapes.forEach((s) => {
      s.geometry.dispose();
      s.material.dispose();
    });
    particleGeo.dispose();
    particles.material.dispose();
  });
}
