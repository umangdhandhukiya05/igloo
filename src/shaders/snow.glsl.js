// --- GPU Snow Particle Shader (vertex-animated, no per-frame CPU updates) ---
// Uses BufferGeometry with per-particle attributes for variety.
// Wind direction is +X, particles fall in -Y and drift +X.

export const SNOW_VERT = /* glsl */`
attribute float aSpeed;
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uBounds; // half-size of spawn cube

void main() {
    // Drift each particle independently based on its seed and speed
    vec3 pos = position;

    // Horizontal wind drift (+X dominant), slight Z variation
    float t = mod(uTime * aSpeed + aSeed * uBounds, uBounds * 2.0) - uBounds;

    // Particle world position with wrapping
    pos.x = mod(pos.x + uTime * aSpeed * 0.9 + aSeed * 3.7, uBounds * 2.0) - uBounds;
    // Vertical fall with sine sway
    float fallCycle = uBounds * 1.8;
    pos.y = mod(pos.y - uTime * aSpeed * 0.55 - aSeed * fallCycle * 0.4, fallCycle) - fallCycle * 0.1;
    // Z sway with mild gusty drift
    pos.z += sin(uTime * 0.6 + aSeed * 12.3) * 0.35;

    vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
    gl_Position = projectionMatrix * mvPos;

    // Size attenuation — smaller at distance, larger close up
    gl_PointSize = aSize * (280.0 / -mvPos.z);
    gl_PointSize = clamp(gl_PointSize, 0.5, 6.0);
}
`;

export const SNOW_FRAG = /* glsl */`
uniform float uOpacity;

void main() {
    // Soft circle disc for snowflake
    vec2 uv = gl_PointCoord - 0.5;
    float r = length(uv);
    float disc = 1.0 - smoothstep(0.30, 0.50, r);
    if (disc < 0.01) discard;
    gl_FragColor = vec4(1.0, 1.0, 1.0, disc * uOpacity);
}
`;
