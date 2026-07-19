// Register Service Worker for offline operations
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.error(err));
  });
}

// ==========================================
// 1. HARDCODED CONSTANTS & PARAMETERS
// ==========================================
// Physics Settings (Your exact perfect configurations) [1.1.1]
const GRAB_RADIUS = 1.00;        // Falloff selection size [1.1.1]
const INFLATION_FACTOR = 0.65;   // Pythagorean inflation [1.1.1]
const RESTORATIVE_FORCE = 0.09;  // Elasticity pull [1.1.1]
const SPRING_STIFFNESS = 0.95;   // Surface skin tension [1.1.1]
const DAMPING_FACTOR = 0.99;     // Friction damping [1.1.1]
const TIME_STEP = 0.016;
const SOLVER_ITERATIONS = 3;     

const ROT_SPRING_STIFFNESS = 0.08; 
const ROT_SPRING_DAMPING = 0.84;   

// Translational Spring-Damper Variables (For floating center of mass) [1.2.9]
const posVel = new THREE.Vector3();
const CENTER_SPRING_STIFFNESS = 0.08; // Spring pulling parent back to center [1.2.9]
const CENTER_SPRING_DAMPING = 0.85;   // Friction damping for parent translations [1.2.9]

// Hardcoded Light Directions (Degrees converted to Radians) [1.1.1]
const dirYaw = THREE.MathUtils.degToRad(-5.00);
const dirPitch = THREE.MathUtils.degToRad(-10.00);
const rimYaw = THREE.MathUtils.degToRad(-180.00);
const rimPitch = THREE.MathUtils.degToRad(35.00);

// ==========================================
// 2. AUDIO & VISUAL SYSTEM NODES SETUP
// ==========================================
// WebGL Scene Nodes
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000); // Solid black background

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 0, 4);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Hardcoded Studio Lighting intensities matching your exact preferences [1.1.1]
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.95);
scene.add(dirLight);

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.95);
scene.add(hemiLight);

const rimLight = new THREE.DirectionalLight(0xffffff, 3.00); // Powerful rim light [1.1.1]
scene.add(rimLight);

function updateLightDirections() {
  const radius = 6.0;

  // Directional Light Positioning
  dirLight.position.x = radius * Math.cos(dirPitch) * Math.sin(dirYaw);
  dirLight.position.y = radius * Math.sin(dirPitch);
  dirLight.position.z = radius * Math.cos(dirPitch) * Math.cos(dirYaw);

  // Rim Light Positioning
  rimLight.position.x = radius * Math.cos(rimPitch) * Math.sin(rimYaw);
  rimLight.position.y = radius * Math.sin(rimPitch);
  rimLight.position.z = radius * Math.cos(rimPitch) * Math.cos(rimYaw);
}
updateLightDirections(); // Run initial positioning

// Physics Variables
let particles = [];
let springs = [];
let faces = []; 
let headMesh = null;
let headGeometry = null;

// New Parent Pivot Group to handle natural physical rotations around Blender origin [1.2.9]
let pivotGroup = null; 

// Vertex welder mapping
const vertexToParticleMap = [];

// Real-Time Interaction variables
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const dragStartMouse = new THREE.Vector2(); // Tracks initial click coordinate to enable relative drag rotation [3]
let draggedParticles = []; 
let initialGrabPoint = new THREE.Vector3();
let worldInitialGrabPoint = new THREE.Vector3(); 
let dragPlane = new THREE.Plane();
let dragIntersection = new THREE.Vector3();

// Input Coalescing coordinates processed in-sync with rAF
let isDraggingActive = false;
const localDragTarget = new THREE.Vector3();

// Rotational Spring-Damper Variables (For realistic torque-driven head tilting)
let targetRotX = 0;
let targetRotY = 0;
let targetRotZ = 0;
let rotVelX = 0;                
let rotVelY = 0;                
let rotVelZ = 0;                

// Dynamic Gyroscope/Accelerometer Variables [2.1.5]
let baseBeta = null;
let baseGamma = null;
let sensorRotX = 0;
let sensorRotY = 0;
let gyroPermissionRequested = false;

