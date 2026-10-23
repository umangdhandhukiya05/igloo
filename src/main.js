import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
    TERRAIN_VERT_PARS, TERRAIN_VERT_BEGIN,
    TERRAIN_FRAG_PARS, TERRAIN_FRAG_COLOR
} from './shaders/terrain.glsl.js';
import { WIND_MIST_VERT, WIND_MIST_FRAG } from './shaders/windMist.glsl.js';
import { SNOW_VERT, SNOW_FRAG } from './shaders/snow.glsl.js';

// --- Scene Initialization ---
const container = document.getElementById('canvas-container');
const plexusCanvas = document.getElementById('plexus-canvas');
const pCtx = plexusCanvas.getContext('2d');
const statusContainer = document.getElementById('status-container');
const statusText = document.getElementById('status-text');

const scene = new THREE.Scene();
const FOG_COLOR = 0xb5c0cb; // Pale cool overcast arctic sky
const FOG_COLOR_VEC = new THREE.Color(FOG_COLOR);
scene.background = FOG_COLOR_VEC.clone();
scene.fog = new THREE.FogExp2(FOG_COLOR, 0.0042);

// --- Camera Setup matching reference ---
const camera = new THREE.PerspectiveCamera(
    34,
    window.innerWidth / window.innerHeight,
    0.2,
    1200
);

// Base camera anchor coordinates (fixed cinematic hero perspective)
const baseCamPos = new THREE.Vector3(13.2, 4.6, 15.8);
const baseTarget = new THREE.Vector3(0.3, 1.45, 0);

const currentCamPos = baseCamPos.clone();
const currentTarget = baseTarget.clone();

camera.position.copy(currentCamPos);
camera.lookAt(currentTarget);

// --- Renderer Setup ---
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor(FOG_COLOR);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- Resize 2D Plexus Overlay Canvas ---
function resizePlexusCanvas() {
    const dpr = Math.min(window.devicePixelRatio, 2);
    plexusCanvas.width = window.innerWidth * dpr;
    plexusCanvas.height = window.innerHeight * dpr;
    plexusCanvas.style.width = `${window.innerWidth}px`;
    plexusCanvas.style.height = `${window.innerHeight}px`;
    pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
resizePlexusCanvas();

// --- Procedural bump map for igloo block stone faces ---
function createBlockBumpTexture(size = 512) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            // Multi-frequency carved stone noise for chiseled block faces
            const f1 = Math.sin(x * 0.09 + 0.4) * Math.cos(y * 0.11 + 0.7) * 20;
            const f2 = Math.sin(x * 0.31 + y * 0.19) * 9;
            const f3 = Math.cos(x * 0.57 + y * 0.43) * 4;
            const noise = (Math.random() - 0.5) * 50;
            const val = Math.min(255, Math.max(0, 128 + Math.floor(f1 + f2 + f3 + noise)));
            data[idx] = val; data[idx+1] = val; data[idx+2] = val; data[idx+3] = 255;
        }
    }
    ctx.putImageData(imgData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 4);
    return texture;
}
const blockBumpTex = createBlockBumpTexture(512);

// --- Procedural Snow Texture for Igloo Blocks ---
function createSnowTexture(size = 256) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imgData = ctx.createImageData(size, size);
    const data = imgData.data;
    for (let i = 0; i < size * size; i++) {
        const val = 135 + Math.floor((Math.random() - 0.5) * 45);
        const idx = i * 4;
        data[idx] = val; data[idx+1] = val; data[idx+2] = val; data[idx+3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(8, 8);
    return texture;
}
const snowTexture = createSnowTexture(256);

// --- Terrain texture loader (photorealistic arctic slate ice & rock) ---
const textureLoader = new THREE.TextureLoader();

function loadTerrainTexture(repeat) {
    const t = textureLoader.load('/textures/arctic_slate_terrain.jpg');
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}
const terrainColorMapFG = loadTerrainTexture(6);
const terrainBumpMapFG  = loadTerrainTexture(6);
const terrainColorMapBG = loadTerrainTexture(12);
const terrainBumpMapBG  = loadTerrainTexture(12);

// --- Build onBeforeCompile terrain GLSL shader material ---
const sharedTerrainUniforms = {
    uTime: { value: 0 }
};

function makeTerrainMaterial(isFG) {
    const mat = new THREE.MeshStandardMaterial({
        color: isFG ? 0x909caa : 0x828f9d,
        map: isFG ? terrainColorMapFG : terrainColorMapBG,
        bumpMap: isFG ? terrainBumpMapFG : terrainBumpMapBG,
        bumpScale: isFG ? 0.08 : 0.12,
        roughness: isFG ? 0.82 : 0.88,
        metalness: 0.02,
        side: THREE.DoubleSide
    });

    mat.userData.isFG = isFG ? 1.0 : 0.0;

    mat.onBeforeCompile = (shader) => {
        // Inject uniforms
        shader.uniforms.uTime  = sharedTerrainUniforms.uTime;
        shader.uniforms.uIsFG  = { value: mat.userData.isFG };

        // Vertex shader: inject vWorldPos varying
        shader.vertexShader = shader.vertexShader
            .replace(
                '#include <common>',
                '#include <common>\n' + TERRAIN_VERT_PARS
            )
            .replace(
                '#include <begin_vertex>',
                '#include <begin_vertex>\n' + TERRAIN_VERT_BEGIN
            );

        // Fragment shader: inject noise lib + color override
        shader.fragmentShader = shader.fragmentShader
            .replace(
                '#include <common>',
                '#include <common>\n' + TERRAIN_FRAG_PARS
            )
            .replace(
                '#include <map_fragment>',
                '#include <map_fragment>\n' + TERRAIN_FRAG_COLOR
            );

        mat.userData.shader = shader;
    };

    return mat;
}

const terrainForegroundMat  = makeTerrainMaterial(true);
const terrainMountainsMat   = makeTerrainMaterial(false);

// --- Natural Arctic Lighting Rig ---
// 1. Hemisphere Light (Soft Overcast Ambient Sky & Snow Ground bounce)
const hemiLight = new THREE.HemisphereLight(0xdbe6f2, 0x6e7b8a, 1.25);
scene.add(hemiLight);

// 2. Main Key Directional Sun (from top-back-left, soft arctic shadows)
const dirLight = new THREE.DirectionalLight(0xf4f8fc, 2.3);
dirLight.position.set(-36, 46, -22);
dirLight.target.position.set(0.3, 1.4, 0);
scene.add(dirLight.target);

dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 5;
dirLight.shadow.camera.far = 160;
dirLight.shadow.camera.left = -30;
dirLight.shadow.camera.right = 30;
dirLight.shadow.camera.top = 30;
dirLight.shadow.camera.bottom = -30;
dirLight.shadow.bias = -0.0003;
dirLight.shadow.radius = 2.4;
scene.add(dirLight);

// 3. Fill Light (Soft cool bounce on shadow sides)
const fillLight = new THREE.DirectionalLight(0x8fa4b8, 0.7);
fillLight.position.set(30, 22, 28);
scene.add(fillLight);

// 4. Subtle Ambient Base
const ambientLight = new THREE.AmbientLight(0xafc0cf, 0.35);
scene.add(ambientLight);

// 5. Gentle Doorway Light Spill
const doorwayLight = new THREE.PointLight(0xe8f2ff, 1.8, 5.5, 2);
doorwayLight.position.set(3.5, 0.3, 0);
scene.add(doorwayLight);

// 6. Interior Core Point Light (pure white brilliant glow without blue)
const innerCoreLight = new THREE.PointLight(0xffffff, 2.0, 9.0, 1.5);
innerCoreLight.position.set(0.2, 1.3, 0);
scene.add(innerCoreLight);

const innerCoreLight2 = new THREE.PointLight(0xffffff, 1.8, 6.0, 1.5);
innerCoreLight2.position.set(0.2, 0.4, 0);
scene.add(innerCoreLight2);

// --- GPU Snow Particle System (fully shader-driven, zero CPU per frame) ---
function createGpuSnow() {
    const COUNT  = 1400;
    const BOUNDS = 28; // half-extent of spawn volume

    const positions = new Float32Array(COUNT * 3);
    const speeds    = new Float32Array(COUNT);
    const seeds     = new Float32Array(COUNT);
    const sizes     = new Float32Array(COUNT);

    for (let i = 0; i < COUNT; i++) {
        positions[i*3]   = (Math.random() - 0.5) * BOUNDS * 2;
        positions[i*3+1] = Math.random() * BOUNDS * 0.9 - 2;
        positions[i*3+2] = (Math.random() - 0.5) * BOUNDS * 2;
        speeds[i]  = 0.18 + Math.random() * 0.42;
        seeds[i]   = Math.random() * 100.0;
        sizes[i]   = 1.4 + Math.random() * 2.0; // base point size
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSpeed',   new THREE.BufferAttribute(speeds, 1));
    geo.setAttribute('aSeed',    new THREE.BufferAttribute(seeds, 1));
    geo.setAttribute('aSize',    new THREE.BufferAttribute(sizes, 1));

    const mat = new THREE.ShaderMaterial({
        vertexShader:   SNOW_VERT,
        fragmentShader: SNOW_FRAG,
        uniforms: {
            uTime:    { value: 0 },
            uBounds:  { value: BOUNDS },
            uOpacity: { value: 0.55 }
        },
        transparent: true,
        depthWrite:  false,
        blending:    THREE.NormalBlending
    });

    const pts = new THREE.Points(geo, mat);
    scene.add(pts);
    return pts;
}

const gpuSnow = createGpuSnow();

// --- GPU Wind Mist / Ground Blizzard Smoke System ---
function createWindMistSystem() {
    const FOG_VEC3  = new THREE.Vector3(FOG_COLOR_VEC.r, FOG_COLOR_VEC.g, FOG_COLOR_VEC.b);
    const MIST_COUNT = 38;
    const group = new THREE.Group();
    const meshes = [];

    // Shared uniforms (time is updated once per frame from the shared ref)
    const sharedUniforms = {
        uTime:       { value: 0 },
        uOpacity:    { value: 0.26 },
        uFogColor:   { value: FOG_VEC3 },
        uFogDensity: { value: 0.0042 },
        uCameraPos:  { value: new THREE.Vector3() }
    };

    for (let i = 0; i < MIST_COUNT; i++) {
        const scale = 4.5 + Math.random() * 7.5;
        const geo = new THREE.PlaneGeometry(scale, scale * (0.45 + Math.random() * 0.4), 1, 1);

        // Per-instance attribute arrays (4 verts per plane)
        const aSpeed = new Float32Array(4).fill(0.14 + Math.random() * 0.28);
        const aSeed  = new Float32Array(4).fill(Math.random() * 31.4);
        const aScale = new Float32Array(4).fill(scale);
        geo.setAttribute('aSpeed', new THREE.BufferAttribute(aSpeed, 1));
        geo.setAttribute('aSeed',  new THREE.BufferAttribute(aSeed,  1));
        geo.setAttribute('aScale', new THREE.BufferAttribute(aScale, 1));

        const mat = new THREE.ShaderMaterial({
            vertexShader:   WIND_MIST_VERT,
            fragmentShader: WIND_MIST_FRAG,
            uniforms:       sharedUniforms,
            transparent:    true,
            depthWrite:     false,
            side:           THREE.DoubleSide,
            blending:       THREE.NormalBlending
        });

        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(
            (Math.random() - 0.5) * 52,
            0.12 + Math.random() * 2.4,
            (Math.random() - 0.5) * 40
        );
        // Mostly flat, slight random tilt to catch light differently
        mesh.rotation.x = -Math.PI * 0.5 + (Math.random() - 0.5) * 0.55;
        mesh.rotation.z = Math.random() * Math.PI * 2;

        group.add(mesh);
        meshes.push({
            mesh,
            speed:  0.055 + Math.random() * 0.09,
            seed:   Math.random() * 100,
            wrapX:  28
        });
    }

    scene.add(group);
    return { meshes, sharedUniforms };
}

const windMist = createWindMistSystem();

// --- Block State & Collection ---
const iglooBlocks = [];
const blockMeshes = [];

// Curated 2-digit IDs matching the reference video telemetry (e.g. 65, 34, 33, 14, 18, 30, 23...)
const TELEMETRY_IDS = [
    65, 34, 33, 14, 18, 30, 23, 40, 71, 39, 49, 63, 75, 22, 16, 26, 36, 19, 52, 44,
    28, 55, 61, 48, 12, 17, 24, 31, 37, 43, 50, 56, 62, 68, 72, 74, 78, 81, 84, 87,
    91, 95, 11, 15, 21, 27, 35, 41, 47, 53, 59, 66, 70, 76, 79, 82, 85, 88, 92, 96,
    13, 20, 29, 45, 57, 67, 80, 83, 89
];

// --- Load GLB Model ---
const loader = new GLTFLoader();

loader.load(
    '/models/igloo_scene.glb',
    (gltf) => {
        const model = gltf.scene;
        let blockIndex = 0;

        model.traverse((child) => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                const name = child.name;

                // 1. Interior Core: remove blue sphere and make transparent
                if (name === 'Igloo_Inner_Core' || (child.material && child.material.name === 'M_Inner_Glow')) {
                    child.visible = false;
                }
                // 2. Igloo Blocks — snow-textured (previous look)
                else if (name.startsWith('Block_') || (child.material && child.material.name === 'M_Igloo_Stone')) {
                    const isEntrance = name.startsWith('Block_Arch');
                    const blockMat = new THREE.MeshStandardMaterial({
                        color: 0xb4c1cc,
                        roughness: 0.92,
                        metalness: 0.02,
                        bumpMap: snowTexture,
                        bumpScale: 0.02,
                        side: THREE.DoubleSide
                    });

                    blockMat.userData.uHover = { value: 0.0 };
                    blockMat.userData.uIsEntrance = { value: isEntrance ? 1.0 : 0.0 };

                    blockMat.onBeforeCompile = (shader) => {
                        shader.uniforms.uHover = blockMat.userData.uHover;
                        shader.uniforms.uIsEntrance = blockMat.userData.uIsEntrance;

                        shader.vertexShader = shader.vertexShader
                            .replace(
                                '#include <common>',
                                `#include <common>\nvarying vec3 vWorldNormal;\nvarying vec3 vWorldPos;`
                            )
                            .replace(
                                '#include <worldpos_vertex>',
                                `#include <worldpos_vertex>\nvWorldNormal = normalize(mat3(modelMatrix) * normal);\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`
                            );

                        shader.fragmentShader = shader.fragmentShader
                            .replace(
                                '#include <common>',
                                `#include <common>\nuniform float uHover;\nuniform float uIsEntrance;\nvarying vec3 vWorldNormal;\nvarying vec3 vWorldPos;`
                            )
                            .replace(
                                '#include <dithering_fragment>',
                                `#include <dithering_fragment>
                                if (uHover > 0.001) {
                                    vec3 radialDir = normalize(vWorldPos - vec3(0.2, 0.35, 0.0));
                                    float outsideDot = dot(vWorldNormal, radialDir);

                                    // The 1 outside face (facing camera / top exterior) stays normal snow
                                    // The other 5 faces (cut seams + inner face) glow brightly
                                    float outsideMask = smoothstep(0.25, 0.48, outsideDot);
                                    float innerSidesGlow = 1.0 - outsideMask;

                                    if (innerSidesGlow > 0.01) {
                                        vec3 vDir = normalize(-vViewPosition);
                                        vec3 nDir = normalize(vNormal);
                                        float fresnel = pow(1.0 - clamp(dot(nDir, vDir), 0.0, 1.0), 1.8);

                                        float glowFactor = innerSidesGlow * (fresnel * 0.45 + 0.45);
                                        vec3 glowCol = vec3(0.55, 0.85, 1.0);
                                        gl_FragColor.rgb += glowCol * glowFactor * uHover * 0.65;
                                    }
                                }`
                            );
                    };

                    child.material = blockMat;


                    // Compute block center and outward vector
                    const basePos = child.position.clone();
                    const baseRot = child.rotation.clone();
                    const baseQuat = child.quaternion.clone();

                    // Outward displacement direction: outward from dome center + natural upward lift
                    const outwardDir = new THREE.Vector3().subVectors(basePos, new THREE.Vector3(0.2, 0.4, 0)).normalize();
                    outwardDir.y = Math.max(outwardDir.y, 0.18) + 0.38;
                    outwardDir.normalize();

                    // Height factor: balanced gradient from grounded base to levitating cap
                    let heightFactor = 1.0;
                    if (basePos.y < 0.65) {
                        heightFactor = 0.22;
                    } else if (basePos.y < 1.4) {
                        heightFactor = 0.62;
                    } else if (basePos.y < 2.4) {
                        heightFactor = 0.92;
                    } else {
                        heightFactor = 1.18;
                    }

                    const idNumber = TELEMETRY_IDS[blockIndex % TELEMETRY_IDS.length];
                    const seed = (blockIndex * 0.173 + 0.31) % 1.0;

                    iglooBlocks.push({
                        mesh: child,
                        name: name,
                        basePos: basePos,
                        baseRot: baseRot,
                        baseQuat: baseQuat,
                        outwardDir: outwardDir,
                        heightFactor: heightFactor,
                        idNumber: idNumber,
                        seed: seed,
                        disp: 0,
                        hoverStrength: 0,
                        screenX: 0,
                        screenY: 0
                    });

                    blockMeshes.push(child);
                    blockIndex++;
                }
                // 3. Terrain Base & Background Mountains — photorealistic arctic snow GLSL shader
                else if (name.startsWith('Terrain_') || (child.material && child.material.name === 'M_Terrain_Snow')) {
                    const isFG = name === 'Terrain_Foreground';
                    child.material = isFG ? terrainForegroundMat : terrainMountainsMat;
                    child.receiveShadow = true;
                }
            }
        });

        scene.add(model);

        // Fade out loading indicator once loaded
        if (statusContainer) {
            setTimeout(() => {
                statusContainer.classList.add('loaded');
            }, 400);
        }
    },
    (progress) => {
        if (statusText && progress.total > 0) {
            const pct = Math.round((progress.loaded / progress.total) * 100);
            statusText.textContent = `Loading scene (${pct}%)`;
        }
    },
    (error) => {
        console.error('Error loading /models/igloo_scene.glb:', error);
        if (statusText) statusText.textContent = 'Failed to load 3D scene';
    }
);