// App Loop States
let isInitialized = false;

// ZERO-ALLOCATION OPTIMIZATION: Pre-allocated temporary vectors
const tempVel = new THREE.Vector3();
const tempDelta = new THREE.Vector3();
const tempTorque = new THREE.Vector3();
const tempAppliedForce = new THREE.Vector3();
const tempRotationalForce = new THREE.Vector3();
const tempParentRestorative = new THREE.Vector3();
const tempParentTarget = new THREE.Vector3();
const tempWorldDisp = new THREE.Vector3();
const tempLocalDisp = new THREE.Vector3();
const tempCOM = new THREE.Vector3();
const cb = new THREE.Vector3();
const ab = new THREE.Vector3();

// Load Tan Model immediately on page launch [1.2.9]
const loader = new THREE.GLTFLoader();
loader.load('./Tan.glb', (gltf) => {
  gltf.scene.traverse((child) => {
    // Grab the very first Mesh child we encounter, completely bypassing Blender naming bugs! [2.1.2]
    if (child.isMesh && !headMesh) {
      headMeshSetup(child);
    }
  });
}, 
null, 
(error) => {
  console.error(error);
});

function headMeshSetup(mesh) {
  headMesh = mesh;
  headGeometry = mesh.geometry;
  
  if (!headGeometry.index) {
    console.error("ERROR: Model must be exported with indexed geometry.");
    return;
  }

  // Parent Grouping Setup [1.2.9]
  pivotGroup = new THREE.Group();
  scene.add(pivotGroup);
  pivotGroup.add(headMesh);

  // Preserves your exact Blender scale and local Origin pivot point! [1.1.2, 1.2.9]
  headMesh.position.set(0, 0, 0); 

  // Procedural double-sided rendering [1.1.6]
  if (headMesh.material) {
    headMesh.material.side = THREE.DoubleSide; 
    headMesh.material.shadowSide = THREE.DoubleSide;
    headMesh.material.metalness = 0.0; 
  }

  const posAttr = headGeometry.attributes.position;
  const count = posAttr.count;

  // VERTEX WELDER: Group duplicate UV vertices sharing the exact same 3D coordinates
  const uniqueParticlesMap = new Map();
  let particleCount = 0;

  for (let i = 0; i < count; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);

    const key = `${x.toFixed(5)}_${y.toFixed(5)}_${z.toFixed(5)}`;

    if (uniqueParticlesMap.has(key)) {
      const existingParticleIndex = uniqueParticlesMap.get(key);
      vertexToParticleMap.push(existingParticleIndex);
      particles[existingParticleIndex].vertexIndices.push(i);
    } else {
      const originalPos = new THREE.Vector3(x, y, z);

      particles.push({
        pos: originalPos.clone(),
        prevPos: originalPos.clone(),
        restPos: originalPos.clone(),
        normal: new THREE.Vector3(), // Pre-allocated vector for custom smooth normal calculations [3]
        isAnchor: false,             // All world anchors are deleted. Head is 100% free! [1.2.9]
        isDragged: false,        
        vertexIndices: [i] 
      });

      uniqueParticlesMap.set(key, particleCount);
      vertexToParticleMap.push(particleCount);
      particleCount++;
    }
  }

  const indices = headGeometry.index.array;
  const uniqueSprings = new Set();

  function addSpring(a, b) {
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (uniqueSprings.has(key)) return;
    uniqueSprings.add(key);

    const dist = particles[a].restPos.distanceTo(particles[b].restPos);
    springs.push({
      indexA: a,
      indexB: b,
      restLength: dist
    });
  }

  // 1. Build standard skin-surface springs along every polygon edge
  for (let i = 0; i < indices.length; i += 3) {
    const a = vertexToParticleMap[indices[i]];
    const b = vertexToParticleMap[indices[i+1]];
    const c = vertexToParticleMap[indices[i+2]];

    if (a !== b) addSpring(a, b);
    if (b !== c) addSpring(b, c);
    if (c !== a) addSpring(c, a);
  }

  // 2. Build pre-allocated face structural data for smooth normal calculation [3]
  for (let i = 0; i < indices.length; i += 3) {
    faces.push({
      a: vertexToParticleMap[indices[i]],
      b: vertexToParticleMap[indices[i+1]],
      c: vertexToParticleMap[indices[i+2]],
      vA: indices[i],
      vB: indices[i+1],
      vC: indices[i+2]
    });
  }

  isInitialized = true;
  animate();
}

// 5. Verlet Integration & Torque Physics Solver
function solvePhysics() {
  if (!headMesh || !pivotGroup) return;

  // Step A: Calculate input drag calculations strictly once-per-render-frame
  if (isDraggingActive && draggedParticles.length > 0) {
    raycaster.setFromCamera(mouse, camera);
    if (raycaster.ray.intersectPlane(dragPlane, dragIntersection)) {
      // Calculate world-space drag displacement vector [1.2.9]
      tempWorldDisp.copy(dragIntersection).sub(worldInitialGrabPoint);
      
      // Convert world displacement vector to local coordinate space [1.2.9]
      // We multiply by the inverse of the pivot group's rotation quaternion [1.2.9]
      tempLocalDisp.copy(tempWorldDisp).applyQuaternion(pivotGroup.quaternion.clone().invert());
      
      const pullDist = Math.sqrt(tempLocalDisp.x * tempLocalDisp.x + tempLocalDisp.y * tempLocalDisp.y);

      // Apply weighted deformation smoothly to all vertices in the falloff radius [1.2.9]
      for (let dp of draggedParticles) {
        const p = dp.particle;
        const w = dp.weight;

        const targetPos = p.restPos.clone().addScaledVector(tempLocalDisp, w);

        // PYTHAGOREAN INFLATION: Push vertices forward (+Z) based on pull distance and weight
        targetPos.z += (pullDist * INFLATION_FACTOR * w);

        p.pos.copy(targetPos);
        p.prevPos.copy(targetPos);
      }

      // Symmetrical Trackball Rotation driven purely by the relative drag [3]
      const deltaX = mouse.x - dragStartMouse.x; [3]
      const deltaY = mouse.y - dragStartMouse.y; [3]

      targetRotY = deltaX * 1.5 + sensorRotY;  // Yaw [3, 2.1.8]
      targetRotX = -deltaY * 1.2 + sensorRotX; // Pitch [3, 2.1.8]
      targetRotZ = -deltaX * 0.4 - sensorRotY * 0.25; // Roll [3]
    }
  } else {
    // When released, head returns straight to physical gyroscope orientation sways [2.1.8]
    targetRotX = sensorRotX;
    targetRotY = sensorRotY;
    targetRotZ = -sensorRotY * 0.25;
  }

  // Solve the rotational spring physics [1.2.9]
  const forceX = (targetRotX - pivotGroup.rotation.x) * ROT_SPRING_STIFFNESS;
  rotVelX = (rotVelX + forceX) * ROT_SPRING_DAMPING;
  pivotGroup.rotation.x += rotVelX;

  const forceY = (targetRotY - pivotGroup.rotation.y) * ROT_SPRING_STIFFNESS;
  rotVelY = (rotVelY + forceY) * ROT_SPRING_DAMPING;
  pivotGroup.rotation.y += rotVelY;

  const forceZ = (targetRotZ - pivotGroup.rotation.z) * ROT_SPRING_STIFFNESS;
  rotVelZ = (rotVelZ + forceZ) * ROT_SPRING_DAMPING;
  pivotGroup.rotation.z += rotVelZ;


  // Step C: Calculate Translational Pivot Spring (Floating Center of Mass) [1.2.9]
  tempParentTarget.set(0, 0, 0);
  if (draggedParticles.length > 0) {
    const centerGrab = draggedParticles[0].particle;
    tempDelta.copy(centerGrab.pos).sub(centerGrab.restPos);
    tempParentTarget.copy(tempDelta).applyQuaternion(pivotGroup.quaternion).multiplyScalar(0.20);
  }

  // Smooth translational spring damper pulls parent group back to (0,0,0) [1.2.9]
  tempParentRestorative.copy(tempParentTarget).sub(pivotGroup.position).multiplyScalar(CENTER_SPRING_STIFFNESS);
  posVel.add(tempParentRestorative).multiplyScalar(CENTER_SPRING_DAMPING);
  pivotGroup.position.add(posVel);


  // Step D: Accumulate forces & Verlet Step (Softbody deformation)
  for (let p of particles) {
    if (p.isAnchor) continue;
    if (p.isDragged) continue; // Instantly bypass using O(1) boolean flag

    // In-place Verlet velocity calculation
    tempVel.copy(p.pos).sub(p.prevPos).multiplyScalar(DAMPING_FACTOR);
    p.prevPos.copy(p.pos);
    p.pos.add(tempVel);

    // In-place Positional Lerp Restoration
    p.pos.lerp(p.restPos, RESTORATIVE_FORCE);
  }

  // Step E: Solve Spring Constraints (Stretching)
  for (let iter = 0; iter < SOLVER_ITERATIONS; iter++) {
    for (let s of springs) {
      const pA = particles[s.indexA];
      const pB = particles[s.indexB];

      const isDragA = pA.isDragged;
      const isDragB = pB.isDragged;

      // In-place delta displacement calculations
      tempDelta.copy(pB.pos).sub(pA.pos);
      const currentLength = tempDelta.length();
      if (currentLength === 0) continue;

      const activeStiffness = s.stiffness || SPRING_STIFFNESS;
      const difference = (s.restLength - currentLength) / currentLength * 0.5 * activeStiffness;
      const adjustment = tempDelta.multiplyScalar(difference);

      if (!pA.isAnchor && !isDragA) pA.pos.sub(adjustment);
      if (!pB.isAnchor && !isDragB) pB.pos.add(adjustment);
    }
  }

  // Step F: $O(V)$ Seamless Smooth Normal Real-Time Renderer [3]
  // Solves the "half-smooth" shading bug by manually averaging normals across UV seams [2, 3]
  const normAttr = headGeometry.attributes.normal;
  
  // 1. Reset particle normals to zero [3]
  for (let p of particles) {
    p.normal.set(0, 0, 0);
  }
  
  // 2. Accumulate face normal vectors in linear time [3]
  for (let f of faces) {
    const pA = particles[f.a].pos;
    const pB = particles[f.b].pos;
    const pC = particles[f.c].pos;
    
    cb.subVectors(pC, pB);
    ab.subVectors(pA, pB);
    cb.cross(ab);
    
    particles[f.a].normal.add(cb);
    particles[f.b].normal.add(cb);
    particles[f.c].normal.add(cb);
  }
  
  // 3. Normalize and write values back to the raw WebGL normal buffer [3]
  for (let p of particles) {
    p.normal.normalize();
    for (let vIdx of p.vertexIndices) {
      normAttr.setXYZ(vIdx, p.normal.x, p.normal.y, p.normal.z);
    }
  }
  normAttr.needsUpdate = true; // Tell WebGL to re-render smooth lighting [3]


  // Step G: Center of Mass Pivot Spring (Bypasses global sticky wall) [1.2.9]
  // Calculates overall displacement of the entire head and pulls it back to (0,0,0) [1.2.9]
  tempCOM.set(0, 0, 0);
  for (let p of particles) {
    tempCOM.add(p.pos);
  }
  tempCOM.divideScalar(particles.length);

  // Apply a smooth translational spring to pull the entire head back to center [1.2.9]
  const centerSpringStiffness = 0.08;
  tempCOM.multiplyScalar(centerSpringStiffness);
  for (let p of particles) {
    p.pos.sub(tempCOM);
  }

  // Step H: Update three.js vertex buffer array
  const posAttr = headGeometry.attributes.position;
  for (let p of particles) {
    for (let vertexIdx of p.vertexIndices) {
      posAttr.setXYZ(vertexIdx, p.pos.x, p.pos.y, p.pos.z);
    }
  }
  posAttr.needsUpdate = true;
}