// --- Mouse Interaction & Raycasting ---
const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };
const mouseNDC = new THREE.Vector2(-999, -999);
const raycaster = new THREE.Raycaster();
const mouseWorldTarget = new THREE.Vector3(0.3, 1.45, 0);
let mouseActive = false;
let mouseActiveTimer = null;

// Virtual plane through igloo center facing camera for fallback raycasting
const virtualPlane = new THREE.Plane();
const planeNormal = new THREE.Vector3();
const iglooCenter = new THREE.Vector3(0.3, 1.45, 0);

window.addEventListener('mousemove', (e) => {
    // Normalized device coordinates (-1 to 1)
    mouseNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
    mouseNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;

    mouse.targetX = mouseNDC.x;
    mouse.targetY = mouseNDC.y;

    mouseActive = true;
    clearTimeout(mouseActiveTimer);
    mouseActiveTimer = setTimeout(() => {
        mouseActive = false;
    }, 3500);
});

window.addEventListener('mouseleave', () => {
    mouse.targetX = 0;
    mouse.targetY = 0;
    mouseActive = false;
});


// --- Ambient Arctic Wind Synthesizer (Web Audio API) ---
let audioCtx = null;
let windGain = null;
let soundOn = true;

function initWindAudio() {
    if (audioCtx) return;
    try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        audioCtx = new AudioContextClass();

        // 5-second pink/white noise buffer for natural arctic wind sound
        const bufferSize = audioCtx.sampleRate * 4;
        const noiseBuffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const output = noiseBuffer.getChannelData(0);
        let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;

        for (let i = 0; i < bufferSize; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.99886 * b0 + white * 0.0555179;
            b1 = 0.99332 * b1 + white * 0.0750759;
            b2 = 0.96900 * b2 + white * 0.1538520;
            b3 = 0.86650 * b3 + white * 0.3104856;
            b4 = 0.55000 * b4 + white * 0.5329522;
            b5 = -0.7616 * b5 - white * 0.0168980;
            output[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.04;
            b6 = white * 0.115926;
        }

        const whiteNoise = audioCtx.createBufferSource();
        whiteNoise.buffer = noiseBuffer;
        whiteNoise.loop = true;

        // Resonant lowpass filter to create wind gust frequencies
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 380;
        filter.Q.value = 2.0;

        // Wind LFO to simulate gentle gusts
        const lfo = audioCtx.createOscillator();
        lfo.frequency.value = 0.18;
        const lfoGain = audioCtx.createGain();
        lfoGain.gain.value = 160;
        lfo.connect(lfoGain);
        lfoGain.connect(filter.frequency);
        lfo.start();

        // Master wind gain
        windGain = audioCtx.createGain();
        windGain.gain.value = soundOn ? 0.22 : 0;

        whiteNoise.connect(filter);
        filter.connect(windGain);
        windGain.connect(audioCtx.destination);
        whiteNoise.start();
    } catch (err) {
        console.warn('Web Audio initialization note:', err);
    }
}

// Sound toggle button listener
const soundBtn = document.getElementById('sound-btn');
const soundLabel = document.getElementById('sound-label');

if (soundBtn) {
    soundBtn.addEventListener('click', () => {
        soundOn = !soundOn;
        if (soundLabel) {
            soundLabel.textContent = `Sound: ${soundOn ? 'On' : 'Off'}`;
        }
        soundBtn.style.opacity = soundOn ? '1' : '0.4';
        soundBtn.setAttribute('title', `Sound: ${soundOn ? 'On' : 'Off'}`);
        soundBtn.setAttribute('aria-label', `Toggle Sound (${soundOn ? 'On' : 'Off'})`);

        if (!audioCtx && soundOn) {
            initWindAudio();
        } else if (windGain && audioCtx) {
            if (audioCtx.state === 'suspended' && soundOn) {
                audioCtx.resume();
            }
            windGain.gain.setTargetAtTime(soundOn ? 0.22 : 0, audioCtx.currentTime, 0.3);
        }
    });
}

// Auto-init wind on first user click anywhere (browser autoplay policy)
window.addEventListener('click', () => {
    if (!audioCtx && soundOn) {
        initWindAudio();
    }
}, { once: true });

// --- Responsive Window Resize ---
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    resizePlexusCanvas();
});