// Render loop
function animate() {
  requestAnimationFrame(animate);
  solvePhysics();
  renderer.render(scene, camera);
}

// Real-Time Interaction and Pointer Capture Handlers
function updateMouseCoords(e) {
  const clientX = e.clientX;
  const clientY = e.clientY;
  
  mouse.x = (clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(clientY / window.innerHeight) * 2 + 1;
}

// Secure Gyroscope request on very first interaction [2.1.6]
async function requestGyroPermission() {
  if (gyroPermissionRequested) return;
  gyroPermissionRequested = true;

  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const permission = await DeviceOrientationEvent.requestPermission();
      if (permission === 'granted') {
        window.addEventListener('deviceorientation', handleOrientation);
        console.log("Gyroscope permission granted.");
      }
    } catch (err) {
      console.error("Gyroscope permission error:", err);
    }
  } else {
    // Android or standard Desktop browser [2.1.5]
    window.addEventListener('deviceorientation', handleOrientation);
  }
}

// Capture and process absolute phone tilt angles [2.1.5]
function handleOrientation(event) {
  if (event.beta === null || event.gamma === null) return;

  // Establish neutral baseline based on how the user holds the phone at startup [2.1.5]
  if (baseBeta === null) {
    baseBeta = event.beta;
    baseGamma = event.gamma;
  }

  // Calculate delta tilts in Radians [2.1.5]
  const deltaBeta = THREE.MathUtils.degToRad(event.beta - baseBeta);
  const deltaGamma = THREE.MathUtils.degToRad(event.gamma - baseGamma);

  // Map to subtle rotational sways (Pitch and Yaw) [2.1.5]
  sensorRotX = THREE.MathUtils.clamp(deltaBeta * 0.8, -0.6, 0.6);  
  sensorRotY = THREE.MathUtils.clamp(deltaGamma * 0.8, -0.6, 0.6); 
}

window.addEventListener('pointerdown', (e) => {
  if (!headMesh || !pivotGroup) return;
  
  // Securely request gyroscope access on first touch (satisfying WebKit browser security) [2.1.6]
  requestGyroPermission();

  try {
    e.target.setPointerCapture(e.pointerId);
  } catch (err) {}

  updateMouseCoords(e);
  
  // Store the initial drag coordinate in screen space to prevent touch snap [3]
  dragStartMouse.copy(mouse); [3]

  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(headMesh);

  if (intersects.length > 0) {
    const intersection = intersects[0];
    
    // Store both world and local grab coordinates on tap [1.2.9]
    worldInitialGrabPoint.copy(intersection.point); // World coordinates
    initialGrabPoint.copy(headMesh.worldToLocal(intersection.point.clone())); // Local coordinates

    // Reset O(1) drag flags
    for (let p of particles) p.isDragged = false;
    draggedParticles = [];

    // Find ALL particles within the grab falloff radius
    for (let p of particles) {
      if (p.isAnchor) continue;
      
      const dist = p.restPos.distanceTo(initialGrabPoint);
      if (dist < GRAB_RADIUS) {
        const weight = Math.pow(1.0 - (dist / GRAB_RADIUS), 2);
        
        p.isDragged = true; // Set active drag flag
        draggedParticles.push({
          particle: p,
          weight: weight
        });
      }
    }

    if (draggedParticles.length > 0) {
      isDraggingActive = true; 
      
      const normal = new THREE.Vector3();
      camera.getWorldDirection(normal);
      normal.negate(); 
      dragPlane.setFromNormalAndCoplanarPoint(normal, intersection.point);
    }
  }
});

window.addEventListener('pointermove', (e) => {
  if (!isDraggingActive || draggedParticles.length === 0 || !headMesh) return;
  updateMouseCoords(e); 
});

function releaseDrag(e) {
  if (isDraggingActive) {
    try {
      e.target.releasePointerCapture(e.pointerId);
    } catch (err) {}
    
    isDraggingActive = false; 
    
    // Reset O(1) drag flags
    for (let p of particles) p.isDragged = false;
    draggedParticles = [];
  }
}

window.addEventListener('pointerup', releaseDrag);
window.addEventListener('pointercancel', releaseDrag);

// Resize viewport on flip
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});