// --- Render 2D Plexus HUD Constellation Lines & Numbers ---
function renderPlexusHUD(activeBlocks) {
    pCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    if (activeBlocks.length < 2) {
        return;
    }

    // Draw connecting lines between closest active floating blocks
    for (let i = 0; i < activeBlocks.length; i++) {
        const b1 = activeBlocks[i];
        let connections = 0;

        for (let j = i + 1; j < activeBlocks.length && connections < 2; j++) {
            const b2 = activeBlocks[j];
            const dx = b1.screenX - b2.screenX;
            const dy = b1.screenY - b2.screenY;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist < 260) {
                const lineAlpha = (1 - dist / 260) * Math.min(b1.hoverStrength, b2.hoverStrength) * 0.55;
                pCtx.beginPath();
                pCtx.moveTo(b1.screenX, b1.screenY);
                pCtx.lineTo(b2.screenX, b2.screenY);
                pCtx.strokeStyle = `rgba(255, 255, 255, ${lineAlpha.toFixed(3)})`;
                pCtx.lineWidth = 1;
                pCtx.stroke();
                connections++;
            }
        }
    }

    // Draw '+' crosshairs and deterministic 2-digit numbers at each active block
    pCtx.font = '10px "IBM Plex Mono", monospace';
    pCtx.textBaseline = 'middle';

    for (let i = 0; i < activeBlocks.length; i++) {
        const b = activeBlocks[i];
        const alpha = Math.min(b.hoverStrength * 1.5, 1.0);
        const x = b.screenX;
        const y = b.screenY;

        // Small '+' crosshair (7px)
        pCtx.beginPath();
        pCtx.moveTo(x - 3.5, y);
        pCtx.lineTo(x + 3.5, y);
        pCtx.moveTo(x, y - 3.5);
        pCtx.lineTo(x, y + 3.5);
        pCtx.strokeStyle = `rgba(255, 255, 255, ${(alpha * 0.8).toFixed(3)})`;
        pCtx.lineWidth = 1;
        pCtx.stroke();

        // Telemetry number next to crosshair
        pCtx.fillStyle = `rgba(255, 255, 255, ${(alpha * 0.85).toFixed(3)})`;
        pCtx.fillText(b.idNumber, x + 7, y - 5);
    }
}

// --- Animation Loop ---
const clock = new THREE.Clock();
const tempVec = new THREE.Vector3();

function animate() {
    requestAnimationFrame(animate);

    const elapsedTime = clock.getElapsedTime();

    // Smooth lerp mouse tracking
    mouse.x += (mouse.targetX - mouse.x) * 0.045;
    mouse.y += (mouse.targetY - mouse.y) * 0.045;

    // Gentle subtle breathing drift (keeps scene alive when cursor is static)
    const idleX = Math.sin(elapsedTime * 0.5) * 0.12;
    const idleY = Math.cos(elapsedTime * 0.7) * 0.08;

    // Compute camera position with smooth hover parallax offset
    const targetCamX = baseCamPos.x + mouse.x * 0.95 + idleX;
    const targetCamY = baseCamPos.y + mouse.y * 0.5 + idleY;
    const targetCamZ = baseCamPos.z + mouse.x * 0.35;

    currentCamPos.x += (targetCamX - currentCamPos.x) * 0.055;
    currentCamPos.y += (targetCamY - currentCamPos.y) * 0.055;
    currentCamPos.z += (targetCamZ - currentCamPos.z) * 0.055;
    camera.position.copy(currentCamPos);

    // Subtle counter-parallax look-at target for deep 3D cinematic feel
    const targetLookX = baseTarget.x + mouse.x * 0.22;
    const targetLookY = baseTarget.y + mouse.y * 0.14;
    const targetLookZ = baseTarget.z;

    currentTarget.x += (targetLookX - currentTarget.x) * 0.055;
    currentTarget.y += (targetLookY - currentTarget.y) * 0.055;
    currentTarget.z += (targetLookZ - currentTarget.z) * 0.055;
    camera.lookAt(currentTarget);

    // Raycast to find 3D mouse focal target near the igloo
    raycaster.setFromCamera(mouseNDC, camera);
    let hasIntersection = false;

    if (blockMeshes.length > 0 && mouseActive) {
        const intersects = raycaster.intersectObjects(blockMeshes, false);
        if (intersects.length > 0) {
            mouseWorldTarget.copy(intersects[0].point);
            hasIntersection = true;
        }
    }

    if (!hasIntersection) {
        camera.getWorldDirection(planeNormal).negate();
        virtualPlane.setFromNormalAndCoplanarPoint(planeNormal, iglooCenter);
        raycaster.ray.intersectPlane(virtualPlane, mouseWorldTarget);
    }

    // --- Dynamic Block Physics (Hover + Organic Wave Idle Float) ---
    const activeBlocks = [];
    let maxHover = 0;

    for (let i = 0; i < iglooBlocks.length; i++) {
        const b = iglooBlocks[i];

        // Distance from block center to mouse focal point
        const d = b.mesh.position.distanceTo(mouseWorldTarget);

        // Hover influence: smooth quadratic falloff within 3.5 radius
        const HOVER_RADIUS = 3.5;
        let targetHover = 0;
        if (mouseActive && d < HOVER_RADIUS) {
            const normD = 1.0 - d / HOVER_RADIUS;
            targetHover = normD * normD * (3.0 - 2.0 * normD) * b.heightFactor;
        }

        // Smooth spring lerp for hover strength
        b.hoverStrength += (targetHover - b.hoverStrength) * 0.09;
        if (b.hoverStrength > maxHover) maxHover = b.hoverStrength;

        // Sync hover glow uniform to block material shader
        if (b.mesh.material && b.mesh.material.userData.uHover) {
            b.mesh.material.userData.uHover.value = b.hoverStrength;
        }

        // Balanced organic wave idle float
        const wave = Math.sin(elapsedTime * 1.4 + b.basePos.x * 1.5 + b.basePos.z * 1.2);
        const micro = Math.cos(elapsedTime * 2.0 + b.seed * 31.4);
        const idleDisp = (wave * 0.085 + micro * 0.05) * b.heightFactor;

        // Total displacement: balanced hover separation + subtle float
        const targetDisp = b.hoverStrength * 1.05 + idleDisp;
        b.disp += (targetDisp - b.disp) * 0.085;

        // Apply 3D position along outward normal vector
        b.mesh.position.copy(b.basePos).addScaledVector(b.outwardDir, b.disp);

        // Apply gentle organic tilt/twist when floating
        b.mesh.rotation.x = b.baseRot.x + Math.sin(b.disp * 2.8 + b.seed * 10) * b.disp * 0.26;
        b.mesh.rotation.y = b.baseRot.y + Math.cos(b.disp * 2.8 + b.seed * 20) * b.disp * 0.26;
        b.mesh.rotation.z = b.baseRot.z + Math.sin(b.disp * 2.8 + b.seed * 30) * b.disp * 0.20;


        // Collect active floating blocks for the 2D Plexus HUD constellation
        if (b.hoverStrength > 0.07) {
            tempVec.copy(b.mesh.position).project(camera);
            b.screenX = (tempVec.x * 0.5 + 0.5) * window.innerWidth;
            b.screenY = (-tempVec.y * 0.5 + 0.5) * window.innerHeight;
            activeBlocks.push(b);
        }
    }

    // Sort active blocks by hover strength and pick top 5 for HUD lines
    activeBlocks.sort((a, b) => b.hoverStrength - a.hoverStrength);
    renderPlexusHUD(activeBlocks.slice(0, 5));

    // Modulate interior core pure white glow illumination when blocks separate
    const openFactor = maxHover;
    if (innerCoreLight) {
        innerCoreLight.intensity = THREE.MathUtils.lerp(2.0, 3.2, openFactor);
    }
    if (innerCoreLight2) {
        innerCoreLight2.intensity = THREE.MathUtils.lerp(1.8, 2.6, openFactor);
    }

    // --- GPU Snow: just advance time uniform, GPU does the rest ---
    gpuSnow.material.uniforms.uTime.value = elapsedTime;

    // --- Wind Mist: advance shared time, drift each quad in +X wind direction ---
    windMist.sharedUniforms.uTime.value = elapsedTime;
    windMist.sharedUniforms.uCameraPos.value.copy(camera.position);
    for (let i = 0; i < windMist.meshes.length; i++) {
        const m = windMist.meshes[i];
        // Drift in wind direction
        m.mesh.position.x += m.speed * (1.0 + Math.sin(elapsedTime * 0.5 + m.seed) * 0.28);
        m.mesh.position.y = m.mesh.position.y + Math.sin(elapsedTime * 0.38 + m.seed) * 0.006;
        // Clamp y above ground
        if (m.mesh.position.y < 0.08) m.mesh.position.y = 0.08;
        // Wrap around X bounds
        if (m.mesh.position.x > m.wrapX) {
            m.mesh.position.x = -m.wrapX;
            m.mesh.position.z = (Math.random() - 0.5) * 40;
        }
    }

    // --- Terrain shader time ---
    sharedTerrainUniforms.uTime.value = elapsedTime;

    // Crisp render pass
    renderer.render(scene, camera);
}

animate();
